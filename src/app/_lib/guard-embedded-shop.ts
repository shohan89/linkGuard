import { shopify } from "@/lib/shopify/client.server";

export type ShopParams = Record<string, string | string[] | undefined>;

type Guard = { ok: true; shop: string } | { ok: false };

/**
 * Format-only check of the `shop` query param — NOT proof this request is
 * genuinely from Shopify Admin. That query param is attacker-controllable
 * (anyone can put any installed shop's domain in a URL), so it must never
 * be used to decide what tenant's data to render server-side. All it's
 * good for here is deciding whether to render the app shell at all, and
 * which shop to ask App Bridge for a session token on behalf of.
 *
 * The actual auth + tenant-scoped data fetch happens client-side, after
 * mount, via useAuthenticatedData — that request carries a bearer session
 * token the server verifies cryptographically (see
 * lib/shopify/session.server.ts#getOfflineSessionFromRequest). If that
 * comes back 401 (no App Bridge / no stored offline session), the client
 * view is responsible for bouncing to /api/auth via ExitIframe itself.
 */
export function guardEmbeddedShop(params: ShopParams): Guard {
  const shopParam = typeof params.shop === "string" ? params.shop : undefined;
  const shop = shopify.utils.sanitizeShop(shopParam ?? "", false);

  if (!shop) {
    return { ok: false };
  }

  return { ok: true, shop };
}
