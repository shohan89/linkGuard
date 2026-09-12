import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getOfflineSessionFromRequestMock = vi.fn();
const enqueueScanMock = vi.fn();
const listScansMock = vi.fn();
const enforceRateLimitMock = vi.fn();

class FakeUnauthenticatedError extends Error {}
class FakeScanAlreadyRunningError extends Error {}
class FakePlanLimitExceededError extends Error {}

vi.mock("@/lib/shopify/session.server", () => ({
  getOfflineSessionFromRequest: getOfflineSessionFromRequestMock,
  UnauthenticatedError: FakeUnauthenticatedError,
}));
vi.mock("@/lib/queue/scan-queue.server", () => ({
  enqueueScan: enqueueScanMock,
  ScanAlreadyRunningError: FakeScanAlreadyRunningError,
}));
vi.mock("@/lib/scanner", () => ({
  listScans: listScansMock,
}));
vi.mock("@/lib/billing", () => ({
  PlanLimitExceededError: FakePlanLimitExceededError,
}));
vi.mock("@/lib/security/rate-limit.server", () => ({
  enforceRateLimit: enforceRateLimitMock,
}));

const { GET, POST } = await import("./route");

function makeRequest() {
  return new NextRequest("https://app.example/api/scans", { method: "POST" });
}

describe("POST /api/scans", () => {
  beforeEach(() => {
    getOfflineSessionFromRequestMock.mockReset().mockResolvedValue({ shop: "shop.myshopify.com" });
    enqueueScanMock.mockReset().mockResolvedValue({ scanJobId: "job-1" });
    listScansMock.mockReset().mockResolvedValue([]);
    enforceRateLimitMock.mockReset().mockResolvedValue(null);
  });

  it("returns 401 when unauthenticated", async () => {
    getOfflineSessionFromRequestMock.mockRejectedValue(new FakeUnauthenticatedError("no token"));
    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
    expect(enforceRateLimitMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the shop is rate limited, without enqueueing", async () => {
    enforceRateLimitMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Too many requests, please slow down" }), { status: 429 }),
    );

    const response = await POST(makeRequest());

    expect(response.status).toBe(429);
    expect(enqueueScanMock).not.toHaveBeenCalled();
  });

  it("enqueues a scan and checks the rate limit keyed to this shop", async () => {
    const response = await POST(makeRequest());

    expect(enforceRateLimitMock).toHaveBeenCalledWith("scans", "shop.myshopify.com", 10, 60);
    expect(response.status).toBe(202);
  });
});

describe("GET /api/scans", () => {
  beforeEach(() => {
    getOfflineSessionFromRequestMock.mockReset().mockResolvedValue({ shop: "shop.myshopify.com" });
    listScansMock.mockReset().mockResolvedValue([{ shopDomain: "shop.myshopify.com", linksChecked: 10, issuesFound: 1 }]);
  });

  it("returns 401 when unauthenticated", async () => {
    getOfflineSessionFromRequestMock.mockRejectedValue(new FakeUnauthenticatedError("no token"));
    const response = await GET(new NextRequest("https://app.example/api/scans"));
    expect(response.status).toBe(401);
  });

  it("returns this shop's scan history", async () => {
    const response = await GET(new NextRequest("https://app.example/api/scans"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { shopDomain: "shop.myshopify.com", linksChecked: 10, issuesFound: 1 },
    ]);
    expect(listScansMock).toHaveBeenCalledWith("shop.myshopify.com");
  });
});
