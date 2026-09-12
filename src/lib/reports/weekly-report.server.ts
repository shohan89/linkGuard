import { prisma } from "@/lib/database/client.server";
import { getShop } from "@/lib/database/shops.server";
import { HealthScoreService } from "@/lib/health-score";
import { NotificationService } from "@/lib/notifications";
import type { WeeklyReportData } from "@/lib/notifications";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const WeeklyReportService = {
  /** Pure(ish) aggregation — no email side effect, easy to test/inspect on its own. */
  async computeReport(shopDomain: string): Promise<WeeklyReportData | null> {
    const shop = await getShop(shopDomain);
    if (!shop) {
      return null;
    }

    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - SEVEN_DAYS_MS);
    const dateRange = { gte: periodStart, lte: periodEnd };

    const [scansRun, newIssues, resolvedIssues, openIssues, health] = await Promise.all([
      prisma.scanJob.count({ where: { shopId: shop.id, createdAt: dateRange } }),
      prisma.issue.count({ where: { shopId: shop.id, firstSeenAt: dateRange } }),
      prisma.issue.count({
        where: { shopId: shop.id, status: "RESOLVED", resolvedAt: dateRange },
      }),
      prisma.issue.count({ where: { shopId: shop.id, status: "OPEN" } }),
      HealthScoreService.getForShop(shopDomain),
    ]);

    return {
      shopDomain,
      periodStart,
      periodEnd,
      scansRun,
      newIssues,
      resolvedIssues,
      openIssues,
      healthScore: health.score,
    };
  },

  async sendReport(shopDomain: string): Promise<void> {
    const report = await this.computeReport(shopDomain);
    if (!report) {
      return;
    }
    await NotificationService.notifyWeeklyReport(report);
  },
};
