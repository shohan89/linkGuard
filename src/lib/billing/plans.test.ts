import { describe, expect, it } from "vitest";
import {
  getPlanDefinition,
  PAID_PLAN_TIERS,
  planTierFromSubscriptionName,
  PLAN_DEFINITIONS,
} from "./plans";

describe("PLAN_DEFINITIONS", () => {
  it("has the four required tiers at the requested prices", () => {
    expect(PLAN_DEFINITIONS.FREE.priceUsd).toBe(0);
    expect(PLAN_DEFINITIONS.STARTER.priceUsd).toBe(7.99);
    expect(PLAN_DEFINITIONS.GROWTH.priceUsd).toBe(14.99);
    expect(PLAN_DEFINITIONS.PRO.priceUsd).toBe(29.99);
  });

  it("increases URL and scan limits monotonically with price", () => {
    const tiers = ["FREE", "STARTER", "GROWTH", "PRO"] as const;
    for (let i = 1; i < tiers.length; i++) {
      const prev = PLAN_DEFINITIONS[tiers[i - 1]];
      const curr = PLAN_DEFINITIONS[tiers[i]];
      expect(curr.maxUrls).toBeGreaterThan(prev.maxUrls);
      expect(curr.priceUsd).toBeGreaterThan(prev.priceUsd);
    }
  });

  it("only Free has scheduled scans disabled", () => {
    expect(PLAN_DEFINITIONS.FREE.dailyScansEnabled).toBe(false);
    expect(PLAN_DEFINITIONS.STARTER.dailyScansEnabled).toBe(true);
    expect(PLAN_DEFINITIONS.GROWTH.dailyScansEnabled).toBe(true);
    expect(PLAN_DEFINITIONS.PRO.dailyScansEnabled).toBe(true);
  });
});

describe("PAID_PLAN_TIERS", () => {
  it("excludes FREE", () => {
    expect(PAID_PLAN_TIERS).not.toContain("FREE");
    expect(PAID_PLAN_TIERS).toEqual(["STARTER", "GROWTH", "PRO"]);
  });
});

describe("getPlanDefinition", () => {
  it("returns the matching definition", () => {
    expect(getPlanDefinition("GROWTH").name).toBe("Growth");
  });
});

describe("planTierFromSubscriptionName", () => {
  it("matches a name ending in a tier", () => {
    expect(planTierFromSubscriptionName("LinkGuard Starter")).toBe("STARTER");
    expect(planTierFromSubscriptionName("LinkGuard Growth")).toBe("GROWTH");
    expect(planTierFromSubscriptionName("LinkGuard Pro")).toBe("PRO");
  });

  it("is case-insensitive", () => {
    expect(planTierFromSubscriptionName("linkguard starter")).toBe("STARTER");
  });

  it("returns null for an unrecognized name", () => {
    expect(planTierFromSubscriptionName("Some Other App Plan")).toBeNull();
  });
});
