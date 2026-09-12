import { NextRequest, NextResponse } from "next/server";
import { shopify, sessionStorage } from "@/lib/shopify/client.server";
import { markShopInstalled, updateShopContactEmail } from "@/lib/database/shops.server";
import { ShopService } from "@/lib/shopify/services/shop.server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { session, headers } = await shopify.auth.callback({
    rawRequest: request,
  });

  // Shop must exist before ShopSession — shop_sessions.shop has a foreign
  // key into shops.shopDomain.
  await markShopInstalled(session.shop);
  await sessionStorage.storeSession(session);

  // Best-effort — notification emails just won't have a destination yet
  // if this fails, it shouldn't block completing install.
  try {
    const shopInfo = await ShopService.getShopInfo(session);
    await updateShopContactEmail(session.shop, shopInfo.email);
  } catch (error) {
    console.error(`Failed to cache contact email for ${session.shop}:`, error);
  }

  const embeddedAppUrl = await shopify.auth.getEmbeddedAppUrl({
    rawRequest: request,
  });

  const response = NextResponse.redirect(embeddedAppUrl, { status: 302 });
  headers.forEach((value: string, key: string) => {
    response.headers.append(key, value);
  });
  return response;
}
