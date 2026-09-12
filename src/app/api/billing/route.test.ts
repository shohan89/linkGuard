import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getOfflineSessionFromRequestMock = vi.fn();
const getShopMock = vi.fn();
const getActivePlanMock = vi.fn();
const getMonthlyScanCountMock = vi.fn();
const urlLinkCountMock = vi.fn();

class FakeUnauthenticatedError extends Error {}

vi.mock("@/lib/shopify/session.server", () => ({
  getOfflineSessionFromRequest: getOfflineSessionFromRequestMock,
  UnauthenticatedError: FakeUnauthenticatedError,
}));
vi.mock("@/lib/database/shops.server", () => ({ getShop: getShopMock }));
vi.mock("@/lib/database/client.server", () => ({
  prisma: { urlLink: { count: urlLinkCountMock } },
}));
vi.mock("@/lib/billing", () => ({
  BillingService: { getActivePlan: getActivePlanMock, getMonthlyScanCount: getMonthlyScanCountMock },
  PLAN_DEFINITIONS: { FREE: { tier: "FREE", name: "Free" } },
}));

const { GET } = await import("./route");

describe("GET /api/billing", () => {
  beforeEach(() => {
    getOfflineSessionFromRequestMock.mockReset().mockResolvedValue({ shop: "shop.myshopify.com" });
    getShopMock.mockReset().mockResolvedValue({ id: "shop-1" });
    getActivePlanMock.mockReset().mockResolvedValue({ tier: "FREE", maxScansPerMonth: 4, maxUrls: 100 });
    getMonthlyScanCountMock.mockReset().mockResolvedValue(2);
    urlLinkCountMock.mockReset().mockResolvedValue(10);
  });

  it("returns 401 when unauthenticated", async () => {
    getOfflineSessionFromRequestMock.mockRejectedValue(new FakeUnauthenticatedError("no token"));
    const response = await GET(new NextRequest("https://app.example/api/billing"));
    expect(response.status).toBe(401);
  });

  it("returns plans and usage for the authenticated shop", async () => {
    const response = await GET(new NextRequest("https://app.example/api/billing"));
    const body = await response.json();

    expect(body.currentTier).toBe("FREE");
    expect(body.usage).toEqual({ scansUsed: 2, scansLimit: 4, urlsUsed: 10, urlsLimit: 100 });
    expect(getMonthlyScanCountMock).toHaveBeenCalledWith("shop-1");
  });

  it("returns zeroed usage when there's no local Shop row", async () => {
    getShopMock.mockResolvedValue(null);
    const response = await GET(new NextRequest("https://app.example/api/billing"));
    const body = await response.json();
    expect(body.usage.scansUsed).toBe(0);
    expect(body.usage.urlsUsed).toBe(0);
  });
});
