import { describe, expect, it, vi } from "vitest";
import type { Session } from "@shopify/shopify-api";

const runAdminQueryMock = vi.fn();

vi.mock("@/lib/shopify/admin.server", () => ({
  runAdminQuery: runAdminQueryMock,
}));

const { ProductService } = await import("./product.server");

const fakeSession = { shop: "test-shop.myshopify.com" } as Session;

describe("ProductService.listProducts", () => {
  it("flattens the connection and defaults first to 50", async () => {
    runAdminQueryMock.mockResolvedValue({
      products: {
        edges: [
          {
            node: {
              id: "gid://shopify/Product/1",
              title: "Snowboard",
              handle: "snowboard",
              status: "ACTIVE",
              onlineStoreUrl: "https://test-shop.example/products/snowboard",
              updatedAt: "2026-01-01T00:00:00Z",
            },
          },
        ],
        pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
      },
    });

    const result = await ProductService.listProducts(fakeSession);

    expect(result).toEqual({
      products: [
        {
          id: "gid://shopify/Product/1",
          title: "Snowboard",
          handle: "snowboard",
          status: "ACTIVE",
          onlineStoreUrl: "https://test-shop.example/products/snowboard",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      hasNextPage: true,
      endCursor: "cursor-1",
    });
    expect(runAdminQueryMock).toHaveBeenCalledWith(
      fakeSession,
      expect.stringContaining("query Products"),
      { first: 50, after: null },
    );
  });

  it("passes through pagination options", async () => {
    runAdminQueryMock.mockResolvedValue({
      products: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } },
    });

    await ProductService.listProducts(fakeSession, { first: 10, after: "cursor-1" });

    expect(runAdminQueryMock).toHaveBeenCalledWith(
      fakeSession,
      expect.any(String),
      { first: 10, after: "cursor-1" },
    );
  });

  it("lets rate-limit / API errors propagate to the caller", async () => {
    const error = Object.assign(new Error("rate limited"), {
      name: "ShopifyApiError",
      kind: "rate_limited",
    });
    runAdminQueryMock.mockRejectedValue(error);

    await expect(ProductService.listProducts(fakeSession)).rejects.toBe(error);
  });
});
