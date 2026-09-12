import { describe, expect, it, vi } from "vitest";
import type { Session } from "@shopify/shopify-api";

const runAdminQueryMock = vi.fn();

vi.mock("@/lib/shopify/admin.server", () => ({ runAdminQuery: runAdminQueryMock }));

const { ShopifyBillingService, ShopifyBillingUserError } = await import("./billing.server");

const fakeSession = { shop: "shop.myshopify.com" } as Session;

describe("ShopifyBillingService.getActiveSubscriptions", () => {
  it("returns the active subscriptions list", async () => {
    runAdminQueryMock.mockReset().mockResolvedValue({
      currentAppInstallation: {
        activeSubscriptions: [
          { id: "1", name: "LinkGuard Pro", status: "ACTIVE", currentPeriodEnd: "2026-02-01", test: true },
        ],
      },
    });

    const result = await ShopifyBillingService.getActiveSubscriptions(fakeSession);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("LinkGuard Pro");
  });
});

describe("ShopifyBillingService.createSubscription", () => {
  it("returns the confirmation URL and subscription id on success", async () => {
    runAdminQueryMock.mockReset().mockResolvedValue({
      appSubscriptionCreate: {
        appSubscription: { id: "gid://shopify/AppSubscription/1", status: "PENDING" },
        confirmationUrl: "https://shop.myshopify.com/admin/charges/1/confirm",
        userErrors: [],
      },
    });

    const result = await ShopifyBillingService.createSubscription(fakeSession, {
      name: "LinkGuard Starter",
      priceUsd: 7.99,
      returnUrl: "https://app.example/callback",
      test: true,
    });

    expect(result).toEqual({
      confirmationUrl: "https://shop.myshopify.com/admin/charges/1/confirm",
      subscriptionId: "gid://shopify/AppSubscription/1",
    });
    expect(runAdminQueryMock).toHaveBeenCalledWith(
      fakeSession,
      expect.any(String),
      expect.objectContaining({
        name: "LinkGuard Starter",
        test: true,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: 7.99, currencyCode: "USD" },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
      }),
    );
  });

  it("throws ShopifyBillingUserError on a userError (e.g. distribution restriction)", async () => {
    runAdminQueryMock.mockReset().mockResolvedValue({
      appSubscriptionCreate: {
        appSubscription: null,
        confirmationUrl: null,
        userErrors: [
          { field: null, message: "Apps without a public distribution cannot use the Billing API" },
        ],
      },
    });

    await expect(
      ShopifyBillingService.createSubscription(fakeSession, {
        name: "LinkGuard Starter",
        priceUsd: 7.99,
        returnUrl: "https://app.example/callback",
        test: true,
      }),
    ).rejects.toThrow(ShopifyBillingUserError);
  });
});

describe("ShopifyBillingService.cancelSubscription", () => {
  it("resolves cleanly on success", async () => {
    runAdminQueryMock.mockReset().mockResolvedValue({
      appSubscriptionCancel: {
        appSubscription: { id: "gid://1", status: "CANCELLED" },
        userErrors: [],
      },
    });

    await expect(
      ShopifyBillingService.cancelSubscription(fakeSession, "gid://1"),
    ).resolves.toBeUndefined();
  });

  it("throws ShopifyBillingUserError on a userError", async () => {
    runAdminQueryMock.mockReset().mockResolvedValue({
      appSubscriptionCancel: {
        appSubscription: null,
        userErrors: [{ field: null, message: "Subscription not found" }],
      },
    });

    await expect(
      ShopifyBillingService.cancelSubscription(fakeSession, "gid://1"),
    ).rejects.toThrow(ShopifyBillingUserError);
  });
});
