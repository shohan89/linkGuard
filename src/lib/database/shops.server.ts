import { prisma } from "@/lib/database/client.server";

/**
 * Shopify cancels every app charge on uninstall, so a stored paid plan is
 * stale from that moment on. Reset to Free so a reinstall (the Shop row
 * survives until SHOP_REDACT, 48h later) starts on Free and the merchant
 * re-approves any paid charge.
 */
async function resetSubscriptionToFree(shopId: string): Promise<void> {
  await prisma.subscription.upsert({
    where: { shopId },
    create: { shopId, plan: "FREE", status: "ACTIVE" },
    update: {
      plan: "FREE",
      status: "ACTIVE",
      shopifySubscriptionId: null,
      currentPeriodEnd: null,
      pendingNonce: null,
    },
  });
}

export async function markShopInstalled(shopDomain: string): Promise<void> {
  const existing = await prisma.shop.findUnique({ where: { shopDomain } });
  const shop = await prisma.shop.upsert({
    where: { shopDomain },
    create: { shopDomain },
    update: { isActive: true, uninstalledAt: null },
  });

  // Reinstall: also covers a missed/late APP_UNINSTALLED webhook.
  if (existing && (!existing.isActive || existing.uninstalledAt)) {
    await resetSubscriptionToFree(shop.id);
  }
}

export async function updateShopContactEmail(
  shopDomain: string,
  contactEmail: string,
): Promise<void> {
  await prisma.shop.updateMany({ where: { shopDomain }, data: { contactEmail } });
}

export async function markShopUninstalled(shopDomain: string): Promise<void> {
  await prisma.shop.updateMany({
    where: { shopDomain },
    data: { isActive: false, uninstalledAt: new Date() },
  });

  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (shop) {
    await resetSubscriptionToFree(shop.id);
  }
}

export async function deleteShopData(shopDomain: string): Promise<void> {
  await prisma.shop.deleteMany({ where: { shopDomain } });
}

export async function getShop(shopDomain: string) {
  return prisma.shop.findUnique({ where: { shopDomain } });
}
