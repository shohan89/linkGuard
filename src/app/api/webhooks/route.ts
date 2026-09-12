import { NextRequest, NextResponse } from "next/server";
import { shopify, sessionStorage } from "@/lib/shopify/client.server";
import { markShopUninstalled, deleteShopData, getShop } from "@/lib/database/shops.server";
import { prisma } from "@/lib/database/client.server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const validation = await shopify.webhooks.validate({
    rawRequest: request,
    rawBody,
  });

  if (!validation.valid) {
    return NextResponse.json(
      { error: `Webhook validation failed: ${validation.reason}` },
      { status: 401 },
    );
  }

  const { topic, domain: shop, webhookId } = validation;

  // Shopify retries deliveries it didn't get a fast 200 for, so the same
  // webhookId can arrive more than once. Record it before processing and
  // skip reprocessing anything already marked done — without this, a
  // retried SHOP_REDACT/APP_UNINSTALLED is harmless (its writes are
  // idempotent already), but we'd have no audit trail of what Shopify
  // actually sent us, which is the point of the WebhookEvent table.
  const shopRow = await getShop(shop);
  let eventId: string | null = null;

  if (shopRow && webhookId) {
    const existing = await prisma.webhookEvent.findUnique({ where: { shopifyWebhookId: webhookId } });
    if (existing?.processedAt) {
      return new NextResponse(null, { status: 200 });
    }

    const payload = safeJsonParse(rawBody);
    const event = await prisma.webhookEvent.upsert({
      where: { shopifyWebhookId: webhookId },
      create: { shopId: shopRow.id, shopifyWebhookId: webhookId, topic, payload },
      update: { topic, payload },
    });
    eventId = event.id;
  }

  try {
    await processWebhook(topic, shop);
  } catch (error) {
    // updateMany, not update: SHOP_REDACT cascades away this very row (the
    // Shop delete cascades to WebhookEvent) before we get here, and that's
    // by design — a no-op update is fine, a thrown "record not found" isn't.
    if (eventId) {
      await prisma.webhookEvent.updateMany({
        where: { id: eventId },
        data: { error: error instanceof Error ? error.message : "Unknown error" },
      });
    }
    throw error;
  }

  if (eventId) {
    await prisma.webhookEvent.updateMany({
      where: { id: eventId },
      data: { processedAt: new Date() },
    });
  }

  return new NextResponse(null, { status: 200 });
}

function safeJsonParse(rawBody: string): object {
  try {
    return JSON.parse(rawBody);
  } catch {
    return {};
  }
}

async function processWebhook(topic: string, shop: string): Promise<void> {
  switch (topic) {
    case "APP_UNINSTALLED": {
      await markShopUninstalled(shop);
      const offlineId = shopify.session.getOfflineId(shop);
      await sessionStorage.deleteSession(offlineId);
      break;
    }

    case "CUSTOMERS_DATA_REQUEST": {
      // LinkGuard stores no customer PII (only shop-level link/scan data),
      // so there is nothing to export for this request.
      break;
    }

    case "CUSTOMERS_REDACT": {
      // No customer PII is stored; nothing to redact.
      break;
    }

    case "SHOP_REDACT": {
      // Shopify sends this 48 hours after uninstall. Erase all
      // shop-scoped data we hold.
      await deleteShopData(shop);
      const offlineId = shopify.session.getOfflineId(shop);
      await sessionStorage.deleteSession(offlineId);
      break;
    }

    default:
      break;
  }
}
