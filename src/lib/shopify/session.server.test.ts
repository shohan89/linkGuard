import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpResponseError } from "@shopify/shopify-api";

const decodeSessionTokenMock = vi.fn();
const getOfflineIdMock = vi.fn((shop: string) => `offline_${shop}`);
const loadSessionMock = vi.fn();
const storeSessionMock = vi.fn();
const refreshTokenMock = vi.fn();
const migrateToExpiringTokenMock = vi.fn();
const withShopLockMock = vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn());

vi.mock("@/lib/shopify/client.server", () => ({
  shopify: {
    session: { decodeSessionToken: decodeSessionTokenMock, getOfflineId: getOfflineIdMock },
    auth: { refreshToken: refreshTokenMock, migrateToExpiringToken: migrateToExpiringTokenMock },
  },
  sessionStorage: { loadSession: loadSessionMock, storeSession: storeSessionMock },
}));
vi.mock("@/lib/shopify/session-lock.server", () => ({ withShopLock: withShopLockMock }));

const { getOfflineSessionFromRequest, loadOfflineSessionForShop, UnauthenticatedError } =
  await import("./session.server");

const HOUR_MS = 60 * 60 * 1000;

function freshSession(overrides: Record<string, unknown> = {}) {
  return {
    shop: "shop.myshopify.com",
    accessToken: "tok",
    expires: new Date(Date.now() + HOUR_MS),
    refreshToken: "refresh-1",
    refreshTokenExpires: new Date(Date.now() + 24 * HOUR_MS),
    ...overrides,
  };
}

function makeRequest(authHeader?: string) {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new Request("https://app.example/api/whatever", { headers });
}

describe("getOfflineSessionFromRequest", () => {
  beforeEach(() => {
    decodeSessionTokenMock.mockReset();
    loadSessionMock.mockReset();
  });

  it("rejects a request with no Authorization header", async () => {
    await expect(getOfflineSessionFromRequest(makeRequest())).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(decodeSessionTokenMock).not.toHaveBeenCalled();
  });

  it("rejects a header that isn't a Bearer token", async () => {
    await expect(
      getOfflineSessionFromRequest(makeRequest("Basic dXNlcjpwYXNz")),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects an invalid/expired/tampered token with 401-shaped error, not a raw throw", async () => {
    decodeSessionTokenMock.mockRejectedValue(new Error("Invalid JWT signature"));
    await expect(
      getOfflineSessionFromRequest(makeRequest("Bearer garbage")),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("rejects when the token is valid but no offline session is stored for that shop", async () => {
    decodeSessionTokenMock.mockResolvedValue({ dest: "https://shop.myshopify.com" });
    loadSessionMock.mockResolvedValue(undefined);
    await expect(
      getOfflineSessionFromRequest(makeRequest("Bearer valid-token")),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("returns the offline session for a valid token with a stored session", async () => {
    decodeSessionTokenMock.mockResolvedValue({ dest: "https://shop.myshopify.com" });
    const stored = freshSession();
    loadSessionMock.mockResolvedValue(stored);

    const session = await getOfflineSessionFromRequest(makeRequest("Bearer valid-token"));

    expect(session).toEqual(stored);
  });
});

describe("loadOfflineSessionForShop", () => {
  beforeEach(() => {
    loadSessionMock.mockReset();
    storeSessionMock.mockReset().mockResolvedValue(true);
    refreshTokenMock.mockReset();
    migrateToExpiringTokenMock.mockReset();
    withShopLockMock.mockClear();
  });

  it("returns undefined when there's no stored session", async () => {
    loadSessionMock.mockResolvedValue(undefined);
    expect(await loadOfflineSessionForShop("shop.myshopify.com")).toBeUndefined();
  });

  it("returns undefined when the stored session has no access token", async () => {
    loadSessionMock.mockResolvedValue({ shop: "shop.myshopify.com" });
    expect(await loadOfflineSessionForShop("shop.myshopify.com")).toBeUndefined();
  });

  it("returns a still-fresh session as-is, without locking or calling Shopify", async () => {
    const stored = freshSession();
    loadSessionMock.mockResolvedValue(stored);

    expect(await loadOfflineSessionForShop("shop.myshopify.com")).toEqual(stored);
    expect(withShopLockMock).not.toHaveBeenCalled();
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });

  it("refreshes a session that's within the renewal margin and stores the result", async () => {
    const nearExpiry = freshSession({ expires: new Date(Date.now() + 60_000) });
    const renewed = freshSession({ accessToken: "tok-2", refreshToken: "refresh-2" });
    loadSessionMock.mockResolvedValue(nearExpiry);
    refreshTokenMock.mockResolvedValue({ session: renewed });

    const result = await loadOfflineSessionForShop("shop.myshopify.com");

    expect(refreshTokenMock).toHaveBeenCalledWith({
      shop: "shop.myshopify.com",
      refreshToken: "refresh-1",
    });
    expect(storeSessionMock).toHaveBeenCalledWith(renewed);
    expect(result).toEqual(renewed);
  });

  it("refreshes an already-expired session", async () => {
    const expired = freshSession({ expires: new Date(Date.now() - 1000) });
    const renewed = freshSession({ accessToken: "tok-2" });
    loadSessionMock.mockResolvedValue(expired);
    refreshTokenMock.mockResolvedValue({ session: renewed });

    expect(await loadOfflineSessionForShop("shop.myshopify.com")).toEqual(renewed);
  });

  it("migrates a legacy non-expiring token (no expires) instead of refreshing", async () => {
    const legacy = { shop: "shop.myshopify.com", accessToken: "legacy-tok" };
    const migrated = freshSession({ accessToken: "new-tok" });
    loadSessionMock.mockResolvedValue(legacy);
    migrateToExpiringTokenMock.mockResolvedValue({ session: migrated });

    const result = await loadOfflineSessionForShop("shop.myshopify.com");

    expect(migrateToExpiringTokenMock).toHaveBeenCalledWith({
      shop: "shop.myshopify.com",
      nonExpiringOfflineAccessToken: "legacy-tok",
    });
    expect(refreshTokenMock).not.toHaveBeenCalled();
    expect(storeSessionMock).toHaveBeenCalledWith(migrated);
    expect(result).toEqual(migrated);
  });

  it("uses the session another process renewed while this one waited for the lock", async () => {
    const nearExpiry = freshSession({ expires: new Date(Date.now() + 60_000) });
    const alreadyRenewed = freshSession({ accessToken: "renewed-by-other" });
    loadSessionMock
      .mockResolvedValueOnce(nearExpiry) // initial read, outside the lock
      .mockResolvedValueOnce(alreadyRenewed); // re-read inside the lock

    const result = await loadOfflineSessionForShop("shop.myshopify.com");

    expect(result).toEqual(alreadyRenewed);
    expect(refreshTokenMock).not.toHaveBeenCalled();
    expect(storeSessionMock).not.toHaveBeenCalled();
  });

  it("returns undefined (forcing re-auth) when the refresh token itself has expired", async () => {
    const stale = freshSession({
      expires: new Date(Date.now() - 1000),
      refreshTokenExpires: new Date(Date.now() - 1000),
    });
    loadSessionMock.mockResolvedValue(stale);

    expect(await loadOfflineSessionForShop("shop.myshopify.com")).toBeUndefined();
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });

  it("returns undefined when there's no refresh token to use", async () => {
    loadSessionMock.mockResolvedValue(
      freshSession({ expires: new Date(Date.now() - 1000), refreshToken: undefined }),
    );
    expect(await loadOfflineSessionForShop("shop.myshopify.com")).toBeUndefined();
  });

  it("returns undefined when Shopify rejects the refresh (revoked/invalid), without storing anything", async () => {
    loadSessionMock.mockResolvedValue(freshSession({ expires: new Date(Date.now() - 1000) }));
    refreshTokenMock.mockRejectedValue(
      new HttpResponseError({
        message: "invalid_grant",
        code: 400,
        statusText: "Bad Request",
        body: {},
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await loadOfflineSessionForShop("shop.myshopify.com")).toBeUndefined();
    expect(storeSessionMock).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("rethrows non-HTTP failures (e.g. network) instead of silently forcing re-auth", async () => {
    loadSessionMock.mockResolvedValue(freshSession({ expires: new Date(Date.now() - 1000) }));
    refreshTokenMock.mockRejectedValue(new Error("ECONNRESET"));

    await expect(loadOfflineSessionForShop("shop.myshopify.com")).rejects.toThrow("ECONNRESET");
  });
});
