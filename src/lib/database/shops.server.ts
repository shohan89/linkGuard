import { prisma } from "@/lib/database/client.server";

export async function markShopInstalled(shopDomain: string): Promise<void> {
  await prisma.shop.upsert({
    where: { shopDomain },
    create: { shopDomain },
    update: { isActive: true, uninstalledAt: null },
  });
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
}

export async function deleteShopData(shopDomain: string): Promise<void> {
  await prisma.shop.deleteMany({ where: { shopDomain } });
}

export async function getShop(shopDomain: string) {
  return prisma.shop.findUnique({ where: { shopDomain } });
}
