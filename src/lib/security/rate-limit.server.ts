import { NextResponse } from "next/server";
import { createRedisConnection } from "@/lib/queue/connection.server";

export interface RateLimitResult {
  allowed: boolean;
  /** Requests remaining in the current window (0 once the limit is hit). */
  remaining: number;
  /** Seconds until the window resets. */
  resetSeconds: number;
}

let redis: ReturnType<typeof createRedisConnection> | undefined;

function getRedis() {
  redis ??= createRedisConnection();
  return redis;
}

/**
 * Fixed-window counter: INCR the key, and only the request that creates it
 * sets the expiry, so a window is exactly windowSeconds long regardless of
 * how many requests land in it. Shared Redis instance means this limits
 * fairly across all app instances, not just the one handling this request.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const client = getRedis();
  const redisKey = `ratelimit:${key}`;

  const count = await client.incr(redisKey);
  if (count === 1) {
    await client.expire(redisKey, windowSeconds);
  }

  if (count > limit) {
    const ttl = await client.ttl(redisKey);
    return { allowed: false, remaining: 0, resetSeconds: ttl > 0 ? ttl : windowSeconds };
  }

  return { allowed: true, remaining: limit - count, resetSeconds: windowSeconds };
}

/**
 * Route-level convenience: checks the limit for `shopDomain` on `routeName`
 * and returns a ready-to-return 429 response when it's exceeded, or null
 * when the caller should proceed. Keyed per-shop so one noisy tenant can't
 * burn another's budget, and per-route so scans and redirects don't share
 * a bucket.
 */
export async function enforceRateLimit(
  routeName: string,
  shopDomain: string,
  limit: number,
  windowSeconds: number,
): Promise<NextResponse | null> {
  const result = await checkRateLimit(`${routeName}:${shopDomain}`, limit, windowSeconds);
  if (result.allowed) {
    return null;
  }
  return NextResponse.json(
    { error: "Too many requests, please slow down" },
    { status: 429, headers: { "Retry-After": String(result.resetSeconds) } },
  );
}
