import { randomBytes } from "node:crypto";
import { createRedisConnection } from "@/lib/queue/connection.server";

let redis: ReturnType<typeof createRedisConnection> | undefined;

function getRedis() {
  redis ??= createRedisConnection();
  return redis;
}

const RELEASE_IF_OWNER = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

/**
 * Cross-process mutex (web + worker share one Redis). Needed because
 * Shopify refresh tokens are single-use: two processes refreshing the same
 * shop's token at once would leave one holding a dead refresh token and
 * force the merchant through OAuth again.
 */
export async function withShopLock<T>(
  key: string,
  fn: () => Promise<T>,
  { ttlMs = 30_000, waitMs = 10_000 }: { ttlMs?: number; waitMs?: number } = {},
): Promise<T> {
  const redisKey = `lock:${key}`;
  const owner = randomBytes(8).toString("hex");
  const deadline = Date.now() + waitMs;

  for (;;) {
    const acquired = await getRedis().set(redisKey, owner, "PX", ttlMs, "NX");
    if (acquired === "OK") break;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for lock ${key}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  try {
    return await fn();
  } finally {
    await getRedis()
      .eval(RELEASE_IF_OWNER, 1, redisKey, owner)
      .catch(() => {});
  }
}
