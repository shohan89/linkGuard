import { describe, expect, it, vi } from "vitest";
import type { Session } from "@shopify/shopify-api";

const runAdminQueryMock = vi.fn();

vi.mock("@/lib/shopify/admin.server", () => ({
  runAdminQuery: runAdminQueryMock,
}));

const { CollectionService } = await import("./collection.server");

const fakeSession = { shop: "test-shop.myshopify.com" } as Session;

describe("CollectionService.listCollections", () => {
  it("flattens the connection", async () => {
    runAdminQueryMock.mockResolvedValue({
      collections: {
        edges: [
          {
            node: {
              id: "gid://shopify/Collection/1",
              title: "Frontpage",
              handle: "frontpage",
              updatedAt: "2026-01-01T00:00:00Z",
            },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const result = await CollectionService.listCollections(fakeSession);

    expect(result).toEqual({
      collections: [
        {
          id: "gid://shopify/Collection/1",
          title: "Frontpage",
          handle: "frontpage",
          updatedAt: "2026-01-01T00:00:00Z",
        },
      ],
      hasNextPage: false,
      endCursor: null,
    });
  });

  it("propagates GraphQL errors (e.g. an invalid field) to the caller", async () => {
    const error = Object.assign(new Error("Field doesn't exist"), {
      name: "ShopifyApiError",
      kind: "graphql_error",
    });
    runAdminQueryMock.mockRejectedValue(error);

    await expect(CollectionService.listCollections(fakeSession)).rejects.toBe(
      error,
    );
  });
});
