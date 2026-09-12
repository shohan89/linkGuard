import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@shopify/shopify-api";

const getShopMock = vi.fn();
const subscriptionFindUniqueMock = vi.fn();
const subscriptionUpsertMock = vi.fn();
const subscriptionUpdateMock = vi.fn();
const usageEventCreateMock = vi.fn();
const usageEventCountMock = vi.fn();
const createSubscriptionMock = vi.fn();
const cancelSubscriptionMock = vi.fn();
const getActiveSubscriptionsMock = vi.fn();

vi.mock("@/lib/database/shops.server", () => ({ getShop: getShopMock }));
vi.mock("@/lib/database/client.server", () => ({
  prisma: {
    subscription: {
      findUnique: subscriptionFindUniqueMock,
      upsert: subscriptionUpsertMock,
      update: subscriptionUpdateMock,
    },
    usageEvent: { create: usageEventCreateMock, count: usageEventCountMock },
  },
}));

class FakeShopifyBillingUserError extends Error {}
vi.mock("@/lib/shopify/services/billing.server", () => ({
  ShopifyBillingService: {
    createSubscription: createSubscriptionMock,
    cancelSubscription: cancelSubscriptionMock,
    getActiveSubscriptions: getActiveSubscriptionsMock,
  },
  ShopifyBillingUserError: FakeShopifyBillingUserError,
}));

const { BillingService, PlanLimitExceededError, InvalidPlanTierError, InvalidBillingNonceError } =
  await import("./index");

const SHOP_DOMAIN = "shop.myshopify.com";
const fakeSession = { shop: SHOP_DOMAIN } as Session;

describe("BillingService.getActivePlan", () => {
  beforeEach(() => {
    getShopMock.mockReset();
    subscriptionFindUniqueMock.mockReset();
  });

  it("returns FREE when the shop doesn't exist", async () => {
    getShopMock.mockResolvedValue(null);
    expect((await BillingService.getActivePlan(SHOP_DOMAIN)).tier).toBe("FREE");
  });

  it("returns FREE when there's no subscription row", async () => {
    getShopMock.mockResolvedValue({ id: "shop-1" });
    subscriptionFindUniqueMock.mockResolvedValue(null);
    expect((await BillingService.getActivePlan(SHOP_DOMAIN)).tier).toBe("FREE");
  });

  it("returns FREE when the subscription isn't ACTIVE (e.g. still PENDING)", async () => {
    getShopMock.mockResolvedValue({ id: "shop-1" });
    subscriptionFindUniqueMock.mockResolvedValue({ plan: "PRO", status: "PENDING" });
    expect((await BillingService.getActivePlan(SHOP_DOMAIN)).tier).toBe("FREE");
  });

  it("returns the subscription's plan when ACTIVE", async () => {
    getShopMock.mockResolvedValue({ id: "shop-1" });
    subscriptionFindUniqueMock.mockResolvedValue({ plan: "GROWTH", status: "ACTIVE" });
    expect((await BillingService.getActivePlan(SHOP_DOMAIN)).tier).toBe("GROWTH");
  });
});

describe("BillingService.startUpgrade", () => {
  beforeEach(() => {
    getShopMock.mockReset().mockResolvedValue({ id: "shop-1" });
    createSubscriptionMock.mockReset();
    subscriptionUpsertMock.mockReset().mockResolvedValue(undefined);
  });

  it("rejects FREE as an upgrade target", async () => {
    await expect(
      BillingService.startUpgrade({
        shopDomain: SHOP_DOMAIN,
        session: fakeSession,
        targetTier: "FREE",
        returnUrl: "https://app.example/callback",
      }),
    ).rejects.toBeInstanceOf(InvalidPlanTierError);
    expect(createSubscriptionMock).not.toHaveBeenCalled();
  });

  it("creates the Shopify charge, a PENDING local subscription row, and a nonce embedded in the returnUrl", async () => {
    createSubscriptionMock.mockResolvedValue({
      confirmationUrl: "https://shop.myshopify.com/charges/1/confirm",
      subscriptionId: "gid://1",
    });

    const result = await BillingService.startUpgrade({
      shopDomain: SHOP_DOMAIN,
      session: fakeSession,
      targetTier: "STARTER",
      returnUrl: "https://app.example/callback",
    });

    expect(result).toEqual({ confirmationUrl: "https://shop.myshopify.com/charges/1/confirm" });
    expect(createSubscriptionMock).toHaveBeenCalledWith(
      fakeSession,
      expect.objectContaining({ name: "LinkGuard Starter", priceUsd: 7.99 }),
    );

    const calledReturnUrl = new URL(createSubscriptionMock.mock.calls[0][1].returnUrl);
    const nonce = calledReturnUrl.searchParams.get("nonce");
    expect(nonce).toMatch(/^[0-9a-f]{48}$/);

    expect(subscriptionUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shopId: "shop-1" },
        create: expect.objectContaining({ plan: "STARTER", status: "PENDING", pendingNonce: nonce }),
      }),
    );
  });

  it("throws when the shop doesn't exist", async () => {
    getShopMock.mockResolvedValue(null);
    await expect(
      BillingService.startUpgrade({
        shopDomain: SHOP_DOMAIN,
        session: fakeSession,
        targetTier: "STARTER",
        returnUrl: "https://app.example/callback",
      }),
    ).rejects.toThrow("No shop record");
  });
});

describe("BillingService.confirmSubscription", () => {
  beforeEach(() => {
    getShopMock.mockReset().mockResolvedValue({ id: "shop-1" });
    subscriptionFindUniqueMock.mockReset().mockResolvedValue({ pendingNonce: "correct-nonce" });
    subscriptionUpdateMock.mockReset().mockResolvedValue(undefined);
    getActiveSubscriptionsMock.mockReset();
  });

  it("rejects a missing/mismatched nonce before calling Shopify at all", async () => {
    await expect(
      BillingService.confirmSubscription(SHOP_DOMAIN, fakeSession, "wrong-nonce"),
    ).rejects.toBeInstanceOf(InvalidBillingNonceError);
    expect(getActiveSubscriptionsMock).not.toHaveBeenCalled();
  });

  it("rejects when there's no pending nonce at all (already consumed / replay)", async () => {
    subscriptionFindUniqueMock.mockResolvedValue({ pendingNonce: null });
    await expect(
      BillingService.confirmSubscription(SHOP_DOMAIN, fakeSession, "correct-nonce"),
    ).rejects.toBeInstanceOf(InvalidBillingNonceError);
  });

  it("clears the nonce even before checking Shopify, so it's single-use regardless of outcome", async () => {
    getActiveSubscriptionsMock.mockResolvedValue([]);
    await BillingService.confirmSubscription(SHOP_DOMAIN, fakeSession, "correct-nonce");
    expect(subscriptionUpdateMock).toHaveBeenCalledWith({
      where: { shopId: "shop-1" },
      data: { pendingNonce: null },
    });
  });

  it("updates the subscription to ACTIVE with the tier parsed from the name", async () => {
    getActiveSubscriptionsMock.mockResolvedValue([
      { id: "gid://1", name: "LinkGuard Growth", status: "ACTIVE", currentPeriodEnd: "2026-02-01T00:00:00Z", test: true },
    ]);

    await BillingService.confirmSubscription(SHOP_DOMAIN, fakeSession, "correct-nonce");

    expect(subscriptionUpdateMock).toHaveBeenCalledWith({
      where: { shopId: "shop-1" },
      data: expect.objectContaining({ plan: "GROWTH", status: "ACTIVE", shopifySubscriptionId: "gid://1" }),
    });
  });

  it("does nothing further if the merchant declined (no ACTIVE subscription found)", async () => {
    getActiveSubscriptionsMock.mockResolvedValue([]);
    await BillingService.confirmSubscription(SHOP_DOMAIN, fakeSession, "correct-nonce");
    // Only the nonce-clearing update happens — no second update to ACTIVE.
    expect(subscriptionUpdateMock).toHaveBeenCalledTimes(1);
  });
});

describe("BillingService.downgradeToFree", () => {
  beforeEach(() => {
    getShopMock.mockReset().mockResolvedValue({ id: "shop-1" });
    subscriptionFindUniqueMock.mockReset();
    cancelSubscriptionMock.mockReset().mockResolvedValue(undefined);
    subscriptionUpsertMock.mockReset().mockResolvedValue(undefined);
  });

  it("cancels the active Shopify subscription and reverts to FREE locally", async () => {
    subscriptionFindUniqueMock.mockResolvedValue({
      shopifySubscriptionId: "gid://1",
      status: "ACTIVE",
    });

    await BillingService.downgradeToFree(SHOP_DOMAIN, fakeSession);

    expect(cancelSubscriptionMock).toHaveBeenCalledWith(fakeSession, "gid://1");
    expect(subscriptionUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ plan: "FREE", shopifySubscriptionId: null }),
      }),
    );
  });

  it("skips the Shopify cancel call when there's nothing active to cancel", async () => {
    subscriptionFindUniqueMock.mockResolvedValue(null);
    await BillingService.downgradeToFree(SHOP_DOMAIN, fakeSession);
    expect(cancelSubscriptionMock).not.toHaveBeenCalled();
    expect(subscriptionUpsertMock).toHaveBeenCalled();
  });

  it("still syncs to FREE locally if Shopify says it's already cancelled", async () => {
    subscriptionFindUniqueMock.mockResolvedValue({
      shopifySubscriptionId: "gid://1",
      status: "ACTIVE",
    });
    cancelSubscriptionMock.mockRejectedValue(new FakeShopifyBillingUserError("already cancelled"));

    await expect(BillingService.downgradeToFree(SHOP_DOMAIN, fakeSession)).resolves.toBeUndefined();
    expect(subscriptionUpsertMock).toHaveBeenCalled();
  });
});

describe("BillingService usage tracking", () => {
  beforeEach(() => {
    usageEventCreateMock.mockReset().mockResolvedValue(undefined);
    usageEventCountMock.mockReset();
  });

  it("recordScanUsage writes a SCAN_RUN UsageEvent", async () => {
    await BillingService.recordScanUsage("shop-1");
    expect(usageEventCreateMock).toHaveBeenCalledWith({
      data: { shopId: "shop-1", type: "SCAN_RUN" },
    });
  });

  it("getMonthlyScanCount counts SCAN_RUN events in the last 30 days", async () => {
    usageEventCountMock.mockResolvedValue(12);
    const count = await BillingService.getMonthlyScanCount("shop-1");
    expect(count).toBe(12);
    expect(usageEventCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ shopId: "shop-1", type: "SCAN_RUN" }),
      }),
    );
  });
});

describe("BillingService.assertCanRunScan", () => {
  beforeEach(() => {
    getShopMock.mockReset().mockResolvedValue({ id: "shop-1" });
    subscriptionFindUniqueMock.mockReset().mockResolvedValue(null); // FREE plan
    usageEventCountMock.mockReset();
  });

  it("does nothing when under quota", async () => {
    usageEventCountMock.mockResolvedValue(1); // FREE allows 4
    await expect(BillingService.assertCanRunScan(SHOP_DOMAIN)).resolves.toBeUndefined();
  });

  it("throws PlanLimitExceededError when quota is used up", async () => {
    usageEventCountMock.mockResolvedValue(4); // FREE allows 4, so 4 used = at limit
    await expect(BillingService.assertCanRunScan(SHOP_DOMAIN)).rejects.toBeInstanceOf(
      PlanLimitExceededError,
    );
  });
});

describe("BillingService.getMaxUrls / isDailyScanEligible", () => {
  beforeEach(() => {
    getShopMock.mockReset().mockResolvedValue({ id: "shop-1" });
    subscriptionFindUniqueMock.mockReset();
  });

  it("getMaxUrls reflects the active plan", async () => {
    subscriptionFindUniqueMock.mockResolvedValue({ plan: "PRO", status: "ACTIVE" });
    expect(await BillingService.getMaxUrls(SHOP_DOMAIN)).toBe(5000);
  });

  it("isDailyScanEligible is false on Free, true on paid", async () => {
    subscriptionFindUniqueMock.mockResolvedValue(null);
    expect(await BillingService.isDailyScanEligible(SHOP_DOMAIN)).toBe(false);

    subscriptionFindUniqueMock.mockResolvedValue({ plan: "STARTER", status: "ACTIVE" });
    expect(await BillingService.isDailyScanEligible(SHOP_DOMAIN)).toBe(true);
  });
});
