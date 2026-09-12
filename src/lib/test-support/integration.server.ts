import { SignJWT } from "jose";
import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "@/lib/database/client.server";

/**
 * Real infrastructure (Supabase Postgres, Upstash Redis, and — for a few
 * suites — the live Shopify test store's real Admin API) backs these
 * integration tests, unlike the mocked unit tests elsewhere in the repo.
 * Every shop domain these tests create must go through this helper so it's
 * unmistakably a test fixture, never confusable with a real merchant.
 */
export function uniqueShopDomain(label: string): string {
  const suffix = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  return `linkguard-integration-${label}-${suffix}.myshopify.com`;
}

/** Cascades through every shop-scoped table — see Shop's relations in schema.prisma. */
export async function cleanupShop(shopDomain: string): Promise<void> {
  await prisma.shop.deleteMany({ where: { shopDomain } });
}

function hmacKeyFromSecret(secret: string): Uint8Array {
  // Must match @shopify/shopify-api's getHMACKey exactly (char-code bytes,
  // not UTF-8 encoding) or a real decodeSessionToken call would fail to
  // verify a token this signs.
  return Uint8Array.from(secret, (c) => c.charCodeAt(0));
}

/**
 * Builds a real, validly-signed App Bridge session token — the same shape
 * and signature Shopify itself would produce — using the app's real
 * SHOPIFY_API_SECRET. Lets the authentication suite exercise the actual
 * jose.jwtVerify call in lib/shopify/session.server.ts instead of mocking
 * it away.
 */
export async function signRealSessionToken(params: {
  shop: string;
  apiKey: string;
  apiSecret: string;
  expiresInSeconds?: number;
  overrides?: Record<string, unknown>;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const key = hmacKeyFromSecret(params.apiSecret);

  return new SignJWT({
    dest: `https://${params.shop}`,
    aud: params.apiKey,
    sub: "1",
    exp: now + (params.expiresInSeconds ?? 60),
    nbf: now - 5,
    iat: now,
    jti: randomBytes(8).toString("hex"),
    sid: randomBytes(8).toString("hex"),
    iss: `https://${params.shop}/admin`,
    ...params.overrides,
  })
    .setProtectedHeader({ alg: "HS256" })
    .sign(key);
}

/**
 * A handful of suites (redirects, billing) need a real installed shop with
 * a real Shopify Admin API session to exercise real GraphQL calls — those
 * can't be conjured with a fresh synthetic domain the way DB-only tests
 * can. Defaults to the dev store this project has used throughout, but is
 * overridable via env for a different setup.
 */
export function getLiveTestStoreDomain(): string {
  return process.env.INTEGRATION_TEST_SHOP_DOMAIN ?? "linkguard-test-store.myshopify.com";
}

/** Matches @shopify/shopify-api's HMAC-validator exactly: base64 HMAC-SHA256 of the raw body. */
export function signWebhookHmac(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Integration tests require ${name} to be set`);
  }
  return value;
}
