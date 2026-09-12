import { createScanWorker } from "@/lib/queue/scan-worker.server";
import { createSchedulerWorker } from "@/lib/queue/scheduler-worker.server";
import { registerSchedules } from "@/lib/queue/scheduler-queue.server";

async function main() {
  const scanWorker = createScanWorker();
  const schedulerWorker = createSchedulerWorker();

  // Idempotent — safe on every restart of this process.
  await registerSchedules();

  console.log("Scan worker + scheduler started, waiting for jobs...");

  async function shutdown(signal: string) {
    console.log(`${signal} received, shutting down workers...`);
    await Promise.all([scanWorker.close(), schedulerWorker.close()]);
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("Worker process failed to start:", error);
  process.exit(1);
});
