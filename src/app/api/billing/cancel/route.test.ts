import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getOfflineSessionFromRequestMock = vi.fn();
const downgradeToFreeMock = vi.fn();
const enforceRateLimitMock = vi.fn();

class FakeUnauthenticatedError extends Error {}

vi.mock("@/lib/shopify/session.server", () => ({
  getOfflineSessionFromRequest: getOfflineSessionFromRequestMock,
  UnauthenticatedError: FakeUnauthenticatedError,
}));
vi.mock("@/lib/billing", () => ({
  BillingService: { downgradeToFree: downgradeToFreeMock },
}));
vi.mock("@/lib/security/rate-limit.server", () => ({
  enforceRateLimit: enforceRateLimitMock,
}));

const { POST } = await import("./route");

function makeRequest() {
  return new NextRequest("https://app.example/api/billing/cancel", { method: "POST" });
}

describe("POST /api/billing/cancel", () => {
  beforeEach(() => {
    getOfflineSessionFromRequestMock.mockReset().mockResolvedValue({ shop: "shop.myshopify.com" });
    downgradeToFreeMock.mockReset().mockResolvedValue(undefined);
    enforceRateLimitMock.mockReset().mockResolvedValue(null);
  });

  it("returns 429 when rate limited, without downgrading", async () => {
    enforceRateLimitMock.mockResolvedValue(new Response(null, { status: 429 }));

    const response = await POST(makeRequest());

    expect(response.status).toBe(429);
    expect(downgradeToFreeMock).not.toHaveBeenCalled();
  });

  it("checks the rate limit keyed to this shop", async () => {
    await POST(makeRequest());
    expect(enforceRateLimitMock).toHaveBeenCalledWith("billing-cancel", "shop.myshopify.com", 10, 60);
  });
});
