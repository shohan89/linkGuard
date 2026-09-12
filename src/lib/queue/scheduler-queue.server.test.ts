import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertJobSchedulerMock = vi.fn();

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(function QueueMock() {
    return { upsertJobScheduler: upsertJobSchedulerMock, close: vi.fn() };
  }),
}));
vi.mock("@/lib/queue/connection.server", () => ({ createRedisConnection: vi.fn() }));

const { registerSchedules } = await import("./scheduler-queue.server");

describe("registerSchedules", () => {
  beforeEach(() => {
    upsertJobSchedulerMock.mockReset().mockResolvedValue(undefined);
  });

  it("registers a daily-scan schedule at 3am every day", async () => {
    await registerSchedules();
    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      "daily-scan",
      { pattern: "0 3 * * *" },
      { name: "daily-scan" },
    );
  });

  it("registers a weekly-report schedule at 4am every Monday", async () => {
    await registerSchedules();
    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      "weekly-report",
      { pattern: "0 4 * * 1" },
      { name: "weekly-report" },
    );
  });

  it("is safe to call repeatedly (idempotent registration)", async () => {
    await registerSchedules();
    await registerSchedules();
    expect(upsertJobSchedulerMock).toHaveBeenCalledTimes(4); // 2 schedules x 2 calls
  });
});
