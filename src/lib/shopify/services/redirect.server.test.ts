import { describe, expect, it, vi } from "vitest";
import type { Session } from "@shopify/shopify-api";

const runAdminQueryMock = vi.fn();

vi.mock("@/lib/shopify/admin.server", () => ({ runAdminQuery: runAdminQueryMock }));

const { RedirectService, ShopifyRedirectUserError } = await import("./redirect.server");

const fakeSession = { shop: "shop.myshopify.com" } as Session;

describe("RedirectService.findRedirectByPath", () => {
  it("returns the matching redirect", async () => {
    runAdminQueryMock.mockReset().mockResolvedValue({
      urlRedirects: { edges: [{ node: { id: "1", path: "/a", target: "/b" } }] },
    });

    const result = await RedirectService.findRedirectByPath(fakeSession, "/a");

    expect(result).toEqual({ id: "1", path: "/a", target: "/b" });
    expect(runAdminQueryMock).toHaveBeenCalledWith(
      fakeSession,
      expect.any(String),
      { query: "path:/a" },
    );
  });

  it("returns null when nothing matches", async () => {
    runAdminQueryMock.mockReset().mockResolvedValue({ urlRedirects: { edges: [] } });
    expect(await RedirectService.findRedirectByPath(fakeSession, "/nope")).toBeNull();
  });
});

describe("RedirectService.createRedirect", () => {
  it("returns the created redirect on success", async () => {
    runAdminQueryMock.mockReset().mockResolvedValue({
      urlRedirectCreate: {
        urlRedirect: { id: "1", path: "/a", target: "/b" },
        userErrors: [],
      },
    });

    const result = await RedirectService.createRedirect(fakeSession, {
      path: "/a",
      target: "/b",
    });

    expect(result).toEqual({ id: "1", path: "/a", target: "/b" });
  });

  it("throws ShopifyRedirectUserError when Shopify reports a userError", async () => {
    runAdminQueryMock.mockReset().mockResolvedValue({
      urlRedirectCreate: {
        urlRedirect: null,
        userErrors: [{ field: ["path"], message: "Path has already been taken" }],
      },
    });

    await expect(
      RedirectService.createRedirect(fakeSession, { path: "/a", target: "/b" }),
    ).rejects.toThrow(ShopifyRedirectUserError);
  });

  it("throws when Shopify returns no redirect and no userErrors", async () => {
    runAdminQueryMock.mockReset().mockResolvedValue({
      urlRedirectCreate: { urlRedirect: null, userErrors: [] },
    });

    await expect(
      RedirectService.createRedirect(fakeSession, { path: "/a", target: "/b" }),
    ).rejects.toThrow(ShopifyRedirectUserError);
  });
});
