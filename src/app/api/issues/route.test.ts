import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getOfflineSessionFromRequestMock = vi.fn();
const listOpenIssuesMock = vi.fn();

class FakeUnauthenticatedError extends Error {}

vi.mock("@/lib/shopify/session.server", () => ({
  getOfflineSessionFromRequest: getOfflineSessionFromRequestMock,
  UnauthenticatedError: FakeUnauthenticatedError,
}));
vi.mock("@/lib/issues/issue.server", () => ({
  IssueService: { listOpenIssues: listOpenIssuesMock },
}));

const { GET } = await import("./route");

describe("GET /api/issues", () => {
  beforeEach(() => {
    getOfflineSessionFromRequestMock.mockReset().mockResolvedValue({ shop: "shop.myshopify.com" });
    listOpenIssuesMock.mockReset().mockResolvedValue([]);
  });

  it("returns 401 when unauthenticated", async () => {
    getOfflineSessionFromRequestMock.mockRejectedValue(new FakeUnauthenticatedError("no token"));
    const response = await GET(new NextRequest("https://app.example/api/issues"));
    expect(response.status).toBe(401);
  });

  it("returns this shop's open issues, keyed off the verified session", async () => {
    listOpenIssuesMock.mockResolvedValue([{ id: "issue-1" }]);
    const response = await GET(new NextRequest("https://app.example/api/issues?shop=someone-else.myshopify.com"));
    expect(await response.json()).toEqual([{ id: "issue-1" }]);
    expect(listOpenIssuesMock).toHaveBeenCalledWith("shop.myshopify.com");
  });
});
