import { describe, expect, it, vi } from "vitest";
import type { Session } from "@shopify/shopify-api";

const runAdminQueryMock = vi.fn();

vi.mock("@/lib/shopify/admin.server", () => ({
  runAdminQuery: runAdminQueryMock,
}));

const { ShopService } = await import("./shop.server");

const fakeSession = { shop: "test-shop.myshopify.com" } as Session;

describe("ShopService.getShopInfo", () => {
  it("maps the GraphQL response into a flat ShopInfo", async () => {
    runAdminQueryMock.mockResolvedValue({
      shop: {
        id: "gid://shopify/Shop/1",
        name: "Test Shop",
        myshopifyDomain: "test-shop.myshopify.com",
        email: "owner@test-shop.example",
        currencyCode: "USD",
        primaryDomain: { url: "https://test-shop.example" },
        plan: { displayName: "Basic", partnerDevelopment: false },
      },
    });

    const result = await ShopService.getShopInfo(fakeSession);

    expect(result).toEqual({
      id: "gid://shopify/Shop/1",
      name: "Test Shop",
      myshopifyDomain: "test-shop.myshopify.com",
      email: "owner@test-shop.example",
      currencyCode: "USD",
      primaryDomainUrl: "https://test-shop.example",
      planDisplayName: "Basic",
      isDevelopmentStore: false,
    });
    expect(runAdminQueryMock).toHaveBeenCalledWith(
      fakeSession,
      expect.stringContaining("query ShopInfo"),
    );
  });

  it("flags partner development stores", async () => {
    runAdminQueryMock.mockResolvedValue({
      shop: {
        id: "gid://shopify/Shop/2",
        name: "Dev Shop",
        myshopifyDomain: "dev.myshopify.com",
        email: "dev@example.com",
        currencyCode: "USD",
        primaryDomain: { url: "https://dev.example" },
        plan: { displayName: "Basic App Development", partnerDevelopment: true },
      },
    });

    expect((await ShopService.getShopInfo(fakeSession)).isDevelopmentStore).toBe(true);
  });

  it("propagates errors from the shared client unchanged", async () => {
    const error = new Error("boom");
    runAdminQueryMock.mockRejectedValue(error);

    await expect(ShopService.getShopInfo(fakeSession)).rejects.toBe(error);
  });
});
