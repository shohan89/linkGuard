import { prisma } from "@/lib/database/client.server";
import { getShop } from "@/lib/database/shops.server";

/**
 * Points deducted (out of 100) when 100% of monitored links are affected by
 * that factor. They sum to 100 so a link set with every possible problem
 * simultaneously bottoms out at 0 — a real ceiling, not an arbitrary cap.
 *
 * "Broken internal links" is deliberately not mutually exclusive with
 * notFoundErrors/serverErrors: a broken link on the merchant's own store
 * gets penalized once under its failure-type bucket and again here, because
 * the same failure is worse for SEO on your own domain than on someone
 * else's. That's intentional, not double-counting by accident.
 */
export const HEALTH_SCORE_WEIGHTS = {
  notFoundErrors: 25,
  serverErrors: 30,
  brokenInternalLinks: 20,
  redirectChains: 15,
  timeouts: 10,
} as const;

export interface HealthScoreFactors {
  /** Total links being monitored — the denominator every factor's fraction is measured against. */
  totalLinks: number;
  /** Open BROKEN_404 issues, internal + external. */
  notFoundCount: number;
  /** Open SERVER_ERROR_5XX issues, internal + external. */
  serverErrorCount: number;
  /** Open broken-link issues (404/5xx/timeout/other) on internal links only. */
  brokenInternalLinkCount: number;
  /** Open REDIRECT_PROBLEM issues (long chains that do resolve). */
  redirectChainCount: number;
  /** Open REDIRECT_LOOP issues (never resolve) — counted at double weight vs a chain. */
  redirectLoopCount: number;
  /** Open TIMEOUT issues. */
  timeoutCount: number;
}

export interface HealthScoreBreakdown {
  /** 0-100 integer. */
  score: number;
  /** Points lost to each factor, same units as HEALTH_SCORE_WEIGHTS. Sums to `100 - score` (before rounding). */
  penalties: {
    notFoundErrors: number;
    serverErrors: number;
    brokenInternalLinks: number;
    redirectChains: number;
    timeouts: number;
  };
}

const PERFECT_SCORE: HealthScoreBreakdown = {
  score: 100,
  penalties: {
    notFoundErrors: 0,
    serverErrors: 0,
    brokenInternalLinks: 0,
    redirectChains: 0,
    timeouts: 0,
  },
};

/** A factor affecting 100% of links can't cost more than its own weight,
 * however the count arrives — this is what keeps one factor from silently
 * overrunning into another's budget. */
function weightedFraction(count: number, total: number, weight: number): number {
  const fraction = Math.min(1, Math.max(0, count) / total);
  return weight * fraction;
}

/**
 * The scoring algorithm itself: pure, deterministic, no I/O. Same factors
 * in, same score out, always — that determinism is the whole point, so
 * this never reaches into the database or the clock.
 */
export function calculateHealthScore(factors: HealthScoreFactors): HealthScoreBreakdown {
  if (factors.totalLinks <= 0) {
    return PERFECT_SCORE;
  }

  const { totalLinks } = factors;
  const weightedRedirectCount = factors.redirectChainCount + factors.redirectLoopCount * 2;

  const penalties = {
    notFoundErrors: weightedFraction(
      factors.notFoundCount,
      totalLinks,
      HEALTH_SCORE_WEIGHTS.notFoundErrors,
    ),
    serverErrors: weightedFraction(
      factors.serverErrorCount,
      totalLinks,
      HEALTH_SCORE_WEIGHTS.serverErrors,
    ),
    brokenInternalLinks: weightedFraction(
      factors.brokenInternalLinkCount,
      totalLinks,
      HEALTH_SCORE_WEIGHTS.brokenInternalLinks,
    ),
    redirectChains: weightedFraction(
      weightedRedirectCount,
      totalLinks,
      HEALTH_SCORE_WEIGHTS.redirectChains,
    ),
    timeouts: weightedFraction(factors.timeoutCount, totalLinks, HEALTH_SCORE_WEIGHTS.timeouts),
  };

  const totalPenalty = Object.values(penalties).reduce((sum, p) => sum + p, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));

  return {
    score,
    penalties: {
      notFoundErrors: Math.round(penalties.notFoundErrors * 100) / 100,
      serverErrors: Math.round(penalties.serverErrors * 100) / 100,
      brokenInternalLinks: Math.round(penalties.brokenInternalLinks * 100) / 100,
      redirectChains: Math.round(penalties.redirectChains * 100) / 100,
      timeouts: Math.round(penalties.timeouts * 100) / 100,
    },
  };
}

const BROKEN_LINK_TYPES = ["BROKEN_404", "SERVER_ERROR_5XX", "TIMEOUT", "OTHER"] as const;

export const HealthScoreService = {
  /** The pure calculation, re-exported here so callers only need one import. */
  calculate: calculateHealthScore,

  /** Pulls current factor counts for a shop from Postgres and scores them. */
  async getForShop(shopDomain: string): Promise<HealthScoreBreakdown> {
    const shop = await getShop(shopDomain);
    if (!shop) {
      return PERFECT_SCORE;
    }

    const [
      totalLinks,
      notFoundCount,
      serverErrorCount,
      brokenInternalLinkCount,
      redirectChainCount,
      redirectLoopCount,
      timeoutCount,
    ] = await Promise.all([
      prisma.urlLink.count({ where: { shopId: shop.id } }),
      prisma.issue.count({ where: { shopId: shop.id, status: "OPEN", type: "BROKEN_404" } }),
      prisma.issue.count({
        where: { shopId: shop.id, status: "OPEN", type: "SERVER_ERROR_5XX" },
      }),
      prisma.issue.count({
        where: {
          shopId: shop.id,
          status: "OPEN",
          type: { in: [...BROKEN_LINK_TYPES] },
          urlLink: { isExternal: false },
        },
      }),
      prisma.issue.count({
        where: { shopId: shop.id, status: "OPEN", type: "REDIRECT_PROBLEM" },
      }),
      prisma.issue.count({ where: { shopId: shop.id, status: "OPEN", type: "REDIRECT_LOOP" } }),
      prisma.issue.count({ where: { shopId: shop.id, status: "OPEN", type: "TIMEOUT" } }),
    ]);

    return calculateHealthScore({
      totalLinks,
      notFoundCount,
      serverErrorCount,
      brokenInternalLinkCount,
      redirectChainCount,
      redirectLoopCount,
      timeoutCount,
    });
  },
};
