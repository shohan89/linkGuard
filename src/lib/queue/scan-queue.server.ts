import { Queue } from "bullmq";
import { createRedisConnection } from "@/lib/queue/connection.server";
import { prisma } from "@/lib/database/client.server";
import { getShop } from "@/lib/database/shops.server";
import { BillingService } from "@/lib/billing";
import type { ScanTrigger } from "@prisma/client";

export const SCAN_QUEUE_NAME = "scans";

export interface ScanJobData {
  shopDomain: string;
  scanJobId: string;
}

let queue: Queue<ScanJobData> | undefined;

/** Lazily-created singleton — avoids opening a Redis connection at import
 * time for code paths (like most page renders) that never touch the queue. */
function getScanQueue(): Queue<ScanJobData> {
  if (!queue) {
    queue = new Queue<ScanJobData>(SCAN_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        // Keep a bounded history in Redis for introspection; Postgres
        // (ScanJob/ScanResult) is the durable record, not Redis.
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return queue;
}

export class ScanAlreadyRunningError extends Error {
  constructor(shopDomain: string) {
    super(`${shopDomain} already has a scan queued or running`);
    this.name = "ScanAlreadyRunningError";
  }
}

/**
 * Creates a ScanJob row and enqueues it for the worker to pick up.
 * Refuses a second concurrent scan per shop — one shop hammering its own
 * store with two overlapping scans helps no one and wastes the free-tier
 * Redis/Postgres quota. Returns immediately; the actual scan runs entirely
 * in the worker process, never on the request that called this.
 */
export async function enqueueScan(
  shopDomain: string,
  trigger: ScanTrigger,
): Promise<{ scanJobId: string }> {
  const shop = await getShop(shopDomain);
  if (!shop) {
    throw new Error(`No shop record for ${shopDomain}`);
  }

  const existing = await prisma.scanJob.findFirst({
    where: { shopId: shop.id, status: { in: ["PENDING", "RUNNING"] } },
    select: { id: true },
  });

  if (existing) {
    throw new ScanAlreadyRunningError(shopDomain);
  }

  // Throws PlanLimitExceededError if this month's quota is used up —
  // checked here so both manual (/api/scans) and scheduled (scheduler
  // worker) triggers share the same enforcement instead of duplicating it.
  await BillingService.assertCanRunScan(shopDomain);

  const scanJob = await prisma.scanJob.create({
    data: { shopId: shop.id, trigger, status: "PENDING" },
  });

  await getScanQueue().add(
    "scan",
    { shopDomain, scanJobId: scanJob.id },
    { jobId: scanJob.id },
  );

  return { scanJobId: scanJob.id };
}

export async function getQueueCounts() {
  return getScanQueue().getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed",
  );
}

export async function closeScanQueue(): Promise<void> {
  await queue?.close();
  queue = undefined;
}
