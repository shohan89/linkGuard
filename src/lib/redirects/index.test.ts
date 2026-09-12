import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@shopify/shopify-api";

const findRedirectByPathMock = vi.fn();
const createRedirectMock = vi.fn();
const getShopMock = vi.fn();
const urlRedirectCreateMock = vi.fn();
const issueFindFirstMock = vi.fn();
const resolveIssueMock = vi.fn();

vi.mock("@/lib/shopify/services/redirect.server", () => {
  class ShopifyRedirectUserError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ShopifyRedirectUserError";
    }
  }
  return {
    RedirectService: {
      findRedirectByPath: findRedirectByPathMock,
      createRedirect: createRedirectMock,
    },
    ShopifyRedirectUserError,
  };
});
vi.mock("@/lib/database/shops.server", () => ({ getShop: getShopMock }));
vi.mock("@/lib/database/client.server", () => ({
  prisma: {
    urlRedirect: { create: urlRedirectCreateMock },
    issue: { findFirst: issueFindFirstMock },
  },
}));
vi.mock("@/lib/issues/issue.server", () => ({
  IssueService: { resolveIssue: resolveIssueMock },
}));

const { detectRedirectLoop, RedirectManagementService } = await import("./index");
const { ShopifyRedirectUserError } = await import("@/lib/shopify/services/redirect.server");

const SHOP = "shop.myshopify.com";
const fakeSession = { shop: SHOP } as Session;

describe("detectRedirectLoop", () => {
  beforeEach(() => {
    findRedirectByPathMock.mockReset();
  });

  it("is not a loop when the target is external", async () => {
    const isLoop = await detectRedirectLoop(fakeSession, "/a", "https://other.example/x", SHOP);
    expect(isLoop).toBe(false);
    expect(findRedirectByPathMock).not.toHaveBeenCalled();
  });

  it("is not a loop when the target chain ends at a page with no further redirect", async () => {
    findRedirectByPathMock.mockResolvedValueOnce(null);
    const isLoop = await detectRedirectLoop(fakeSession, "/a", "/b", SHOP);
    expect(isLoop).toBe(false);
  });

  it("detects a direct loop back to the origin path", async () => {
    // /a -> /b, and /b already redirects back to /a
    findRedirectByPathMock.mockResolvedValueOnce({ id: "1", path: "/b", target: "/a" });
    const isLoop = await detectRedirectLoop(fakeSession, "/a", "/b", SHOP);
    expect(isLoop).toBe(true);
  });

  it("detects a longer chain that eventually loops", async () => {
    // /a -> /b -> /c -> /b (cycles among b/c without ever returning to a)
    findRedirectByPathMock
      .mockResolvedValueOnce({ id: "1", path: "/b", target: "/c" })
      .mockResolvedValueOnce({ id: "2", path: "/c", target: "/b" });
    const isLoop = await detectRedirectLoop(fakeSession, "/a", "/b", SHOP);
    expect(isLoop).toBe(true);
  });

  it("follows a clean multi-hop chain that terminates without looping", async () => {
    findRedirectByPathMock
      .mockResolvedValueOnce({ id: "1", path: "/b", target: "/c" })
      .mockResolvedValueOnce(null);
    const isLoop = await detectRedirectLoop(fakeSession, "/a", "/b", SHOP);
    expect(isLoop).toBe(false);
  });

  it("gives up and treats an excessively long chain as a loop rather than walking forever", async () => {
    // Every hop returns a brand-new never-before-seen path, so visited-set
    // detection never fires — only the maxDepth cap can stop this.
    let call = 0;
    findRedirectByPathMock.mockImplementation(async () => {
      call += 1;
      return { id: String(call), path: `/p${call}`, target: `/p${call + 1}` };
    });

    const isLoop = await detectRedirectLoop(fakeSession, "/a", "/b", SHOP, 5);

    expect(isLoop).toBe(true);
    expect(findRedirectByPathMock).toHaveBeenCalledTimes(5);
  });
});

describe("RedirectManagementService.createRedirect", () => {
  beforeEach(() => {
    findRedirectByPathMock.mockReset().mockResolvedValue(null);
    createRedirectMock.mockReset();
    getShopMock.mockReset().mockResolvedValue({ id: "shop-1" });
    urlRedirectCreateMock.mockReset().mockResolvedValue(undefined);
    issueFindFirstMock.mockReset().mockResolvedValue({ id: "issue-1" });
    resolveIssueMock.mockReset().mockResolvedValue(undefined);
  });

  it("refuses to run without explicit confirmation", async () => {
    const result = await RedirectManagementService.createRedirect({
      session: fakeSession,
      shopDomain: SHOP,
      fromUrl: "/a",
      toUrl: "/b",
      confirmed: false,
    });

    expect(result).toEqual({
      ok: false,
      error: "Merchant confirmation is required before creating a redirect",
    });
    expect(createRedirectMock).not.toHaveBeenCalled();
  });

  it("refuses invalid URLs before touching Shopify", async () => {
    const result = await RedirectManagementService.createRedirect({
      session: fakeSession,
      shopDomain: SHOP,
      fromUrl: "/same",
      toUrl: "/same",
      confirmed: true,
    });

    expect(result.ok).toBe(false);
    expect(findRedirectByPathMock).not.toHaveBeenCalled();
  });

  it("refuses when the old URL already has a redirect", async () => {
    findRedirectByPathMock.mockResolvedValueOnce({ id: "1", path: "/a", target: "/existing" });

    const result = await RedirectManagementService.createRedirect({
      session: fakeSession,
      shopDomain: SHOP,
      fromUrl: "/a",
      toUrl: "/b",
      confirmed: true,
    });

    expect(result).toEqual({
      ok: false,
      error: "/a already redirects to /existing",
    });
    expect(createRedirectMock).not.toHaveBeenCalled();
  });

  it("refuses when the redirect would create a loop", async () => {
    findRedirectByPathMock
      .mockResolvedValueOnce(null) // no existing redirect from /a
      .mockResolvedValueOnce({ id: "1", path: "/b", target: "/a" }); // /b -> /a: loop

    const result = await RedirectManagementService.createRedirect({
      session: fakeSession,
      shopDomain: SHOP,
      fromUrl: "/a",
      toUrl: "/b",
      confirmed: true,
    });

    expect(result).toEqual({ ok: false, error: "This redirect would create a loop" });
    expect(createRedirectMock).not.toHaveBeenCalled();
  });

  it("creates the redirect, saves history, and resolves the linked issue on success", async () => {
    createRedirectMock.mockResolvedValue({ id: "gid://shopify/UrlRedirect/1", path: "/a", target: "/b" });

    const result = await RedirectManagementService.createRedirect({
      session: fakeSession,
      shopDomain: SHOP,
      fromUrl: "/a",
      toUrl: "/b",
      confirmed: true,
      issueId: "issue-1",
    });

    expect(result).toEqual({
      ok: true,
      redirect: { id: "gid://shopify/UrlRedirect/1", fromPath: "/a", toTarget: "/b" },
    });
    expect(urlRedirectCreateMock).toHaveBeenCalledWith({
      data: {
        shopId: "shop-1",
        issueId: "issue-1",
        fromPath: "/a",
        toTarget: "/b",
        shopifyRedirectId: "gid://shopify/UrlRedirect/1",
      },
    });
    expect(issueFindFirstMock).toHaveBeenCalledWith({
      where: { id: "issue-1", shopId: "shop-1" },
      select: { id: true },
    });
    expect(resolveIssueMock).toHaveBeenCalledWith("issue-1", "shop-1");
  });

  it("rejects an issueId that doesn't belong to this shop, before touching Shopify", async () => {
    issueFindFirstMock.mockResolvedValue(null);

    const result = await RedirectManagementService.createRedirect({
      session: fakeSession,
      shopDomain: SHOP,
      fromUrl: "/a",
      toUrl: "/b",
      confirmed: true,
      issueId: "someone-elses-issue",
    });

    expect(result).toEqual({ ok: false, error: "Issue not found" });
    expect(createRedirectMock).not.toHaveBeenCalled();
    expect(urlRedirectCreateMock).not.toHaveBeenCalled();
    expect(resolveIssueMock).not.toHaveBeenCalled();
  });

  it("does not try to resolve an issue when none was given", async () => {
    createRedirectMock.mockResolvedValue({ id: "gid://1", path: "/a", target: "/b" });

    await RedirectManagementService.createRedirect({
      session: fakeSession,
      shopDomain: SHOP,
      fromUrl: "/a",
      toUrl: "/b",
      confirmed: true,
    });

    expect(resolveIssueMock).not.toHaveBeenCalled();
  });

  it("surfaces a Shopify user error (e.g. duplicate path) as a friendly message", async () => {
    createRedirectMock.mockRejectedValue(new ShopifyRedirectUserError("Path has already been taken"));

    const result = await RedirectManagementService.createRedirect({
      session: fakeSession,
      shopDomain: SHOP,
      fromUrl: "/a",
      toUrl: "/b",
      confirmed: true,
    });

    expect(result).toEqual({ ok: false, error: "Path has already been taken" });
  });

  it("surfaces an unexpected error generically without leaking internals", async () => {
    createRedirectMock.mockRejectedValue(new Error("ECONNRESET"));

    const result = await RedirectManagementService.createRedirect({
      session: fakeSession,
      shopDomain: SHOP,
      fromUrl: "/a",
      toUrl: "/b",
      confirmed: true,
    });

    expect(result).toEqual({ ok: false, error: "Failed to create the redirect on Shopify" });
  });
});
