import { beforeEach, describe, expect, it, vi } from "vitest";

const addMock = vi.fn();
const getJobCountsMock = vi.fn();
const findFirstMock = vi.fn();
const createMock = vi.fn();
const getShopMock = vi.fn();
const assertCanRunScanMock = vi.fn();

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(function QueueMock() {
    return { add: addMock, getJobCounts: getJobCountsMock, close: vi.fn() };
  }),
}));

vi.mock("@/lib/queue/connection.server", () => ({
  createRedisConnection: vi.fn(),
}));

vi.mock("@/lib/database/client.server", () => ({
  prisma: { scanJob: { findFirst: findFirstMock, create: createMock } },
}));

vi.mock("@/lib/database/shops.server", () => ({
  getShop: getShopMock,
}));

class FakePlanLimitExceededError extends Error {}
vi.mock("@/lib/billing", () => ({
  BillingService: { assertCanRunScan: assertCanRunScanMock },
  PlanLimitExceededError: FakePlanLimitExceededError,
}));

const { enqueueScan, ScanAlreadyRunningError } = await import("./scan-queue.server");

describe("enqueueScan", () => {
  beforeEach(() => {
    addMock.mockReset().mockResolvedValue(undefined);
    findFirstMock.mockReset().mockResolvedValue(null);
    createMock.mockReset().mockResolvedValue({ id: "job-1" });
    getShopMock.mockReset().mockResolvedValue({ id: "shop-1", shopDomain: "test.myshopify.com" });
    assertCanRunScanMock.mockReset().mockResolvedValue(undefined);
  });

  it("creates a ScanJob row and enqueues it with a matching jobId", async () => {
    const result = await enqueueScan("test.myshopify.com", "MANUAL");

    expect(result).toEqual({ scanJobId: "job-1" });
    expect(createMock).toHaveBeenCalledWith({
      data: { shopId: "shop-1", trigger: "MANUAL", status: "PENDING" },
    });
    expect(addMock).toHaveBeenCalledWith(
      "scan",
      { shopDomain: "test.myshopify.com", scanJobId: "job-1" },
      { jobId: "job-1" },
    );
  });

  it("refuses a second scan while one is already pending or running", async () => {
    findFirstMock.mockResolvedValue({ id: "existing-job" });

    await expect(enqueueScan("test.myshopify.com", "MANUAL")).rejects.toBeInstanceOf(
      ScanAlreadyRunningError,
    );
    expect(createMock).not.toHaveBeenCalled();
    expect(addMock).not.toHaveBeenCalled();
  });

  it("throws when the shop doesn't exist", async () => {
    getShopMock.mockResolvedValue(null);

    await expect(enqueueScan("ghost.myshopify.com", "MANUAL")).rejects.toThrow(
      "No shop record",
    );
  });

  it("refuses to enqueue when the plan's monthly scan quota is used up", async () => {
    assertCanRunScanMock.mockRejectedValue(new FakePlanLimitExceededError("quota used up"));

    await expect(enqueueScan("test.myshopify.com", "MANUAL")).rejects.toBeInstanceOf(
      FakePlanLimitExceededError,
    );
    expect(createMock).not.toHaveBeenCalled();
    expect(addMock).not.toHaveBeenCalled();
  });
});
