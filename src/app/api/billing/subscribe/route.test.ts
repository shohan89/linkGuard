import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getOfflineSessionFromRequestMock = vi.fn();
const startUpgradeMock = vi.fn();
const enforceRateLimitMock = vi.fn();
const sanitizeHostMock = vi.fn();

class FakeUnauthenticatedError extends Error {}
class FakeInvalidPlanTierError extends Error {}

vi.mock("@/lib/shopify/session.server", () => ({
  getOfflineSessionFromRequest: getOfflineSessionFromRequestMock,
  UnauthenticatedError: FakeUnauthenticatedError,
}));
vi.mock("@/lib/shopify/client.server", () => ({
  shopify: { utils: { sanitizeHost: sanitizeHostMock } },
}));
vi.mock("@/lib/billing", () => ({
  BillingService: { startUpgrade: startUpgradeMock },
  InvalidPlanTierError: FakeInvalidPlanTierError,
}));
vi.mock("@/lib/security/rate-limit.server", () => ({
  enforceRateLimit: enforceRateLimitMock,
}));

const { POST } = await import("./route");

function makeRequest(body: unknown) {
  return new NextRequest("https://app.example/api/billing/subscribe", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/billing/subscribe", () => {
  beforeEach(() => {
    getOfflineSessionFromRequestMock.mockReset().mockResolvedValue({ shop: "shop.myshopify.com" });
    startUpgradeMock.mockReset().mockResolvedValue({ confirmationUrl: "https://shop.myshopify.com/charges/1" });
    enforceRateLimitMock.mockReset().mockResolvedValue(null);
    sanitizeHostMock.mockReset().mockImplementation((host: string) => host);
  });

  it("returns 429 when rate limited, without starting an upgrade", async () => {
    enforceRateLimitMock.mockResolvedValue(new Response(null, { status: 429 }));

    const response = await POST(makeRequest({ targetTier: "STARTER", host: "aGVsbG8=" }));

    expect(response.status).toBe(429);
    expect(startUpgradeMock).not.toHaveBeenCalled();
  });

  it("checks the rate limit keyed to this shop", async () => {
    await POST(makeRequest({ targetTier: "STARTER", host: "aGVsbG8=" }));
    expect(enforceRateLimitMock).toHaveBeenCalledWith("billing-subscribe", "shop.myshopify.com", 10, 60);
  });

  it("rejects a host that fails Shopify's sanitizeHost validation", async () => {
    sanitizeHostMock.mockReturnValue(null);

    const response = await POST(makeRequest({ targetTier: "STARTER", host: "not-a-real-host" }));

    expect(response.status).toBe(400);
    expect(startUpgradeMock).not.toHaveBeenCalled();
  });
});
