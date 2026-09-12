import { randomBytes } from "node:crypto";
import type { Session } from "@shopify/shopify-api";
import { prisma } from "@/lib/database/client.server";
import { getShop } from "@/lib/database/shops.server";
import {
  ShopifyBillingService,
  ShopifyBillingUserError,
} from "@/lib/shopify/services/billing.server";
import {
  getPlanDefinition,
  PAID_PLAN_TIERS,
  planTierFromSubscriptionName,
  type PlanDefinition,
} from "@/lib/billing/plans";
import type { SubscriptionPlan } from "@prisma/client";

export type { PlanDefinition } from "@/lib/billing/plans";
export { PLAN_DEFINITIONS, getPlanDefinition } from "@/lib/billing/plans";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export class PlanLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitExceededError";
  }
}

export class InvalidPlanTierError extends Error {
  constructor(tier: string) {
    super(`${tier} is not a paid plan tier`);
    this.name = "InvalidPlanTierError";
  }
}

export class InvalidBillingNonceError extends Error {
  constructor() {
    super("Missing or invalid billing confirmation token");
    this.name = "InvalidBillingNonceError";
  }
}

export const BillingService = {
  /** DB-only, no live Shopify call — this is the hot path checked on every scan/discovery. */
  async getActivePlan(shopDomain: string): Promise<PlanDefinition> {
    const shop = await getShop(shopDomain);
    if (!shop) {
      return getPlanDefinition("FREE");
    }

    const subscription = await prisma.subscription.findUnique({ where: { shopId: shop.id } });
    if (!subscription || subscription.status !== "ACTIVE") {
      return getPlanDefinition("FREE");
    }

    return getPlanDefinition(subscription.plan);
  },

  /**
   * Starts an upgrade: creates the Shopify charge and a PENDING local
   * Subscription row, returns the confirmation URL for the merchant to
   * approve (top-level browser — Shopify's confirmation page can't be
   * iframed, same constraint as the OAuth consent screen).
   */
  async startUpgrade(params: {
    shopDomain: string;
    session: Session;
    targetTier: SubscriptionPlan;
    returnUrl: string;
  }): Promise<{ confirmationUrl: string }> {
    if (!PAID_PLAN_TIERS.includes(params.targetTier)) {
      throw new InvalidPlanTierError(params.targetTier);
    }

    const shop = await getShop(params.shopDomain);
    if (!shop) {
      throw new Error(`No shop record for ${params.shopDomain}`);
    }

    const plan = getPlanDefinition(params.targetTier);

    // /api/billing/callback can't require a bearer token — Shopify's
    // redirect back from its confirmation page is an ordinary unauthenticated
    // browser navigation — so this nonce is what stands in for auth there.
    const nonce = randomBytes(24).toString("hex");
    const returnUrl = new URL(params.returnUrl);
    returnUrl.searchParams.set("nonce", nonce);

    const { confirmationUrl, subscriptionId } = await ShopifyBillingService.createSubscription(
      params.session,
      {
        name: `LinkGuard ${plan.name}`,
        priceUsd: plan.priceUsd,
        returnUrl: returnUrl.toString(),
        test: process.env.NODE_ENV !== "production",
      },
    );

    await prisma.subscription.upsert({
      where: { shopId: shop.id },
      create: {
        shopId: shop.id,
        shopifySubscriptionId: subscriptionId,
        plan: params.targetTier,
        status: "PENDING",
        pendingNonce: nonce,
      },
      update: {
        shopifySubscriptionId: subscriptionId,
        plan: params.targetTier,
        status: "PENDING",
        pendingNonce: nonce,
      },
    });

    return { confirmationUrl };
  },

  /**
   * Called from the billing return URL after the merchant approves (or
   * declines) on Shopify's confirmation page. Re-checks with Shopify
   * rather than trusting the redirect alone — the merchant could have
   * navigated back/declined, so this confirms what's actually active.
   *
   * `nonce` must match the value startUpgrade generated and is cleared
   * immediately, whether or not it matched — a stolen/replayed callback
   * URL can be used at most once, and after the real merchant completes
   * checkout, a later replay finds no nonce to match at all.
   */
  async confirmSubscription(shopDomain: string, session: Session, nonce: string): Promise<void> {
    const shop = await getShop(shopDomain);
    if (!shop) {
      throw new Error(`No shop record for ${shopDomain}`);
    }

    const subscription = await prisma.subscription.findUnique({ where: { shopId: shop.id } });
    if (!subscription?.pendingNonce || subscription.pendingNonce !== nonce) {
      throw new InvalidBillingNonceError();
    }

    await prisma.subscription.update({
      where: { shopId: shop.id },
      data: { pendingNonce: null },
    });

    const activeSubscriptions = await ShopifyBillingService.getActiveSubscriptions(session);
    const active = activeSubscriptions.find((sub) => sub.status === "ACTIVE");

    if (!active) {
      // Merchant declined or the confirmation hasn't propagated yet —
      // leave whatever PENDING row exists as-is rather than guessing.
      return;
    }

    const tier = planTierFromSubscriptionName(active.name) ?? "FREE";

    await prisma.subscription.update({
      where: { shopId: shop.id },
      data: {
        shopifySubscriptionId: active.id,
        plan: tier,
        status: "ACTIVE",
        currentPeriodEnd: active.currentPeriodEnd ? new Date(active.currentPeriodEnd) : null,
      },
    });
  },

  /** Cancels any active Shopify charge and reverts the shop to Free. */
  async downgradeToFree(shopDomain: string, session: Session): Promise<void> {
    const shop = await getShop(shopDomain);
    if (!shop) {
      throw new Error(`No shop record for ${shopDomain}`);
    }

    const subscription = await prisma.subscription.findUnique({ where: { shopId: shop.id } });

    if (subscription?.shopifySubscriptionId && subscription.status === "ACTIVE") {
      try {
        await ShopifyBillingService.cancelSubscription(
          session,
          subscription.shopifySubscriptionId,
        );
      } catch (error) {
        if (!(error instanceof ShopifyBillingUserError)) {
          throw error;
        }
        // Already cancelled on Shopify's side (e.g. merchant cancelled
        // from their own admin) — proceed to sync our record regardless.
      }
    }

    await prisma.subscription.upsert({
      where: { shopId: shop.id },
      create: { shopId: shop.id, plan: "FREE", status: "ACTIVE", shopifySubscriptionId: null },
      update: { plan: "FREE", status: "ACTIVE", shopifySubscriptionId: null, currentPeriodEnd: null },
    });
  },

  /** Records one metered scan run — the basis for maxScansPerMonth enforcement. */
  async recordScanUsage(shopId: string): Promise<void> {
    await prisma.usageEvent.create({ data: { shopId, type: "SCAN_RUN" } });
  },

  async getMonthlyScanCount(shopId: string): Promise<number> {
    return prisma.usageEvent.count({
      where: {
        shopId,
        type: "SCAN_RUN",
        occurredAt: { gte: new Date(Date.now() - THIRTY_DAYS_MS) },
      },
    });
  },

  /** Throws PlanLimitExceededError rather than returning a boolean — every
   * call site needs to stop the scan outright, so a thrown error is the
   * pattern the rest of the scan pipeline already handles. */
  async assertCanRunScan(shopDomain: string): Promise<void> {
    const shop = await getShop(shopDomain);
    if (!shop) {
      return;
    }

    const plan = await BillingService.getActivePlan(shopDomain);
    const used = await BillingService.getMonthlyScanCount(shop.id);

    if (used >= plan.maxScansPerMonth) {
      throw new PlanLimitExceededError(
        `${shopDomain} has used ${used}/${plan.maxScansPerMonth} scans this month on the ${plan.name} plan`,
      );
    }
  },

  /** Caps how many URLs get discovered/monitored per the shop's plan. */
  async getMaxUrls(shopDomain: string): Promise<number> {
    const plan = await BillingService.getActivePlan(shopDomain);
    return plan.maxUrls;
  },

  /** Which currently-active shops are eligible for the free tier's
   * once-a-week cadence vs the paid tiers' daily cadence. */
  async isDailyScanEligible(shopDomain: string): Promise<boolean> {
    const plan = await BillingService.getActivePlan(shopDomain);
    return plan.dailyScansEnabled;
  },
};
