import { beforeEach, describe, expect, it, vi } from "vitest";

const runScanMock = vi.fn();
const scanJobUpdateMock = vi.fn();

let capturedProcessor: ((job: unknown) => Promise<unknown>) | undefined;
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(function WorkerMock(
    _name: string,
    processor: (job: unknown) => Promise<unknown>,
  ) {
    capturedProcessor = processor;
    return {
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(event, handler);
      }),
      close: vi.fn(),
    };
  }),
}));

vi.mock("@/lib/queue/connection.server", () => ({
  createRedisConnection: vi.fn(),
}));

vi.mock("@/lib/scanner", () => ({ runScan: runScanMock }));

vi.mock("@/lib/database/client.server", () => ({
  prisma: { scanJob: { update: scanJobUpdateMock } },
}));

// scan-worker.server.ts imports SCAN_QUEUE_NAME (a real value, not just a
// type) from scan-queue.server, which now imports @/lib/billing ->
// @/lib/shopify/* -> constructs the real Shopify client at module load.
// Mocking billing here breaks that transitive chain.
vi.mock("@/lib/billing", () => ({
  BillingService: {},
  PlanLimitExceededError: class extends Error {},
}));

const { createScanWorker } = await import("./scan-worker.server");

function fakeJob(overrides: Record<string, unknown> = {}) {
  return {
    data: { shopDomain: "test.myshopify.com", scanJobId: "job-1" },
    opts: { attempts: 3 },
    attemptsMade: 1,
    updateProgress: vi.fn(),
    ...overrides,
  };
}

describe("scan worker processor", () => {
  beforeEach(() => {
    runScanMock.mockReset();
    scanJobUpdateMock.mockReset().mockResolvedValue(undefined);
    handlers.clear();
    createScanWorker();
  });

  it("calls runScan with the job's shop and scanJobId, and reports progress", async () => {
    const summary = {
      shopDomain: "test.myshopify.com",
      linksChecked: 5,
      issuesFound: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
    };
    runScanMock.mockResolvedValue(summary);
    const job = fakeJob();

    const result = await capturedProcessor!(job);

    expect(runScanMock).toHaveBeenCalledWith("test.myshopify.com", "job-1");
    expect(result).toBe(summary);
    expect(job.updateProgress).toHaveBeenCalledWith({ status: "running" });
    expect(job.updateProgress).toHaveBeenCalledWith({
      status: "done",
      linksChecked: 5,
    });
  });

  it("propagates runScan's error so BullMQ can retry", async () => {
    runScanMock.mockRejectedValue(new Error("discovery failed"));

    await expect(capturedProcessor!(fakeJob())).rejects.toThrow("discovery failed");
  });
});

describe("scan worker 'failed' handler", () => {
  beforeEach(() => {
    scanJobUpdateMock.mockReset().mockResolvedValue(undefined);
    handlers.clear();
    createScanWorker();
  });

  it("marks the ScanJob FAILED once attempts are exhausted", async () => {
    const job = fakeJob({ attemptsMade: 3, opts: { attempts: 3 } });
    const failedHandler = handlers.get("failed")!;

    await failedHandler(job, new Error("boom"));

    expect(scanJobUpdateMock).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({ status: "FAILED", error: "boom" }),
    });
  });

  it("resets to PENDING when retries remain", async () => {
    const job = fakeJob({ attemptsMade: 1, opts: { attempts: 3 } });
    const failedHandler = handlers.get("failed")!;

    await failedHandler(job, new Error("transient"));

    expect(scanJobUpdateMock).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { status: "PENDING" },
    });
  });

  it("does nothing when the job is undefined (BullMQ can pass that)", async () => {
    const failedHandler = handlers.get("failed")!;

    await failedHandler(undefined, new Error("boom"));

    expect(scanJobUpdateMock).not.toHaveBeenCalled();
  });
});
