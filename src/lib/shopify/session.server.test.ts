import { beforeEach, describe, expect, it, vi } from "vitest";

const decodeSessionTokenMock = vi.fn();
const getOfflineIdMock = vi.fn((shop: string) => `offline_${shop}`);
const loadSessionMock = vi.fn();

vi.mock("@/lib/shopify/client.server", () => ({
  shopify: {
    session: { decodeSessionToken: decodeSessionTokenMock, getOfflineId: getOfflineIdMock },
  },
  sessionStorage: { loadSession: loadSessionMock },
}));

const { getOfflineSessionFromRequest, loadOfflineSessionForShop, UnauthenticatedError } =
  await import("./session.server");

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
    loadSessionMock.mockResolvedValue({ shop: "shop.myshopify.com", accessToken: "tok" });

    const session = await getOfflineSessionFromRequest(makeRequest("Bearer valid-token"));

    expect(session).toEqual({ shop: "shop.myshopify.com", accessToken: "tok" });
  });
});

describe("loadOfflineSessionForShop", () => {
  beforeEach(() => {
    loadSessionMock.mockReset();
  });

  it("returns undefined when the stored session has no access token", async () => {
    loadSessionMock.mockResolvedValue({ shop: "shop.myshopify.com" });
    expect(await loadOfflineSessionForShop("shop.myshopify.com")).toBeUndefined();
  });

  it("returns the session when it has an access token", async () => {
    loadSessionMock.mockResolvedValue({ shop: "shop.myshopify.com", accessToken: "tok" });
    expect(await loadOfflineSessionForShop("shop.myshopify.com")).toEqual({
      shop: "shop.myshopify.com",
      accessToken: "tok",
    });
  });
});
