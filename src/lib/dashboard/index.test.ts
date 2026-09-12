import { beforeEach, describe, expect, it, vi } from "vitest";

const getShopMock = vi.fn();
const urlLinkCountMock = vi.fn();
const issueCountMock = vi.fn();
const scanJobFindFirstMock = vi.fn();
const getForShopMock = vi.fn();

vi.mock("@/lib/database/shops.server", () => ({ getShop: getShopMock }));
vi.mock("@/lib/database/client.server", () => ({
  prisma: {
    urlLink: { count: urlLinkCountMock },
    issue: { count: issueCountMock },
    scanJob: { findFirst: scanJobFindFirstMock },
  },
}));
vi.mock("@/lib/health-score", () => ({
  HealthScoreService: { getForShop: getForShopMock },
}));

const { DashboardService } = await import("./index");

describe("DashboardService.getOverview", () => {
  beforeEach(() => {
    getShopMock.mockReset();
    urlLinkCountMock.mockReset();
    issueCountMock.mockReset();
    scanJobFindFirstMock.mockReset();
    getForShopMock.mockReset();
  });

  it("returns a healthy empty state when the shop doesn't exist yet", async () => {
    getShopMock.mockResolvedValue(null);

    const overview = await DashboardService.getOverview("ghost.myshopify.com");

    expect(overview).toEqual({
      healthScore: 100,
      totalUrls: 0,
      brokenLinks: 0,
      notFoundErrors: 0,
      criticalIssues: 0,
      lastScan: null,
    });
    // Guarding against a real DB hit for a shop we already know doesn't exist.
    expect(getForShopMock).not.toHaveBeenCalled();
  });

  it("delegates the health score to HealthScoreService rather than computing its own", async () => {
    getShopMock.mockResolvedValue({ id: "shop-1" });
    urlLinkCountMock.mockResolvedValue(10);
    issueCountMock.mockResolvedValue(0);
    scanJobFindFirstMock.mockResolvedValue(null);
    getForShopMock.mockResolvedValue({ score: 73, penalties: {} });

    const overview = await DashboardService.getOverview("shop.myshopify.com");

    expect(overview.healthScore).toBe(73);
    expect(getForShopMock).toHaveBeenCalledWith("shop.myshopify.com");
  });

  it("maps the most recent ScanJob into lastScan", async () => {
    getShopMock.mockResolvedValue({ id: "shop-1" });
    urlLinkCountMock.mockResolvedValue(5);
    issueCountMock.mockResolvedValue(0);
    getForShopMock.mockResolvedValue({ score: 100, penalties: {} });
    const finishedAt = new Date("2026-01-01T00:05:00Z");
    scanJobFindFirstMock.mockResolvedValue({
      status: "COMPLETED",
      startedAt: new Date("2026-01-01T00:00:00Z"),
      finishedAt,
      urlsChecked: 5,
      issuesFound: 1,
    });

    const overview = await DashboardService.getOverview("shop.myshopify.com");

    expect(overview.lastScan).toEqual({
      status: "COMPLETED",
      startedAt: new Date("2026-01-01T00:00:00Z"),
      finishedAt,
      linksChecked: 5,
      issuesFound: 1,
    });
  });
});
