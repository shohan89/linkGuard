import { beforeEach, describe, expect, it, vi } from "vitest";

const getShopMock = vi.fn();
const issueCountMock = vi.fn();
const urlLinkCountMock = vi.fn();

vi.mock("@/lib/database/shops.server", () => ({ getShop: getShopMock }));
vi.mock("@/lib/database/client.server", () => ({
  prisma: {
    urlLink: { count: urlLinkCountMock },
    issue: { count: issueCountMock },
  },
}));

const { HEALTH_SCORE_WEIGHTS, calculateHealthScore, HealthScoreService } = await import(
  "./index"
);

function factors(overrides: Partial<Parameters<typeof calculateHealthScore>[0]> = {}) {
  return {
    totalLinks: 10,
    notFoundCount: 0,
    serverErrorCount: 0,
    brokenInternalLinkCount: 0,
    redirectChainCount: 0,
    redirectLoopCount: 0,
    timeoutCount: 0,
    ...overrides,
  };
}

describe("HEALTH_SCORE_WEIGHTS", () => {
  it("sums to 100 — a maximally broken link set must be able to bottom out at exactly 0", () => {
    const total = Object.values(HEALTH_SCORE_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBe(100);
  });
});

describe("calculateHealthScore — baseline", () => {
  it("scores 100 with no monitored links at all", () => {
    expect(calculateHealthScore(factors({ totalLinks: 0 }))).toEqual({
      score: 100,
      penalties: {
        notFoundErrors: 0,
        serverErrors: 0,
        brokenInternalLinks: 0,
        redirectChains: 0,
        timeouts: 0,
      },
    });
  });

  it("scores 100 when nothing is broken", () => {
    expect(calculateHealthScore(factors()).score).toBe(100);
  });

  it("is deterministic — identical input always produces identical output", () => {
    const input = factors({ notFoundCount: 3, serverErrorCount: 1, timeoutCount: 2 });
    const first = calculateHealthScore(input);
    const second = calculateHealthScore({ ...input });
    expect(first).toEqual(second);
  });
});

describe("calculateHealthScore — each factor at 100% affected, alone", () => {
  it("404 errors on every link costs exactly its weight", () => {
    const result = calculateHealthScore(factors({ notFoundCount: 10 }));
    expect(result.penalties.notFoundErrors).toBe(HEALTH_SCORE_WEIGHTS.notFoundErrors);
    expect(result.score).toBe(100 - HEALTH_SCORE_WEIGHTS.notFoundErrors);
  });

  it("5xx errors on every link costs exactly its weight", () => {
    const result = calculateHealthScore(factors({ serverErrorCount: 10 }));
    expect(result.penalties.serverErrors).toBe(HEALTH_SCORE_WEIGHTS.serverErrors);
    expect(result.score).toBe(100 - HEALTH_SCORE_WEIGHTS.serverErrors);
  });

  it("broken internal links on every link costs exactly its weight", () => {
    const result = calculateHealthScore(factors({ brokenInternalLinkCount: 10 }));
    expect(result.penalties.brokenInternalLinks).toBe(HEALTH_SCORE_WEIGHTS.brokenInternalLinks);
    expect(result.score).toBe(100 - HEALTH_SCORE_WEIGHTS.brokenInternalLinks);
  });

  it("redirect chains on every link costs exactly its weight", () => {
    const result = calculateHealthScore(factors({ redirectChainCount: 10 }));
    expect(result.penalties.redirectChains).toBe(HEALTH_SCORE_WEIGHTS.redirectChains);
    expect(result.score).toBe(100 - HEALTH_SCORE_WEIGHTS.redirectChains);
  });

  it("timeouts on every link costs exactly its weight", () => {
    const result = calculateHealthScore(factors({ timeoutCount: 10 }));
    expect(result.penalties.timeouts).toBe(HEALTH_SCORE_WEIGHTS.timeouts);
    expect(result.score).toBe(100 - HEALTH_SCORE_WEIGHTS.timeouts);
  });

  it("every factor maxed simultaneously bottoms out at exactly 0", () => {
    const result = calculateHealthScore(
      factors({
        notFoundCount: 10,
        serverErrorCount: 10,
        brokenInternalLinkCount: 10,
        redirectChainCount: 10,
        timeoutCount: 10,
      }),
    );
    expect(result.score).toBe(0);
  });
});

describe("calculateHealthScore — proportional penalties", () => {
  it("charges half the weight for half the links affected", () => {
    const result = calculateHealthScore(factors({ notFoundCount: 5 }));
    expect(result.penalties.notFoundErrors).toBe(HEALTH_SCORE_WEIGHTS.notFoundErrors / 2);
  });

  it("combines multiple factors additively", () => {
    const result = calculateHealthScore(factors({ notFoundCount: 5, timeoutCount: 10 }));
    const expectedPenalty = HEALTH_SCORE_WEIGHTS.notFoundErrors / 2 + HEALTH_SCORE_WEIGHTS.timeouts;
    expect(result.score).toBe(Math.round(100 - expectedPenalty));
  });
});

describe("calculateHealthScore — redirect loops weigh double a chain", () => {
  it("a loop costs twice what an equal-count chain costs", () => {
    const chainResult = calculateHealthScore(factors({ redirectChainCount: 3 }));
    const loopResult = calculateHealthScore(factors({ redirectLoopCount: 3 }));
    expect(loopResult.penalties.redirectChains).toBeCloseTo(
      chainResult.penalties.redirectChains * 2,
    );
  });

  it("loops alone can reach the factor's full weight at half the raw count of a chain", () => {
    // 5 loops * 2 = 10 "weighted" out of 10 total links -> fraction 1 -> full weight,
    // whereas 5 chains alone would only be fraction 0.5.
    const result = calculateHealthScore(factors({ redirectLoopCount: 5 }));
    expect(result.penalties.redirectChains).toBe(HEALTH_SCORE_WEIGHTS.redirectChains);
  });
});

describe("calculateHealthScore — clamping and edge cases", () => {
  it("clamps a factor's penalty at its own weight even if its count exceeds totalLinks (defensive against bad data)", () => {
    const result = calculateHealthScore(
      factors({ totalLinks: 5, notFoundCount: 50, serverErrorCount: 50 }),
    );
    expect(result.penalties.notFoundErrors).toBe(HEALTH_SCORE_WEIGHTS.notFoundErrors);
    expect(result.penalties.serverErrors).toBe(HEALTH_SCORE_WEIGHTS.serverErrors);
    // Only 2 of 5 factors were affected, so score reflects just those two weights.
    expect(result.score).toBe(
      100 - HEALTH_SCORE_WEIGHTS.notFoundErrors - HEALTH_SCORE_WEIGHTS.serverErrors,
    );
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("never exceeds 100", () => {
    const result = calculateHealthScore(factors());
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("returns an integer score", () => {
    const result = calculateHealthScore(factors({ notFoundCount: 1 }));
    expect(Number.isInteger(result.score)).toBe(true);
  });
});

describe("HealthScoreService.getForShop", () => {
  beforeEach(() => {
    getShopMock.mockReset();
    issueCountMock.mockReset().mockResolvedValue(0);
    urlLinkCountMock.mockReset().mockResolvedValue(0);
  });

  it("returns a perfect score without querying issues when the shop doesn't exist", async () => {
    getShopMock.mockResolvedValue(null);

    const result = await HealthScoreService.getForShop("ghost.myshopify.com");

    expect(result.score).toBe(100);
    expect(issueCountMock).not.toHaveBeenCalled();
  });

  it("scopes the broken-internal-links query to isExternal: false", async () => {
    getShopMock.mockResolvedValue({ id: "shop-1" });

    await HealthScoreService.getForShop("shop.myshopify.com");

    expect(issueCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ urlLink: { isExternal: false } }),
      }),
    );
  });
});
