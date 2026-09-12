import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getOfflineSessionFromRequestMock = vi.fn();
const createRedirectMock = vi.fn();
const listHistoryMock = vi.fn();
const listRedirectIssuesMock = vi.fn();
const enforceRateLimitMock = vi.fn();

class FakeUnauthenticatedError extends Error {}

vi.mock("@/lib/shopify/session.server", () => ({
  getOfflineSessionFromRequest: getOfflineSessionFromRequestMock,
  UnauthenticatedError: FakeUnauthenticatedError,
}));
vi.mock("@/lib/redirects", () => ({
  RedirectManagementService: { createRedirect: createRedirectMock, listHistory: listHistoryMock },
}));
vi.mock("@/lib/issues/issue.server", () => ({
  IssueService: { listRedirectIssues: listRedirectIssuesMock },
}));
vi.mock("@/lib/security/rate-limit.server", () => ({
  enforceRateLimit: enforceRateLimitMock,
}));

const { GET, POST } = await import("./route");

function makeRequest(body: unknown) {
  return new NextRequest("https://app.example/api/redirects", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/redirects", () => {
  beforeEach(() => {
    getOfflineSessionFromRequestMock.mockReset().mockResolvedValue({ shop: "shop.myshopify.com" });
    createRedirectMock.mockReset().mockResolvedValue({
      ok: true,
      redirect: { id: "gid://1", fromPath: "/a", toTarget: "/b" },
    });
    enforceRateLimitMock.mockReset().mockResolvedValue(null);
  });

  it("returns 401 when unauthenticated, before checking the rate limit", async () => {
    getOfflineSessionFromRequestMock.mockRejectedValue(new FakeUnauthenticatedError("no token"));
    const response = await POST(makeRequest({ fromUrl: "/a", toUrl: "/b" }));
    expect(response.status).toBe(401);
    expect(enforceRateLimitMock).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited, without creating a redirect", async () => {
    enforceRateLimitMock.mockResolvedValue(new Response(null, { status: 429 }));

    const response = await POST(makeRequest({ fromUrl: "/a", toUrl: "/b" }));

    expect(response.status).toBe(429);
    expect(createRedirectMock).not.toHaveBeenCalled();
  });

  it("checks the rate limit keyed to this shop before validating the body", async () => {
    await POST(makeRequest({ fromUrl: "/a", toUrl: "/b", confirmed: true }));
    expect(enforceRateLimitMock).toHaveBeenCalledWith("redirects", "shop.myshopify.com", 20, 60);
  });
});

describe("GET /api/redirects", () => {
  beforeEach(() => {
    getOfflineSessionFromRequestMock.mockReset().mockResolvedValue({ shop: "shop.myshopify.com" });
    listRedirectIssuesMock.mockReset().mockResolvedValue([]);
    listHistoryMock.mockReset().mockResolvedValue([]);
  });

  it("returns 401 when unauthenticated", async () => {
    getOfflineSessionFromRequestMock.mockRejectedValue(new FakeUnauthenticatedError("no token"));
    const response = await GET(new NextRequest("https://app.example/api/redirects"));
    expect(response.status).toBe(401);
  });

  it("returns this shop's redirect issues and history", async () => {
    listRedirectIssuesMock.mockResolvedValue([{ id: "issue-1" }]);
    listHistoryMock.mockResolvedValue([{ id: "redirect-1" }]);

    const response = await GET(new NextRequest("https://app.example/api/redirects"));

    expect(await response.json()).toEqual({
      issues: [{ id: "issue-1" }],
      history: [{ id: "redirect-1" }],
    });
    expect(listRedirectIssuesMock).toHaveBeenCalledWith("shop.myshopify.com");
    expect(listHistoryMock).toHaveBeenCalledWith("shop.myshopify.com");
  });
});
