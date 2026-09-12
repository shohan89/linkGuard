import { NextRequest, NextResponse } from "next/server";
import {
  getOfflineSessionFromRequest,
  UnauthenticatedError,
} from "@/lib/shopify/session.server";
import { getShop } from "@/lib/database/shops.server";
import { BillingService } from "@/lib/billing";

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

  const [shop, plan] = await Promise.all([
    getShop(session.shop),
    BillingService.getActivePlan(session.shop),
  ]);

  if (!shop) {
    return NextResponse.json({
      shopDomain: session.shop,
      installedAt: new Date(),
      isActive: false,
      plan,
    });
  }

  return NextResponse.json({
    shopDomain: shop.shopDomain,
    installedAt: shop.installedAt,
    isActive: shop.isActive,
    plan,
  });
}
