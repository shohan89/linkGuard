import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const loadOfflineSessionForShopMock = vi.fn();
const confirmSubscriptionMock = vi.fn();
const getEmbeddedAppUrlMock = vi.fn();

class FakeInvalidBillingNonceError extends Error {}

vi.mock("@/lib/shopify/session.server", () => ({
  loadOfflineSessionForShop: loadOfflineSessionForShopMock,
}));
vi.mock("@/lib/billing", () => ({
  BillingService: { confirmSubscription: confirmSubscriptionMock },
  InvalidBillingNonceError: FakeInvalidBillingNonceError,
}));
vi.mock("@/lib/shopify/client.server", () => ({
  shopify: { auth: { getEmbeddedAppUrl: getEmbeddedAppUrlMock } },
}));

const { GET } = await import("./route");

function makeRequest(query: string) {
  return new NextRequest(`https://app.example/api/billing/callback${query}`);
}

describe("GET /api/billing/callback", () => {
  beforeEach(() => {
    loadOfflineSessionForShopMock.mockReset().mockResolvedValue({ shop: "shop.myshopify.com" });
    confirmSubscriptionMock.mockReset().mockResolvedValue(undefined);
    getEmbeddedAppUrlMock.mockReset().mockResolvedValue("https://admin.shopify.com/store/shop/apps/linkguard");
  });

  it("rejects a request missing the nonce param, without touching the session store", async () => {
    const response = await GET(makeRequest("?shop=shop.myshopify.com"));
    expect(response.status).toBe(400);
    expect(loadOfflineSessionForShopMock).not.toHaveBeenCalled();
  });

  it("rejects a request missing the shop param", async () => {
    const response = await GET(makeRequest("?nonce=abc"));
    expect(response.status).toBe(400);
  });

  it("returns 401 when there's no stored offline session for the shop", async () => {
    loadOfflineSessionForShopMock.mockResolvedValue(undefined);
    const response = await GET(makeRequest("?shop=shop.myshopify.com&nonce=abc"));
    expect(response.status).toBe(401);
  });

  it("returns 403 on an invalid/mismatched nonce, without redirecting into the app", async () => {
    confirmSubscriptionMock.mockRejectedValue(new FakeInvalidBillingNonceError("bad nonce"));

    const response = await GET(makeRequest("?shop=shop.myshopify.com&nonce=forged"));

    expect(response.status).toBe(403);
    expect(getEmbeddedAppUrlMock).not.toHaveBeenCalled();
  });

  it("confirms the subscription with the given nonce and redirects into the app on success", async () => {
    const response = await GET(makeRequest("?shop=shop.myshopify.com&nonce=abc"));

    expect(confirmSubscriptionMock).toHaveBeenCalledWith(
      "shop.myshopify.com",
      { shop: "shop.myshopify.com" },
      "abc",
    );
    expect(response.status).toBe(302);
  });
});
