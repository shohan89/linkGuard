import type { SubscriptionPlan } from "@prisma/client";

export interface PlanDefinition {
  tier: SubscriptionPlan;
  name: string;
  /** USD, per 30 days. 0 for the free tier. */
  priceUsd: number;
  /** Total URLs LinkGuard will monitor for a shop on this plan. */
  maxUrls: number;
  /** Scans counted via UsageEvent(SCAN_RUN) in a rolling 30-day window. */
  maxScansPerMonth: number;
  /** Free tier gets weekly scans only; every paid tier gets daily. */
  dailyScansEnabled: boolean;
}

export const PLAN_DEFINITIONS: Record<SubscriptionPlan, PlanDefinition> = {
  FREE: {
    tier: "FREE",
    name: "Free",
    priceUsd: 0,
    maxUrls: 25,
    maxScansPerMonth: 4,
    dailyScansEnabled: false,
  },
  STARTER: {
    tier: "STARTER",
    name: "Starter",
    priceUsd: 7.99,
    maxUrls: 100,
    maxScansPerMonth: 30,
    dailyScansEnabled: true,
  },
  GROWTH: {
    tier: "GROWTH",
    name: "Growth",
    priceUsd: 14.99,
    maxUrls: 500,
    maxScansPerMonth: 30,
    dailyScansEnabled: true,
  },
  PRO: {
    tier: "PRO",
    name: "Pro",
    priceUsd: 29.99,
    maxUrls: 5000,
    maxScansPerMonth: 30,
    dailyScansEnabled: true,
  },
};

export const PAID_PLAN_TIERS: SubscriptionPlan[] = ["STARTER", "GROWTH", "PRO"];

export function getPlanDefinition(tier: SubscriptionPlan): PlanDefinition {
  return PLAN_DEFINITIONS[tier];
}

/** Matches a Shopify subscription's display name (e.g. "LinkGuard Starter")
 * back to our plan tier — the one place that naming convention is assumed. */
export function planTierFromSubscriptionName(name: string): SubscriptionPlan | null {
  const normalized = name.trim().toUpperCase();
  for (const tier of Object.keys(PLAN_DEFINITIONS) as SubscriptionPlan[]) {
    if (normalized.endsWith(tier)) {
      return tier;
    }
  }
  return null;
}
