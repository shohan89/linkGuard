import { describe, expect, it, vi } from "vitest";

const sanitizeShopMock = vi.fn();
vi.mock("@/lib/shopify/client.server", () => ({
  shopify: { utils: { sanitizeShop: sanitizeShopMock } },
}));

const { guardEmbeddedShop } = await import("./guard-embedded-shop");

describe("guardEmbeddedShop", () => {
  it("rejects when there's no shop param at all", () => {
    sanitizeShopMock.mockReturnValue(null);
    expect(guardEmbeddedShop({})).toEqual({ ok: false });
  });

  it("rejects a malformed shop domain", () => {
    sanitizeShopMock.mockReturnValue(null);
    expect(guardEmbeddedShop({ shop: "not a real domain" })).toEqual({ ok: false });
  });

  it("accepts a well-formed shop domain without touching any session store", () => {
    sanitizeShopMock.mockReturnValue("shop.myshopify.com");
    const result = guardEmbeddedShop({ shop: "shop.myshopify.com" });
    expect(result).toEqual({ ok: true, shop: "shop.myshopify.com" });
  });

  it("never trusts multiple shop values (array) — only a single string param", () => {
    sanitizeShopMock.mockReturnValue(null);
    guardEmbeddedShop({ shop: ["a.myshopify.com", "b.myshopify.com"] });
    expect(sanitizeShopMock).toHaveBeenCalledWith("", false);
  });
});
