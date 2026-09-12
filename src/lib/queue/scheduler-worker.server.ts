import { Worker, type Job } from "bullmq";
import { createRedisConnection } from "@/lib/queue/connection.server";
import { SCHEDULER_QUEUE_NAME } from "@/lib/queue/scheduler-queue.server";
import { prisma } from "@/lib/database/client.server";
import { enqueueScan, ScanAlreadyRunningError } from "@/lib/queue/scan-queue.server";
import { BillingService, PlanLimitExceededError } from "@/lib/billing";
import { WeeklyReportService } from "@/lib/reports/weekly-report.server";

async function activeShopDomains(): Promise<string[]> {
  const shops = await prisma.shop.findMany({
    where: { isActive: true },
    select: { shopDomain: true },
  });
  return shops.map((shop) => shop.shopDomain);
}

/** A scan not happening because of a duplicate-in-progress or an exhausted
 * plan quota is expected, routine behavior — not worth logging as an
 * error the way an actual DB/network failure is. */
async function tryEnqueueScan(shopDomain: string): Promise<void> {
  try {
    await enqueueScan(shopDomain, "SCHEDULED");
  } catch (error) {
    if (error instanceof ScanAlreadyRunningError || error instanceof PlanLimitExceededError) {
      return;
    }
    console.error(`Failed to enqueue scheduled scan for ${shopDomain}:`, error);
  }
}

/** Only paid-tier shops get the daily cadence — Free is weekly, handled
 * alongside the weekly report below. */
async function triggerDailyScans(): Promise<void> {
  for (const shopDomain of await activeShopDomains()) {
    if (await BillingService.isDailyScanEligible(shopDomain)) {
      await tryEnqueueScan(shopDomain);
    }
  }
}

/** Sends every shop's weekly digest, and — for Free-tier shops, who don't
 * get the daily cadence — also runs their once-a-week scan right alongside it. */
async function sendWeeklyReports(): Promise<void> {
  for (const shopDomain of await activeShopDomains()) {
    if (!(await BillingService.isDailyScanEligible(shopDomain))) {
      await tryEnqueueScan(shopDomain);
    }

    try {
      await WeeklyReportService.sendReport(shopDomain);
    } catch (error) {
      console.error(`Failed to send weekly report for ${shopDomain}:`, error);
    }
  }
}

export function createSchedulerWorker(): Worker {
  const worker = new Worker(
    SCHEDULER_QUEUE_NAME,
    async (job: Job) => {
      if (job.name === "daily-scan") {
        await triggerDailyScans();
      } else if (job.name === "weekly-report") {
        await sendWeeklyReports();
      }
    },
    { connection: createRedisConnection(), concurrency: 1 },
  );

  worker.on("error", (error) => {
    console.error("Scheduler worker error:", error);
  });

  return worker;
}
