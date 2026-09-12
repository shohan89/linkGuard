import { beforeEach, describe, expect, it, vi } from "vitest";

const getShopMock = vi.fn();
const scanJobCountMock = vi.fn();
const issueCountMock = vi.fn();
const getForShopMock = vi.fn();
const notifyWeeklyReportMock = vi.fn();

vi.mock("@/lib/database/shops.server", () => ({ getShop: getShopMock }));
vi.mock("@/lib/database/client.server", () => ({
  prisma: {
    scanJob: { count: scanJobCountMock },
    issue: { count: issueCountMock },
  },
}));
vi.mock("@/lib/health-score", () => ({
  HealthScoreService: { getForShop: getForShopMock },
}));
vi.mock("@/lib/notifications", () => ({
  NotificationService: { notifyWeeklyReport: notifyWeeklyReportMock },
}));

const { WeeklyReportService } = await import("./weekly-report.server");

const SHOP_DOMAIN = "shop.myshopify.com";

describe("WeeklyReportService.computeReport", () => {
  beforeEach(() => {
    getShopMock.mockReset();
    scanJobCountMock.mockReset();
    issueCountMock.mockReset();
    getForShopMock.mockReset();
  });

  it("returns null when the shop doesn't exist", async () => {
    getShopMock.mockResolvedValue(null);
    expect(await WeeklyReportService.computeReport(SHOP_DOMAIN)).toBeNull();
  });

  it("aggregates counts over a 7-day window and includes the current health score", async () => {
    getShopMock.mockResolvedValue({ id: "shop-1" });
    scanJobCountMock.mockResolvedValue(7);
    issueCountMock.mockResolvedValueOnce(4).mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    getForShopMock.mockResolvedValue({ score: 88, penalties: {} });

    const report = await WeeklyReportService.computeReport(SHOP_DOMAIN);

    expect(report).toMatchObject({
      shopDomain: SHOP_DOMAIN,
      scansRun: 7,
      newIssues: 4,
      resolvedIssues: 3,
      openIssues: 2,
      healthScore: 88,
    });
    expect(report!.periodEnd.getTime() - report!.periodStart.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
  });
});

describe("WeeklyReportService.sendReport", () => {
  beforeEach(() => {
    getShopMock.mockReset();
    scanJobCountMock.mockReset().mockResolvedValue(0);
    issueCountMock.mockReset().mockResolvedValue(0);
    getForShopMock.mockReset().mockResolvedValue({ score: 100, penalties: {} });
    notifyWeeklyReportMock.mockReset().mockResolvedValue(undefined);
  });

  it("computes and sends the report", async () => {
    getShopMock.mockResolvedValue({ id: "shop-1" });

    await WeeklyReportService.sendReport(SHOP_DOMAIN);

    expect(notifyWeeklyReportMock).toHaveBeenCalledWith(
      expect.objectContaining({ shopDomain: SHOP_DOMAIN, healthScore: 100 }),
    );
  });

  it("does not send anything when the shop doesn't exist", async () => {
    getShopMock.mockResolvedValue(null);
    await WeeklyReportService.sendReport(SHOP_DOMAIN);
    expect(notifyWeeklyReportMock).not.toHaveBeenCalled();
  });
});
