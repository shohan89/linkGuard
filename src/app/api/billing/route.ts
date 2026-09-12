import { NextRequest, NextResponse } from "next/server";
import {
  getOfflineSessionFromRequest,
  UnauthenticatedError,
} from "@/lib/shopify/session.server";
import { getShop } from "@/lib/database/shops.server";
import { prisma } from "@/lib/database/client.server";
import { BillingService, PLAN_DEFINITIONS } from "@/lib/billing";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  let session;
  try {
    session = await getOfflineSessionFromRequest(request);
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  const shop = await getShop(session.shop);
  const currentPlan = await BillingService.getActivePlan(session.shop);

  const [scansUsed, urlsUsed] = shop
    ? await Promise.all([
        BillingService.getMonthlyScanCount(shop.id),
        prisma.urlLink.count({ where: { shopId: shop.id } }),
      ])
    : [0, 0];

  return NextResponse.json({
    shop: session.shop,
    plans: Object.values(PLAN_DEFINITIONS),
    currentTier: currentPlan.tier,
    usage: {
      scansUsed,
      scansLimit: currentPlan.maxScansPerMonth,
      urlsUsed,
      urlsLimit: currentPlan.maxUrls,
    },
  });
}
