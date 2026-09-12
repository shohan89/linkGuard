import { afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { Session } from "@shopify/shopify-api";
import { prisma } from "@/lib/database/client.server";
import { shopify, sessionStorage } from "@/lib/shopify/client.server";
import { getShop, markShopInstalled } from "@/lib/database/shops.server";
import {
  cleanupShop,
  requireEnv,
  signWebhookHmac,
  uniqueShopDomain,
} from "@/lib/test-support/integration.server";

const { POST } = await import("./route");

function makeWebhookRequest(params: {
  topic: string;
  shopDomain: string;
  webhookId: string;
  body: object;
  secret: string;
  badHmac?: boolean;
}): NextRequest {
  const rawBody = JSON.stringify(params.body);
  const hmac = params.badHmac
    ? "not-a-real-signature=="
    : signWebhookHmac(rawBody, params.secret);

  return new NextRequest("https://app.example/api/webhooks", {
    method: "POST",
    body: rawBody,
    headers: {
      "X-Shopify-Topic": params.topic,
      "X-Shopify-Shop-Domain": params.shopDomain,
      "X-Shopify-Hmac-Sha256": hmac,
      "X-Shopify-API-Version": "2026-10",
      "X-Shopify-Webhook-Id": params.webhookId,
    },
  });
}

/**
 * Real HMAC verification (signed with the app's real SHOPIFY_API_SECRET),
 * real Postgres writes — the actual POST handler runs end to end, nothing
 * about validation or persistence is mocked. Uses throwaway synthetic
 * shops, never the real dev/test store, since this exercises
 * APP_UNINSTALLED / SHOP_REDACT.
 */
describe("POST /api/webhooks (real HMAC + real Postgres)", () => {
  const secret = requireEnv("SHOPIFY_API_SECRET");
  const shopsToClean: string[] = [];

  afterAll(async () => {
    await Promise.all(shopsToClean.splice(0).map(cleanupShop));
  });

  it("rejects a webhook with an invalid HMAC signature, without touching the DB", async () => {
    const shopDomain = uniqueShopDomain("webhook-bad-hmac");
    shopsToClean.push(shopDomain);
    await markShopInstalled(shopDomain);

    const response = await POST(
      makeWebhookRequest({
        topic: "APP_UNINSTALLED",
        shopDomain,
        webhookId: `wh-${Date.now()}`,
        body: { id: 1 },
        secret,
        badHmac: true,
      }),
    );

    expect(response.status).toBe(401);
    const shop = await getShop(shopDomain);
    expect(shop!.isActive).toBe(true); // untouched
  });

  it("processes a real, validly-signed APP_UNINSTALLED webhook end to end", async () => {
    const shopDomain = uniqueShopDomain("webhook-uninstall");
    shopsToClean.push(shopDomain);
    await markShopInstalled(shopDomain);
    const offlineId = shopify.session.getOfflineId(shopDomain);
    await sessionStorage.storeSession(
      new Session({ id: offlineId, shop: shopDomain, state: "s", isOnline: false, accessToken: "tok" }),
    );

    const webhookId = `wh-uninstall-${Date.now()}`;
    const response = await POST(
      makeWebhookRequest({
        topic: "APP_UNINSTALLED",
        shopDomain,
        webhookId,
        body: { id: 123, domain: shopDomain },
        secret,
      }),
    );

    expect(response.status).toBe(200);

    const shop = await getShop(shopDomain);
    expect(shop!.isActive).toBe(false);
    expect(shop!.uninstalledAt).not.toBeNull();
    expect(await sessionStorage.loadSession(offlineId)).toBeUndefined();

    const event = await prisma.webhookEvent.findUnique({ where: { shopifyWebhookId: webhookId } });
    expect(event?.topic).toBe("APP_UNINSTALLED");
    expect(event?.processedAt).not.toBeNull();
  });

  it("skips reprocessing a redelivered webhookId instead of running the handler twice", async () => {
    const shopDomain = uniqueShopDomain("webhook-redelivery");
    shopsToClean.push(shopDomain);
    await markShopInstalled(shopDomain);

    const webhookId = `wh-redeliver-${Date.now()}`;
    const request = () =>
      makeWebhookRequest({
        topic: "APP_UNINSTALLED",
        shopDomain,
        webhookId,
        body: { id: 456 },
        secret,
      });

    const first = await POST(request());
    expect(first.status).toBe(200);

    // Reinstall in between — if the redelivery were reprocessed, this
    // would get immediately marked uninstalled again.
    await markShopInstalled(shopDomain);

    const second = await POST(request());
    expect(second.status).toBe(200);

    const shop = await getShop(shopDomain);
    expect(shop!.isActive).toBe(true);

    const events = await prisma.webhookEvent.findMany({ where: { shopifyWebhookId: webhookId } });
    expect(events).toHaveLength(1);
  });

  it("processes a real SHOP_REDACT webhook, cascading away the shop and its own audit row", async () => {
    const shopDomain = uniqueShopDomain("webhook-redact");
    // Not pushed to shopsToClean: SHOP_REDACT deleting it IS the assertion.
    await markShopInstalled(shopDomain);
    const offlineId = shopify.session.getOfflineId(shopDomain);
    await sessionStorage.storeSession(
      new Session({ id: offlineId, shop: shopDomain, state: "s", isOnline: false, accessToken: "tok" }),
    );

    const webhookId = `wh-redact-${Date.now()}`;
    const response = await POST(
      makeWebhookRequest({
        topic: "SHOP_REDACT",
        shopDomain,
        webhookId,
        body: { shop_id: 1, shop_domain: shopDomain },
        secret,
      }),
    );

    expect(response.status).toBe(200);
    expect(await getShop(shopDomain)).toBeNull();
    expect(await prisma.webhookEvent.findUnique({ where: { shopifyWebhookId: webhookId } })).toBeNull();
  });
});
