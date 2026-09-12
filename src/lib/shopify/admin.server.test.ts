import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GraphqlQueryError,
  HttpResponseError,
  HttpThrottlingError,
} from "@shopify/shopify-api";
import type { Session } from "@shopify/shopify-api";

const requestMock = vi.fn();

vi.mock("@/lib/shopify/client.server", () => ({
  shopify: {
    clients: {
      // Arrow functions aren't constructible — `new shopify.clients.Graphql()`
      // in admin.server.ts requires a real function here.
      Graphql: vi.fn().mockImplementation(function GraphqlMock() {
        return { request: requestMock };
      }),
    },
  },
}));

const { runAdminQuery } = await import("./admin.server");

const fakeSession = {
  shop: "test-shop.myshopify.com",
  accessToken: "shpat_fake",
} as Session;

describe("runAdminQuery", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("returns the response data on success", async () => {
    requestMock.mockResolvedValue({
      data: { shop: { name: "Test Shop" } },
      headers: {},
    });

    const result = await runAdminQuery(fakeSession, "query { shop { name } }");

    expect(result).toEqual({ shop: { name: "Test Shop" } });
  });

  it("throws graphql_error when the response has no data", async () => {
    requestMock.mockResolvedValue({ data: undefined, headers: {} });

    await expect(runAdminQuery(fakeSession, "query")).rejects.toMatchObject({
      name: "ShopifyApiError",
      kind: "graphql_error",
    });
  });

  it("normalizes a GraphQL-level error (bad query, e.g. unknown field)", async () => {
    requestMock.mockRejectedValue(
      new GraphqlQueryError({
        message: "Field 'foo' doesn't exist on type 'Shop'",
        response: {},
      }),
    );

    await expect(runAdminQuery(fakeSession, "query")).rejects.toMatchObject({
      name: "ShopifyApiError",
      kind: "graphql_error",
      message: "Field 'foo' doesn't exist on type 'Shop'",
    });
  });

  it("normalizes rate limiting with retry-after", async () => {
    requestMock.mockRejectedValue(
      new HttpThrottlingError({
        message: "Shopify is throttling requests",
        code: 429,
        statusText: "Too Many Requests",
        retryAfter: 2,
      }),
    );

    await expect(runAdminQuery(fakeSession, "query")).rejects.toMatchObject({
      kind: "rate_limited",
      statusCode: 429,
      retryAfterSeconds: 2,
    });
  });

  it("normalizes a generic HTTP error", async () => {
    requestMock.mockRejectedValue(
      new HttpResponseError({
        message: "Internal Server Error",
        code: 500,
        statusText: "Internal Server Error",
      }),
    );

    await expect(runAdminQuery(fakeSession, "query")).rejects.toMatchObject({
      kind: "http_error",
      statusCode: 500,
    });
  });

  it("normalizes an unexpected non-Shopify error", async () => {
    requestMock.mockRejectedValue(new Error("ECONNRESET"));

    await expect(runAdminQuery(fakeSession, "query")).rejects.toMatchObject({
      name: "ShopifyApiError",
      kind: "unknown",
    });
  });
});
