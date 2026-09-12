import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestContext } from "vitest";
import type { Session } from "@shopify/shopify-api";
import type { Subscription } from "@prisma/client";
import { prisma } from "@/lib/database/client.server";
import { getShop } from "@/lib/database/shops.server";
import { loadOfflineSessionForShop } from "@/lib/shopify/session.server";
import { ShopifyBillingService, ShopifyBillingUserError } from "@/lib/shopify/services/billing.server";
import { BillingService, InvalidBillingNonceError } from "@/lib/billing";
import { getLiveTestStoreDomain } from "@/lib/test-support/integration.server";

/**
 * Real Shopify Billing API on the live test store — real
 * appSubscriptionCreate/Cancel mutations, real GraphQL response shapes —
 * plus the real nonce/replay logic against real Postgres. Every
 * subscription this creates is cancelled on Shopify again in `afterAll`,
 * and the shop's pre-existing Subscription row (whatever it was) is
 * restored so this doesn't leave the shared dev store's billing state
 * different from how it found it.
 *
 * Shopify's Billing API refuses AppSubscriptionCreate for an app that
 * doesn't have a distribution set in the Partner Dashboard (Apps ›
 * Distribution — pick "Custom distribution" or start the public listing
 * draft), even for test:true charges on a dev store. That's a one-time
 * manual Partner Dashboard step this test suite cannot perform on its own
 * — every test here detects that specific error and skips itself with a
 * clear reason instead of failing, so the rest of the suite still runs.
 */
describe("Billing (real Shopify Billing API)", () => {
  const shopDomain = getLiveTestStoreDomain();
  let session: Session;
  let shopId: string;
  let priorSubscription: Subscription | null;
  const createdSubscriptionIds: string[] = [];
  let billingApiUnavailableReason: string | null = null;

  beforeAll(async () => {
    const loaded = await loadOfflineSessionForShop(shopDomain);
    if (!loaded) {
      throw new Error(
        `No offline session stored for ${shopDomain} — install the app on this store before running billing integration tests`,
      );
    }
    session = loaded;

    const shop = await getShop(shopDomain);
    if (!shop) throw new Error(`No Shop row for ${shopDomain}`);
    shopId = shop.id;
    priorSubscription = await prisma.subscription.findUnique({ where: { shopId } });
  });

  afterAll(async () => {
    for (const id of createdSubscriptionIds) {
      await ShopifyBillingService.cancelSubscription(session, id).catch(() => {});
    }

    if (priorSubscription) {
      const restored = {
        plan: priorSubscription.plan,
        status: priorSubscription.status,
        shopifySubscriptionId: priorSubscription.shopifySubscriptionId,
        currentPeriodEnd: priorSubscription.currentPeriodEnd,
        pendingNonce: priorSubscription.pendingNonce,
      };
      await prisma.subscription.upsert({
        where: { shopId },
        create: { shopId, ...restored },
        update: restored,
      });
    } else {
      await prisma.subscription.deleteMany({ where: { shopId } });
    }

    if (billingApiUnavailableReason) {
      console.warn(
        `\n⚠ Billing integration tests skipped — Shopify rejected the real API call: "${billingApiUnavailableReason}"\n` +
          `  Fix: in the Partner Dashboard, set this app's Distribution (Apps → your app → Distribution) — a public\n` +
          `  or custom distribution is required before AppSubscriptionCreate works, even for test:true charges.\n`,
      );
    }
  });

  /** Returns true (and skips the test) if this specific, known, account-config error occurred. */
  function skipIfNoDistribution(ctx: TestContext, error: unknown): boolean {
    if (
      error instanceof ShopifyBillingUserError &&
      /public distribution/i.test(error.message)
    ) {
      billingApiUnavailableReason = error.message;
      ctx.skip();
      return true;
    }
    return false;
  }

  it("creates a real test AppSubscription charge on Shopify", async (ctx) => {
    if (billingApiUnavailableReason) ctx.skip();

    let created;
    try {
      created = await ShopifyBillingService.createSubscription(session, {
        name: "LinkGuard Integration Test Charge",
        priceUsd: 1,
        returnUrl: "https://example.com/callback",
        test: true,
      });
    } catch (error) {
      if (skipIfNoDistribution(ctx, error)) return;
      throw error;
    }
    createdSubscriptionIds.push(created.subscriptionId);

    expect(created.confirmationUrl).toMatch(/^https:\/\//);
    expect(created.subscriptionId).toMatch(/^gid:\/\/shopify\/AppSubscription\//);
  }, 30_000);

  it("startUpgrade writes a real nonce, and confirmSubscription's nonce check survives a real DB round-trip", async (ctx) => {
    if (billingApiUnavailableReason) ctx.skip();

    let confirmationUrl;
    try {
      ({ confirmationUrl } = await BillingService.startUpgrade({
        shopDomain,
        session,
        targetTier: "STARTER",
        returnUrl: "https://example.com/callback",
      }));
    } catch (error) {
      if (skipIfNoDistribution(ctx, error)) return;
      throw error;
    }
    expect(confirmationUrl).toMatch(/^https:\/\//);

    const row = await prisma.subscription.findUniqueOrThrow({ where: { shopId } });
    createdSubscriptionIds.push(row.shopifySubscriptionId!);
    const nonce = row.pendingNonce;
    expect(nonce).toBeTruthy();

    await expect(
      BillingService.confirmSubscription(shopDomain, session, "wrong-nonce"),
    ).rejects.toBeInstanceOf(InvalidBillingNonceError);

    // Real Shopify hasn't seen a merchant approval, so this hits the
    // "declined / not propagated yet" branch — but the nonce itself,
    // stored in and read back from real Postgres, must still be consumed.
    await expect(
      BillingService.confirmSubscription(shopDomain, session, nonce!),
    ).resolves.toBeUndefined();

    const afterConfirm = await prisma.subscription.findUniqueOrThrow({ where: { shopId } });
    expect(afterConfirm.pendingNonce).toBeNull();

    // Replay of the same (now-consumed) nonce must fail.
    await expect(
      BillingService.confirmSubscription(shopDomain, session, nonce!),
    ).rejects.toBeInstanceOf(InvalidBillingNonceError);
  }, 30_000);

  it("downgradeToFree cancels a real active-shaped subscription and reverts local state", async (ctx) => {
    if (billingApiUnavailableReason) ctx.skip();

    let subscriptionId;
    try {
      ({ subscriptionId } = await ShopifyBillingService.createSubscription(session, {
        name: "LinkGuard Integration Test Downgrade",
        priceUsd: 1,
        returnUrl: "https://example.com/callback",
        test: true,
      }));
    } catch (error) {
      if (skipIfNoDistribution(ctx, error)) return;
      throw error;
    }

    await prisma.subscription.update({
      where: { shopId },
      data: { shopifySubscriptionId: subscriptionId, status: "ACTIVE", plan: "STARTER" },
    });

    await BillingService.downgradeToFree(shopDomain, session);

    const row = await prisma.subscription.findUniqueOrThrow({ where: { shopId } });
    expect(row.plan).toBe("FREE");
    expect(row.shopifySubscriptionId).toBeNull();
  }, 30_000);
});
