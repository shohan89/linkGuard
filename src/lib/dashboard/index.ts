import { prisma } from "@/lib/database/client.server";
import { getShop } from "@/lib/database/shops.server";
import { HealthScoreService } from "@/lib/health-score";
import type { ScanJobStatus } from "@prisma/client";

export interface LastScanSummary {
  status: ScanJobStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  linksChecked: number;
  issuesFound: number;
}

export interface DashboardOverview {
  /** 0-100, from HealthScoreService — see lib/health-score for the algorithm. */
  healthScore: number;
  totalUrls: number;
  brokenLinks: number;
  notFoundErrors: number;
  criticalIssues: number;
  lastScan: LastScanSummary | null;
}

/** Failure types that represent a genuinely broken link, as opposed to a
 * redirect that's merely long or looping. */
const BROKEN_LINK_TYPES = ["BROKEN_404", "SERVER_ERROR_5XX", "TIMEOUT", "OTHER"] as const;

const EMPTY_OVERVIEW: DashboardOverview = {
  healthScore: 100,
  totalUrls: 0,
  brokenLinks: 0,
  notFoundErrors: 0,
  criticalIssues: 0,
  lastScan: null,
};

export const DashboardService = {
  async getOverview(shopDomain: string): Promise<DashboardOverview> {
    const shop = await getShop(shopDomain);
    if (!shop) {
      return EMPTY_OVERVIEW;
    }

    const [totalUrls, brokenLinks, notFoundErrors, criticalIssues, healthScore, lastScan] =
      await Promise.all([
        prisma.urlLink.count({ where: { shopId: shop.id } }),
        prisma.issue.count({
          where: { shopId: shop.id, status: "OPEN", type: { in: [...BROKEN_LINK_TYPES] } },
        }),
        prisma.issue.count({
          where: { shopId: shop.id, status: "OPEN", type: "BROKEN_404" },
        }),
        prisma.issue.count({
          where: { shopId: shop.id, status: "OPEN", severity: "CRITICAL" },
        }),
        HealthScoreService.getForShop(shopDomain),
        prisma.scanJob.findFirst({
          where: { shopId: shop.id },
          orderBy: { createdAt: "desc" },
        }),
      ]);

    return {
      healthScore: healthScore.score,
      totalUrls,
      brokenLinks,
      notFoundErrors,
      criticalIssues,
      lastScan: lastScan
        ? {
            status: lastScan.status,
            startedAt: lastScan.startedAt,
            finishedAt: lastScan.finishedAt,
            linksChecked: lastScan.urlsChecked,
            issuesFound: lastScan.issuesFound,
          }
        : null,
    };
  },
};
