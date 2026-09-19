import { HttpResponseError, type Session } from "@shopify/shopify-api";
import { shopify, sessionStorage } from "@/lib/shopify/client.server";
import { withShopLock } from "@/lib/shopify/session-lock.server";

export class UnauthenticatedError extends Error {
  constructor(message = "No valid Shopify session for this request") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

/**
 * Embedded admin requests carry the App Bridge session token as a bearer
 * token, not a cookie. We decode it to learn which shop is calling, then
 * load that shop's offline access token from Postgres. Use this in API
 * route handlers called from the client.
 */
export async function getOfflineSessionFromRequest(
  request: Request,
): Promise<Session> {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.match(/^Bearer (.+)$/i)?.[1];

  if (!token) {
    throw new UnauthenticatedError("Missing Authorization bearer session token");
  }

  let payload;
  try {
    payload = await shopify.session.decodeSessionToken(token);
  } catch {
    // Expired, tampered, wrong-audience, or otherwise malformed — all of
    // these are "not authenticated", not a server error.
    throw new UnauthenticatedError("Invalid or expired session token");
  }

  const shop = new URL(payload.dest).hostname;
  const session = await loadOfflineSessionForShop(shop);

  if (!session) {
    throw new UnauthenticatedError(`No offline session stored for ${shop}`);
  }

  return session;
}

/** Renew this far ahead of expiry so a token can't lapse mid-request. */
const RENEW_MARGIN_MS = 5 * 60 * 1000;

/**
 * Shopify no longer accepts non-expiring offline tokens for the Admin API:
 * they now live ~1h and are renewed with a single-use refresh token. A
 * session with no `expires` is a legacy non-expiring token, which also
 * needs converting.
 */
function needsRenewal(session: Session): boolean {
  if (!session.expires) return true;
  return session.expires.getTime() - Date.now() < RENEW_MARGIN_MS;
}

/**
 * Returns the shop's offline session with a usable access token, renewing
 * (refresh, or one-time migration of a legacy token) when it's expired or
 * about to. Returns undefined when there's no session or it can't be
 * renewed (e.g. refresh token expired/revoked) — callers treat that as
 * "not authenticated", which sends the merchant back through OAuth.
 */
export async function loadOfflineSessionForShop(
  shop: string,
): Promise<Session | undefined> {
  const offlineId = shopify.session.getOfflineId(shop);
  const session = await sessionStorage.loadSession(offlineId);

  if (!session?.accessToken) {
    return undefined;
  }
  if (!needsRenewal(session)) {
    return session;
  }
  return renewOfflineSession(shop, offlineId);
}

async function renewOfflineSession(
  shop: string,
  offlineId: string,
): Promise<Session | undefined> {
  return withShopLock(`session-renew:${shop}`, async () => {
    // Re-read under the lock: another process may have just renewed it.
    const current = await sessionStorage.loadSession(offlineId);
    if (!current?.accessToken) {
      return undefined;
    }
    if (!needsRenewal(current)) {
      return current;
    }

    try {
      let renewed: Session;
      if (!current.expires) {
        ({ session: renewed } = await shopify.auth.migrateToExpiringToken({
          shop,
          nonExpiringOfflineAccessToken: current.accessToken,
        }));
      } else if (
        current.refreshToken &&
        current.refreshTokenExpires &&
        current.refreshTokenExpires.getTime() > Date.now()
      ) {
        ({ session: renewed } = await shopify.auth.refreshToken({
          shop,
          refreshToken: current.refreshToken,
        }));
      } else {
        return undefined;
      }

      await sessionStorage.storeSession(renewed);
      return renewed;
    } catch (error) {
      if (error instanceof HttpResponseError) {
        console.error(`Could not renew offline session for ${shop}: ${error.message}`);
        return undefined;
      }
      throw error;
    }
  });
}
