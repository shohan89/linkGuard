import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "@/lib/queue/connection.server";
import { SCAN_QUEUE_NAME, type ScanJobData } from "@/lib/queue/scan-queue.server";
import { runScan } from "@/lib/scanner";
import { prisma } from "@/lib/database/client.server";
import { NotificationService } from "@/lib/notifications";

/**
 * How many ScanJobs this worker process runs at once. Each running job
 * internally checks links with its own concurrency (ScanService, default
 * 5) — total simultaneous HTTP requests is roughly this times that, so
 * keep this modest.
 */
const WORKER_CONCURRENCY = 2;

export function createScanWorker(): Worker<ScanJobData> {
  const worker = new Worker<ScanJobData>(
    SCAN_QUEUE_NAME,
    async (job: Job<ScanJobData>) => {
      await job.updateProgress({ status: "running" });
      const summary = await runScan(job.data.shopDomain, job.data.scanJobId);
      await job.updateProgress({ status: "done", linksChecked: summary.linksChecked });
      return summary;
    },
    {
      connection: createRedisConnection(),
      concurrency: WORKER_CONCURRENCY,
    },
  );

  worker.on("failed", async (job, error) => {
    if (!job) {
      return;
    }

    // BullMQ fires 'failed' after every failed attempt, not just the last
    // one. Only mark the ScanJob FAILED once retries are exhausted —
    // otherwise it's still waiting to be retried, so PENDING is accurate.
    const attempts = job.opts.attempts ?? 1;
    const isFinalAttempt = job.attemptsMade >= attempts;

    try {
      await prisma.scanJob.update({
        where: { id: job.data.scanJobId },
        data: isFinalAttempt
          ? { status: "FAILED", error: error.message, finishedAt: new Date() }
          : { status: "PENDING" },
      });

      if (isFinalAttempt) {
        await NotificationService.notifyScanFailed(job.data.shopDomain, error.message);
      }
    } catch (updateError) {
      console.error(
        `Failed to update ScanJob ${job.data.scanJobId} after job failure:`,
        updateError,
      );
    }
  });

  worker.on("error", (error) => {
    console.error("Scan worker error:", error);
  });

  return worker;
}
