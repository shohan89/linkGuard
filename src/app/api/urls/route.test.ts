import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getOfflineSessionFromRequestMock = vi.fn();
const listMonitoredUrlsMock = vi.fn();

class FakeUnauthenticatedError extends Error {}

vi.mock("@/lib/shopify/session.server", () => ({
  getOfflineSessionFromRequest: getOfflineSessionFromRequestMock,
  UnauthenticatedError: FakeUnauthenticatedError,
}));
vi.mock("@/lib/scanner", () => ({
  listMonitoredUrls: listMonitoredUrlsMock,
}));

const { GET } = await import("./route");

describe("GET /api/urls", () => {
  beforeEach(() => {
    getOfflineSessionFromRequestMock.mockReset().mockResolvedValue({ shop: "shop.myshopify.com" });
    listMonitoredUrlsMock.mockReset().mockResolvedValue([]);
  });

  it("returns 401 when unauthenticated", async () => {
    getOfflineSessionFromRequestMock.mockRejectedValue(new FakeUnauthenticatedError("no token"));
    const response = await GET(new NextRequest("https://app.example/api/urls"));
    expect(response.status).toBe(401);
  });

  it("returns this shop's monitored URLs", async () => {
    listMonitoredUrlsMock.mockResolvedValue(["https://shop.example/a"]);
    const response = await GET(new NextRequest("https://app.example/api/urls"));
    expect(await response.json()).toEqual(["https://shop.example/a"]);
    expect(listMonitoredUrlsMock).toHaveBeenCalledWith("shop.myshopify.com");
  });
});
