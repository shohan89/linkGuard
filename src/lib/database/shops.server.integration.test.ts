import { afterEach, describe, expect, it } from "vitest";
import { Session } from "@shopify/shopify-api";
import { prisma } from "@/lib/database/client.server";
import { shopify, sessionStorage } from "@/lib/shopify/client.server";
import {
  deleteShopData,
  getShop,
  markShopInstalled,
  markShopUninstalled,
  updateShopContactEmail,
} from "@/lib/database/shops.server";
import { cleanupShop, uniqueShopDomain } from "@/lib/test-support/integration.server";

/**
 * Exercises the real OAuth-callback install path (see
 * app/api/auth/callback/route.ts) against real Postgres: Shop row
 * creation/reinstall, contact-email caching, uninstall, and the real
 * PrismaSessionStorage adapter's session round-trip — none of that is
 * mocked here.
 */
describe("Shopify installation (real Postgres)", () => {
  const shopsToClean: string[] = [];

  afterEach(async () => {
    await Promise.all(shopsToClean.splice(0).map(cleanupShop));
  });

  it("creates an active Shop row on first install", async () => {
    const shopDomain = uniqueShopDomain("install");
    shopsToClean.push(shopDomain);

    await markShopInstalled(shopDomain);

    const shop = await getShop(shopDomain);
    expect(shop).not.toBeNull();
    expect(shop!.isActive).toBe(true);
    expect(shop!.uninstalledAt).toBeNull();
  });

  it("reactivates and clears uninstalledAt on reinstall", async () => {
    const shopDomain = uniqueShopDomain("reinstall");
    shopsToClean.push(shopDomain);

    await markShopInstalled(shopDomain);
    await markShopUninstalled(shopDomain);
    let shop = await getShop(shopDomain);
    expect(shop!.isActive).toBe(false);
    expect(shop!.uninstalledAt).not.toBeNull();

    await markShopInstalled(shopDomain);
    shop = await getShop(shopDomain);
    expect(shop!.isActive).toBe(true);
    expect(shop!.uninstalledAt).toBeNull();
  });

  it("caches the shop's contact email", async () => {
    const shopDomain = uniqueShopDomain("email");
    shopsToClean.push(shopDomain);

    await markShopInstalled(shopDomain);
    await updateShopContactEmail(shopDomain, "merchant@example.com");

    const shop = await getShop(shopDomain);
    expect(shop!.contactEmail).toBe("merchant@example.com");
  });

  it("deleteShopData removes the Shop row entirely (GDPR SHOP_REDACT path)", async () => {
    const shopDomain = uniqueShopDomain("redact");
    // Not pushed to shopsToClean — the point of this test is that
    // deleteShopData already removes it; asserting that IS the cleanup.

    await markShopInstalled(shopDomain);
    await deleteShopData(shopDomain);

    expect(await getShop(shopDomain)).toBeNull();
  });

  it("round-trips a real offline session through PrismaSessionStorage", async () => {
    const shopDomain = uniqueShopDomain("session");
    shopsToClean.push(shopDomain);

    // shop_sessions.shop has a foreign key into shops.shopDomain — the Shop
    // row must exist first, exactly like the real callback route requires.
    await markShopInstalled(shopDomain);

    const offlineId = shopify.session.getOfflineId(shopDomain);
    const session = new Session({
      id: offlineId,
      shop: shopDomain,
      state: "test-state",
      isOnline: false,
      scope: "read_products,write_online_store_navigation",
      accessToken: "shpat_test_token_value",
    });

    const stored = await sessionStorage.storeSession(session);
    expect(stored).toBe(true);

    const loaded = await sessionStorage.loadSession(offlineId);
    expect(loaded?.shop).toBe(shopDomain);
    expect(loaded?.accessToken).toBe("shpat_test_token_value");

    const deleted = await sessionStorage.deleteSession(offlineId);
    expect(deleted).toBe(true);
    expect(await sessionStorage.loadSession(offlineId)).toBeUndefined();
  });

  it("deleting the Shop row cascades to its stored session", async () => {
    const shopDomain = uniqueShopDomain("cascade-session");

    await markShopInstalled(shopDomain);
    const offlineId = shopify.session.getOfflineId(shopDomain);
    await sessionStorage.storeSession(
      new Session({
        id: offlineId,
        shop: shopDomain,
        state: "test-state",
        isOnline: false,
        accessToken: "shpat_test_token_value",
      }),
    );

    await deleteShopData(shopDomain);

    const row = await prisma.shopSession.findUnique({ where: { id: offlineId } });
    expect(row).toBeNull();
  });
});
