import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getOfflineSessionFromRequestMock = vi.fn();
const getOverviewMock = vi.fn();

class FakeUnauthenticatedError extends Error {}

vi.mock("@/lib/shopify/session.server", () => ({
  getOfflineSessionFromRequest: getOfflineSessionFromRequestMock,
  UnauthenticatedError: FakeUnauthenticatedError,
}));
vi.mock("@/lib/dashboard", () => ({
  DashboardService: { getOverview: getOverviewMock },
}));

const { GET } = await import("./route");

describe("GET /api/dashboard", () => {
  beforeEach(() => {
    getOfflineSessionFromRequestMock.mockReset().mockResolvedValue({ shop: "shop.myshopify.com" });
    getOverviewMock.mockReset().mockResolvedValue({ healthScore: 100 });
  });

  it("returns 401 when unauthenticated", async () => {
    getOfflineSessionFromRequestMock.mockRejectedValue(new FakeUnauthenticatedError("no token"));
    const response = await GET(new NextRequest("https://app.example/api/dashboard"));
    expect(response.status).toBe(401);
    expect(getOverviewMock).not.toHaveBeenCalled();
  });

  it("returns the overview for the authenticated shop, never a query-param shop", async () => {
    const request = new NextRequest("https://app.example/api/dashboard?shop=attacker-supplied.myshopify.com");
    const response = await GET(request);

    expect(await response.json()).toEqual({ healthScore: 100 });
    expect(getOverviewMock).toHaveBeenCalledWith("shop.myshopify.com");
    expect(getOverviewMock).not.toHaveBeenCalledWith("attacker-supplied.myshopify.com");
  });
});
