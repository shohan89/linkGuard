import { describe, expect, it } from "vitest";
import { validateRedirectUrls } from "./index";

const SHOP = "shop.myshopify.com";

describe("validateRedirectUrls", () => {
  it("accepts two plain paths", () => {
    const result = validateRedirectUrls("/old-page", "/new-page", SHOP);
    expect(result).toEqual({
      valid: true,
      urls: { fromPath: "/old-page", toTarget: "/new-page" },
    });
  });

  it("adds a leading slash when missing", () => {
    const result = validateRedirectUrls("old-page", "new-page", SHOP);
    expect(result).toEqual({
      valid: true,
      urls: { fromPath: "/old-page", toTarget: "/new-page" },
    });
  });

  it("resolves an absolute old-URL on the shop's own domain to its path", () => {
    const result = validateRedirectUrls(
      `https://${SHOP}/old-page`,
      "/new-page",
      SHOP,
    );
    expect(result).toEqual({
      valid: true,
      urls: { fromPath: "/old-page", toTarget: "/new-page" },
    });
  });

  it("resolves an absolute new-URL on the shop's own domain to its path", () => {
    const result = validateRedirectUrls(
      "/old-page",
      `https://${SHOP}/new-page`,
      SHOP,
    );
    expect(result).toEqual({
      valid: true,
      urls: { fromPath: "/old-page", toTarget: "/new-page" },
    });
  });

  it("keeps an external new-URL as a full URL", () => {
    const result = validateRedirectUrls("/old-page", "https://other.example/page", SHOP);
    expect(result).toEqual({
      valid: true,
      urls: { fromPath: "/old-page", toTarget: "https://other.example/page" },
    });
  });

  it("rejects an empty old URL", () => {
    const result = validateRedirectUrls("  ", "/new-page", SHOP);
    expect(result).toMatchObject({ valid: false, error: "EMPTY_FROM_URL" });
  });

  it("rejects an empty new URL", () => {
    const result = validateRedirectUrls("/old-page", "  ", SHOP);
    expect(result).toMatchObject({ valid: false, error: "EMPTY_TO_URL" });
  });

  it("rejects an old URL on a different domain — you can't redirect a path you don't own", () => {
    const result = validateRedirectUrls(
      "https://someone-elses-store.myshopify.com/page",
      "/new-page",
      SHOP,
    );
    expect(result).toMatchObject({ valid: false, error: "FROM_URL_WRONG_DOMAIN" });
  });

  it("rejects a new URL with a non-http(s) scheme", () => {
    const result = validateRedirectUrls("/old-page", "javascript:alert(1)", SHOP);
    expect(result).toMatchObject({ valid: false, error: "TO_URL_INVALID" });
  });

  it("rejects identical old and new URLs (the trivial 1-hop loop)", () => {
    const result = validateRedirectUrls("/same-page", "/same-page", SHOP);
    expect(result).toMatchObject({ valid: false, error: "SAME_URL" });
  });

  it("treats a trailing slash as the same path when checking for a self-loop", () => {
    const result = validateRedirectUrls("/same-page", "/same-page/", SHOP);
    expect(result).toMatchObject({ valid: false, error: "SAME_URL" });
  });

  it("rejects an old URL longer than 2048 characters", () => {
    const result = validateRedirectUrls(`/${"a".repeat(2048)}`, "/new-page", SHOP);
    expect(result).toMatchObject({ valid: false, error: "FROM_URL_TOO_LONG" });
  });

  it("rejects a new URL longer than 2048 characters", () => {
    const result = validateRedirectUrls("/old-page", `/${"a".repeat(2048)}`, SHOP);
    expect(result).toMatchObject({ valid: false, error: "TO_URL_TOO_LONG" });
  });

  it("is case-insensitive when matching the shop domain", () => {
    const result = validateRedirectUrls(
      `https://${SHOP.toUpperCase()}/old-page`,
      "/new-page",
      SHOP,
    );
    expect(result.valid).toBe(true);
  });
});
