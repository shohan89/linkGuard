import { NextRequest, NextResponse } from "next/server";
import { shopify } from "@/lib/shopify/client.server";

export const runtime = "nodejs";

/**
 * Begins the OAuth grant. Must be hit top-level (never inside the admin
 * iframe) — Shopify's consent screen refuses to render in an iframe.
 * The app's own pages are responsible for breaking out of the iframe
 * before landing here; see src/app/page.tsx.
 */
export async function GET(request: NextRequest) {
  const shop = shopify.utils.sanitizeShop(
    request.nextUrl.searchParams.get("shop") ?? "",
    false,
  );

  if (!shop) {
    return NextResponse.json(
      { error: "Missing or invalid shop parameter" },
      { status: 400 },
    );
  }

  return shopify.auth.begin({
    shop,
    callbackPath: "/api/auth/callback",
    isOnline: false,
    rawRequest: request,
  });
}
