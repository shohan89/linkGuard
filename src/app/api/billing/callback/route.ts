import { NextRequest, NextResponse } from "next/server";
import { shopify } from "@/lib/shopify/client.server";
import { loadOfflineSessionForShop } from "@/lib/shopify/session.server";
import { BillingService, InvalidBillingNonceError } from "@/lib/billing";

export const runtime = "nodejs";

/**
 * Shopify redirects the merchant's top-level browser here after they
 * approve (or decline) the charge on Shopify's own confirmation page —
 * there's no bearer token available, same as the OAuth callback, so the
 * session is loaded by shop domain rather than authenticated per-request.
 *
 * `shop` alone isn't proof of anything here (anyone can put a real,
 * installed shop's domain in a URL) — `nonce` is what proves this request
 * followed a charge *we* just started for that shop, not an attacker
 * replaying/guessing the URL to burn the shop's Shopify API quota.
 */
export async function GET(request: NextRequest) {
  const shop = request.nextUrl.searchParams.get("shop");
  const nonce = request.nextUrl.searchParams.get("nonce");
  if (!shop || !nonce) {
    return NextResponse.json({ error: "Missing shop or nonce parameter" }, { status: 400 });
  }

  const session = await loadOfflineSessionForShop(shop);
  if (!session) {
    return NextResponse.json({ error: `No offline session for ${shop}` }, { status: 401 });
  }

  try {
    await BillingService.confirmSubscription(shop, session, nonce);
  } catch (error) {
    if (error instanceof InvalidBillingNonceError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const embeddedAppUrl = await shopify.auth.getEmbeddedAppUrl({ rawRequest: request });
  return NextResponse.redirect(`${embeddedAppUrl}/billing`, { status: 302 });
}
