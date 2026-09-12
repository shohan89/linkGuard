import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Session } from "@shopify/shopify-api";
import { shopify, sessionStorage } from "@/lib/shopify/client.server";
import { markShopInstalled } from "@/lib/database/shops.server";
import { getOfflineSessionFromRequest, UnauthenticatedError } from "@/lib/shopify/session.server";
import {
  cleanupShop,
  requireEnv,
  signRealSessionToken,
  uniqueShopDomain,
} from "@/lib/test-support/integration.server";

/**
 * Exercises the real cryptographic verification path — real
 * jose.jwtVerify inside @shopify/shopify-api, using the app's real
 * SHOPIFY_API_SECRET — instead of the mocked decodeSessionToken the unit
 * suite uses. This is what actually proves a forged/expired/wrong-audience
 * bearer token gets rejected, not just that our code calls a mock a
 * certain way.
 */
describe("Authentication (real session-token verification)", () => {
  const shopDomain = uniqueShopDomain("auth");
  const apiKey = requireEnv("SHOPIFY_API_KEY");
  const apiSecret = requireEnv("SHOPIFY_API_SECRET");

  beforeAll(async () => {
    await markShopInstalled(shopDomain);
    const offlineId = shopify.session.getOfflineId(shopDomain);
    await sessionStorage.storeSession(
      new Session({
        id: offlineId,
        shop: shopDomain,
        state: "test-state",
        isOnline: false,
        accessToken: "shpat_test_token_value",
      }),
    );
  });

  afterAll(async () => {
    await cleanupShop(shopDomain);
  });

  function requestWithToken(token: string): Request {
    return new Request("https://app.example/api/whatever", {
      headers: { authorization: `Bearer ${token}` },
    });
  }

  it("accepts a genuinely valid, correctly-signed token for a shop with a stored session", async () => {
    const token = await signRealSessionToken({ shop: shopDomain, apiKey, apiSecret });
    const session = await getOfflineSessionFromRequest(requestWithToken(token));
    expect(session.shop).toBe(shopDomain);
    expect(session.accessToken).toBe("shpat_test_token_value");
  });

  it("rejects a token signed with the wrong secret (forged)", async () => {
    const token = await signRealSessionToken({
      shop: shopDomain,
      apiKey,
      apiSecret: "not-the-real-secret-at-all",
    });
    await expect(getOfflineSessionFromRequest(requestWithToken(token))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("rejects an expired token", async () => {
    const token = await signRealSessionToken({
      shop: shopDomain,
      apiKey,
      apiSecret,
      overrides: { exp: Math.floor(Date.now() / 1000) - 3600, nbf: Math.floor(Date.now() / 1000) - 7200 },
    });
    await expect(getOfflineSessionFromRequest(requestWithToken(token))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("rejects a token issued for a different app (wrong audience)", async () => {
    const token = await signRealSessionToken({
      shop: shopDomain,
      apiKey: "some-other-app-client-id",
      apiSecret,
    });
    await expect(getOfflineSessionFromRequest(requestWithToken(token))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("rejects a structurally tampered token (flipped payload byte)", async () => {
    const token = await signRealSessionToken({ shop: shopDomain, apiKey, apiSecret });
    const parts = token.split(".");
    // Flip the last character of the payload segment — breaks the
    // signature verification without producing malformed base64url.
    const payload = parts[1];
    const lastChar = payload.at(-1);
    parts[1] = payload.slice(0, -1) + (lastChar === "A" ? "B" : "A");
    const tampered = parts.join(".");

    await expect(getOfflineSessionFromRequest(requestWithToken(tampered))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("rejects a valid token for a shop with no stored offline session", async () => {
    const ghostShop = uniqueShopDomain("auth-no-session");
    const token = await signRealSessionToken({ shop: ghostShop, apiKey, apiSecret });
    await expect(getOfflineSessionFromRequest(requestWithToken(token))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("rejects a request with no Authorization header at all", async () => {
    await expect(
      getOfflineSessionFromRequest(new Request("https://app.example/api/whatever")),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});
