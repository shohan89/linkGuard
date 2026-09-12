import { Queue } from "bullmq";
import { createRedisConnection } from "@/lib/queue/connection.server";

export const SCHEDULER_QUEUE_NAME = "scheduler";

let queue: Queue | undefined;

function getSchedulerQueue(): Queue {
  if (!queue) {
    queue = new Queue(SCHEDULER_QUEUE_NAME, { connection: createRedisConnection() });
  }
  return queue;
}

/**
 * Registers the daily-scan and weekly-report job schedulers. Idempotent —
 * BullMQ's job scheduler dedupes by the id passed as the first argument,
 * so calling this on every worker process startup never creates a second
 * schedule; it just confirms the existing one.
 */
export async function registerSchedules(): Promise<void> {
  const q = getSchedulerQueue();
  // 3am daily — after most timezones' business hours, before the
  // merchant's morning.
  await q.upsertJobScheduler(
    "daily-scan",
    { pattern: "0 3 * * *" },
    { name: "daily-scan" },
  );
  // 4am every Monday.
  await q.upsertJobScheduler(
    "weekly-report",
    { pattern: "0 4 * * 1" },
    { name: "weekly-report" },
  );
}

export async function closeSchedulerQueue(): Promise<void> {
  await queue?.close();
  queue = undefined;
}
