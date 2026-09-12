import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn();
const enqueueScanMock = vi.fn();
const sendReportMock = vi.fn();
const isDailyScanEligibleMock = vi.fn();

let capturedProcessor: ((job: { name: string }) => Promise<unknown>) | undefined;

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(function WorkerMock(
    _name: string,
    processor: (job: { name: string }) => Promise<unknown>,
  ) {
    capturedProcessor = processor;
    return { on: vi.fn(), close: vi.fn() };
  }),
}));
vi.mock("@/lib/queue/connection.server", () => ({ createRedisConnection: vi.fn() }));
vi.mock("@/lib/database/client.server", () => ({
  prisma: { shop: { findMany: findManyMock } },
}));

class FakeScanAlreadyRunningError extends Error {}
class FakePlanLimitExceededError extends Error {}

vi.mock("@/lib/queue/scan-queue.server", () => ({
  enqueueScan: enqueueScanMock,
  ScanAlreadyRunningError: FakeScanAlreadyRunningError,
}));
vi.mock("@/lib/billing", () => ({
  BillingService: { isDailyScanEligible: isDailyScanEligibleMock },
  PlanLimitExceededError: FakePlanLimitExceededError,
}));
vi.mock("@/lib/reports/weekly-report.server", () => ({
  WeeklyReportService: { sendReport: sendReportMock },
}));

const { createSchedulerWorker } = await import("./scheduler-worker.server");

describe("scheduler worker — daily-scan (paid tiers only)", () => {
  beforeEach(() => {
    findManyMock.mockReset();
    enqueueScanMock.mockReset();
    sendReportMock.mockReset();
    isDailyScanEligibleMock.mockReset();
    createSchedulerWorker();
  });

  it("triggers a scan for every active shop eligible for daily scans", async () => {
    findManyMock.mockResolvedValue([
      { shopDomain: "paid.myshopify.com" },
      { shopDomain: "free.myshopify.com" },
    ]);
    isDailyScanEligibleMock.mockImplementation(
      async (domain: string) => domain === "paid.myshopify.com",
    );
    enqueueScanMock.mockResolvedValue({ scanJobId: "job-1" });

    await capturedProcessor!({ name: "daily-scan" });

    expect(findManyMock).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { shopDomain: true },
    });
    expect(enqueueScanMock).toHaveBeenCalledWith("paid.myshopify.com", "SCHEDULED");
    expect(enqueueScanMock).not.toHaveBeenCalledWith("free.myshopify.com", "SCHEDULED");
  });

  it("skips a shop that already has a scan running without failing the whole batch", async () => {
    findManyMock.mockResolvedValue([
      { shopDomain: "a.myshopify.com" },
      { shopDomain: "b.myshopify.com" },
    ]);
    isDailyScanEligibleMock.mockResolvedValue(true);
    enqueueScanMock
      .mockRejectedValueOnce(new FakeScanAlreadyRunningError("a.myshopify.com"))
      .mockResolvedValueOnce({ scanJobId: "job-2" });

    await expect(capturedProcessor!({ name: "daily-scan" })).resolves.toBeUndefined();
    expect(enqueueScanMock).toHaveBeenCalledTimes(2);
  });

  it("silently skips a shop that's used up its monthly quota", async () => {
    findManyMock.mockResolvedValue([{ shopDomain: "a.myshopify.com" }]);
    isDailyScanEligibleMock.mockResolvedValue(true);
    enqueueScanMock.mockRejectedValue(new FakePlanLimitExceededError("quota used up"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(capturedProcessor!({ name: "daily-scan" })).resolves.toBeUndefined();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("logs but doesn't throw when enqueueing fails for an unrelated reason", async () => {
    findManyMock.mockResolvedValue([{ shopDomain: "a.myshopify.com" }]);
    isDailyScanEligibleMock.mockResolvedValue(true);
    enqueueScanMock.mockRejectedValue(new Error("db down"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(capturedProcessor!({ name: "daily-scan" })).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

describe("scheduler worker — weekly-report (+ free-tier weekly scan)", () => {
  beforeEach(() => {
    findManyMock.mockReset();
    enqueueScanMock.mockReset().mockResolvedValue({ scanJobId: "job-1" });
    sendReportMock.mockReset().mockResolvedValue(undefined);
    isDailyScanEligibleMock.mockReset();
    createSchedulerWorker();
  });

  it("sends a weekly report for every active shop", async () => {
    findManyMock.mockResolvedValue([{ shopDomain: "a.myshopify.com" }]);
    isDailyScanEligibleMock.mockResolvedValue(true);

    await capturedProcessor!({ name: "weekly-report" });

    expect(sendReportMock).toHaveBeenCalledWith("a.myshopify.com");
  });

  it("also runs a scan for Free-tier shops (their only scan cadence)", async () => {
    findManyMock.mockResolvedValue([{ shopDomain: "free.myshopify.com" }]);
    isDailyScanEligibleMock.mockResolvedValue(false);

    await capturedProcessor!({ name: "weekly-report" });

    expect(enqueueScanMock).toHaveBeenCalledWith("free.myshopify.com", "SCHEDULED");
    expect(sendReportMock).toHaveBeenCalledWith("free.myshopify.com");
  });

  it("does not double-scan a paid-tier shop that already gets daily scans", async () => {
    findManyMock.mockResolvedValue([{ shopDomain: "paid.myshopify.com" }]);
    isDailyScanEligibleMock.mockResolvedValue(true);

    await capturedProcessor!({ name: "weekly-report" });

    expect(enqueueScanMock).not.toHaveBeenCalled();
    expect(sendReportMock).toHaveBeenCalledWith("paid.myshopify.com");
  });
});
