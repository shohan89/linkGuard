import { beforeEach, describe, expect, it, vi } from "vitest";

const incrMock = vi.fn();
const expireMock = vi.fn();
const ttlMock = vi.fn();

vi.mock("@/lib/queue/connection.server", () => ({
  createRedisConnection: () => ({ incr: incrMock, expire: expireMock, ttl: ttlMock }),
}));

const { checkRateLimit, enforceRateLimit } = await import("./rate-limit.server");

describe("checkRateLimit", () => {
  beforeEach(() => {
    incrMock.mockReset();
    expireMock.mockReset().mockResolvedValue(1);
    ttlMock.mockReset();
  });

  it("allows the first request and sets the window expiry", async () => {
    incrMock.mockResolvedValue(1);

    const result = await checkRateLimit("scans:shop.myshopify.com", 5, 60);

    expect(result).toEqual({ allowed: true, remaining: 4, resetSeconds: 60 });
    expect(expireMock).toHaveBeenCalledWith("ratelimit:scans:shop.myshopify.com", 60);
  });

  it("does not reset the expiry on subsequent requests in the same window", async () => {
    incrMock.mockResolvedValue(2);

    await checkRateLimit("scans:shop.myshopify.com", 5, 60);

    expect(expireMock).not.toHaveBeenCalled();
  });

  it("blocks once the count exceeds the limit", async () => {
    incrMock.mockResolvedValue(6);
    ttlMock.mockResolvedValue(30);

    const result = await checkRateLimit("scans:shop.myshopify.com", 5, 60);

    expect(result).toEqual({ allowed: false, remaining: 0, resetSeconds: 30 });
  });

  it("falls back to the full window when Redis reports no TTL", async () => {
    incrMock.mockResolvedValue(6);
    ttlMock.mockResolvedValue(-1);

    const result = await checkRateLimit("scans:shop.myshopify.com", 5, 60);

    expect(result.resetSeconds).toBe(60);
  });
});

describe("enforceRateLimit", () => {
  beforeEach(() => {
    incrMock.mockReset();
    expireMock.mockReset().mockResolvedValue(1);
    ttlMock.mockReset();
  });

  it("returns null when under the limit", async () => {
    incrMock.mockResolvedValue(1);
    const response = await enforceRateLimit("scans", "shop.myshopify.com", 5, 60);
    expect(response).toBeNull();
  });

  it("returns a 429 with Retry-After when over the limit", async () => {
    incrMock.mockResolvedValue(10);
    ttlMock.mockResolvedValue(42);

    const response = await enforceRateLimit("scans", "shop.myshopify.com", 5, 60);

    expect(response).not.toBeNull();
    expect(response!.status).toBe(429);
    expect(response!.headers.get("Retry-After")).toBe("42");
  });
});
