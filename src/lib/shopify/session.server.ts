import type { Session } from "@shopify/shopify-api";
import { shopify, sessionStorage } from "@/lib/shopify/client.server";

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

export async function loadOfflineSessionForShop(
  shop: string,
): Promise<Session | undefined> {
  const offlineId = shopify.session.getOfflineId(shop);
  const session = await sessionStorage.loadSession(offlineId);
  return session?.accessToken ? session : undefined;
}
