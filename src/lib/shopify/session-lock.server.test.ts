import { beforeEach, describe, expect, it, vi } from "vitest";

const setMock = vi.fn();
const evalMock = vi.fn();

vi.mock("@/lib/queue/connection.server", () => ({
  createRedisConnection: () => ({ set: setMock, eval: evalMock }),
}));

const { withShopLock } = await import("./session-lock.server");

describe("withShopLock", () => {
  beforeEach(() => {
    setMock.mockReset();
    evalMock.mockReset().mockResolvedValue(1);
  });

  it("acquires with SET NX PX, runs the function, then releases only if still the owner", async () => {
    setMock.mockResolvedValue("OK");

    const result = await withShopLock("session-renew:shop", async () => "done");

    expect(result).toBe("done");
    const [key, owner, px, ttl, nx] = setMock.mock.calls[0];
    expect(key).toBe("lock:session-renew:shop");
    expect([px, ttl, nx]).toEqual(["PX", 30_000, "NX"]);
    // Release passes the same owner token it acquired with.
    expect(evalMock.mock.calls[0][3]).toBe(owner);
  });

  it("releases the lock even when the function throws", async () => {
    setMock.mockResolvedValue("OK");

    await expect(
      withShopLock("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(evalMock).toHaveBeenCalledTimes(1);
  });

  it("waits and retries while another holder has the lock", async () => {
    setMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce("OK");

    const result = await withShopLock("k", async () => "got it", { waitMs: 5_000 });

    expect(result).toBe("got it");
    expect(setMock).toHaveBeenCalledTimes(3);
  });

  it("gives up with a clear error if the lock never frees, without running the function", async () => {
    setMock.mockResolvedValue(null);
    const fn = vi.fn();

    await expect(withShopLock("k", fn, { waitMs: 300 })).rejects.toThrow(/Timed out waiting for lock k/);
    expect(fn).not.toHaveBeenCalled();
    expect(evalMock).not.toHaveBeenCalled();
  });
});
