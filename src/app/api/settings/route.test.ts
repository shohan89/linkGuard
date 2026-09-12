import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getOfflineSessionFromRequestMock = vi.fn();
const getShopMock = vi.fn();
const getActivePlanMock = vi.fn();

class FakeUnauthenticatedError extends Error {}

vi.mock("@/lib/shopify/session.server", () => ({
  getOfflineSessionFromRequest: getOfflineSessionFromRequestMock,
  UnauthenticatedError: FakeUnauthenticatedError,
}));
vi.mock("@/lib/database/shops.server", () => ({ getShop: getShopMock }));
vi.mock("@/lib/billing", () => ({
  BillingService: { getActivePlan: getActivePlanMock },
}));

const { GET } = await import("./route");

describe("GET /api/settings", () => {
  beforeEach(() => {
    getOfflineSessionFromRequestMock.mockReset().mockResolvedValue({ shop: "shop.myshopify.com" });
    getShopMock.mockReset();
    getActivePlanMock.mockReset().mockResolvedValue({ tier: "FREE" });
  });

  it("returns 401 when unauthenticated", async () => {
    getOfflineSessionFromRequestMock.mockRejectedValue(new FakeUnauthenticatedError("no token"));
    const response = await GET(new NextRequest("https://app.example/api/settings"));
    expect(response.status).toBe(401);
  });

  it("returns the shop's settings for the authenticated shop", async () => {
    getShopMock.mockResolvedValue({
      shopDomain: "shop.myshopify.com",
      installedAt: new Date("2026-01-01"),
      isActive: true,
    });

    const response = await GET(new NextRequest("https://app.example/api/settings"));
    const body = await response.json();

    expect(body.shopDomain).toBe("shop.myshopify.com");
    expect(body.isActive).toBe(true);
    expect(getShopMock).toHaveBeenCalledWith("shop.myshopify.com");
  });

  it("falls back to an inactive shell when there's no local Shop row", async () => {
    getShopMock.mockResolvedValue(null);

    const response = await GET(new NextRequest("https://app.example/api/settings"));
    const body = await response.json();

    expect(body.isActive).toBe(false);
    expect(body.shopDomain).toBe("shop.myshopify.com");
  });
});
