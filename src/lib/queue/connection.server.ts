import IORedis from "ioredis";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// BullMQ requires this exact option — it issues blocking commands
// (BRPOPLPUSH etc.) that must never be retried transparently by ioredis,
// or BullMQ's own retry/backoff logic gets confused with ioredis's.
export function createRedisConnection(): IORedis {
  return new IORedis(required("REDIS_URL"), {
    maxRetriesPerRequest: null,
  });
}
