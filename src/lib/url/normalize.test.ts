import { describe, expect, it } from "vitest";
import { normalizeUrl, isInternalUrl } from "./normalize";

describe("normalizeUrl", () => {
  it("resolves a relative URL against the base", () => {
    expect(normalizeUrl("/products/foo", "https://shop.example")).toBe(
      "https://shop.example/products/foo",
    );
  });

  it("lowercases scheme and host but not the path", () => {
    expect(normalizeUrl("HTTPS://Shop.Example/Products/Foo", "https://shop.example")).toBe(
      "https://shop.example/Products/Foo",
    );
  });

  it("strips the fragment", () => {
    expect(normalizeUrl("https://shop.example/page#section", "https://shop.example")).toBe(
      "https://shop.example/page",
    );
  });

  it("strips default ports", () => {
    expect(normalizeUrl("https://shop.example:443/page", "https://shop.example")).toBe(
      "https://shop.example/page",
    );
    expect(normalizeUrl("http://shop.example:80/page", "http://shop.example")).toBe(
      "http://shop.example/page",
    );
  });

  it("strips a trailing slash except on the root", () => {
    expect(normalizeUrl("https://shop.example/page/", "https://shop.example")).toBe(
      "https://shop.example/page",
    );
    expect(normalizeUrl("https://shop.example/", "https://shop.example")).toBe(
      "https://shop.example/",
    );
  });

  it("sorts query params so order doesn't affect dedup", () => {
    const a = normalizeUrl("https://shop.example/p?b=2&a=1", "https://shop.example");
    const b = normalizeUrl("https://shop.example/p?a=1&b=2", "https://shop.example");
    expect(a).toBe(b);
  });

  it("rejects non-http(s) schemes", () => {
    expect(normalizeUrl("mailto:hi@shop.example", "https://shop.example")).toBeNull();
    expect(normalizeUrl("tel:+15551234567", "https://shop.example")).toBeNull();
    expect(normalizeUrl("javascript:void(0)", "https://shop.example")).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(normalizeUrl("not a url at all", "not a base either")).toBeNull();
  });
});

describe("isInternalUrl", () => {
  it("is true for a URL on the shop's own host", () => {
    expect(isInternalUrl("https://shop.example/page", "shop.example")).toBe(true);
  });

  it("is case-insensitive on the host", () => {
    expect(isInternalUrl("https://Shop.Example/page", "shop.example")).toBe(true);
  });

  it("is false for a different host", () => {
    expect(isInternalUrl("https://other.example/page", "shop.example")).toBe(false);
  });

  it("is false for an unparseable URL", () => {
    expect(isInternalUrl("not a url", "shop.example")).toBe(false);
  });
});
