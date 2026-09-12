import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session } from "@shopify/shopify-api";
import { prisma } from "@/lib/database/client.server";
import { getShop } from "@/lib/database/shops.server";
import { loadOfflineSessionForShop } from "@/lib/shopify/session.server";
import { runAdminQuery } from "@/lib/shopify/admin.server";
import { RedirectService } from "@/lib/shopify/services/redirect.server";
import { RedirectManagementService, detectRedirectLoop } from "@/lib/redirects";
import { getLiveTestStoreDomain } from "@/lib/test-support/integration.server";

const DELETE_REDIRECT_MUTATION = `#graphql
  mutation DeleteRedirect($id: ID!) {
    urlRedirectDelete(id: $id) {
      deletedUrlRedirectId
      userErrors { message }
    }
  }
`;

async function deleteShopifyRedirect(session: Session, id: string): Promise<void> {
  await runAdminQuery(session, DELETE_REDIRECT_MUTATION, { id });
}

/**
 * Hits the real Shopify Admin API on the live test store — real
 * urlRedirectCreate/urlRedirectDelete mutations, real loop detection over
 * Shopify's actual redirect graph — not a mocked RedirectService. Every
 * redirect this creates is deleted again in `afterAll`.
 */
describe("Redirects (real Shopify Admin API)", () => {
  const shopDomain = getLiveTestStoreDomain();
  const suffix = Date.now();
  const fromPath = `/linkguard-integration-from-${suffix}`;
  const toTarget = `/linkguard-integration-to-${suffix}`;

  let session: Session;
  const createdShopifyRedirectIds: string[] = [];

  beforeAll(async () => {
    const loaded = await loadOfflineSessionForShop(shopDomain);
    if (!loaded) {
      throw new Error(
        `No offline session stored for ${shopDomain} — install the app on this store before running redirect integration tests`,
      );
    }
    session = loaded;
  });

  afterAll(async () => {
    for (const id of createdShopifyRedirectIds) {
      await deleteShopifyRedirect(session, id).catch(() => {});
    }
    const shop = await getShop(shopDomain);
    if (shop) {
      await prisma.urlRedirect.deleteMany({
        where: { shopId: shop.id, shopifyRedirectId: { in: createdShopifyRedirectIds } },
      });
    }
  });

  it("creates a real redirect on Shopify and records it locally", async () => {
    const result = await RedirectManagementService.createRedirect({
      session,
      shopDomain,
      fromUrl: fromPath,
      toUrl: toTarget,
      confirmed: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdShopifyRedirectIds.push(result.redirect.id);

    const onShopify = await RedirectService.findRedirectByPath(session, fromPath);
    expect(onShopify?.target).toBe(toTarget);

    const shop = await getShop(shopDomain);
    const historyRow = await prisma.urlRedirect.findUnique({
      where: { shopifyRedirectId: result.redirect.id },
    });
    expect(historyRow?.shopId).toBe(shop!.id);
    expect(historyRow?.fromPath).toBe(fromPath);
  }, 30_000);

  it("refuses to create a second redirect from the same path", async () => {
    const result = await RedirectManagementService.createRedirect({
      session,
      shopDomain,
      fromUrl: fromPath,
      toUrl: "/some-other-target",
      confirmed: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already redirects/);
  }, 30_000);

  it("detects a real loop by walking Shopify's actual redirect graph", async () => {
    const isLoop = await detectRedirectLoop(session, toTarget, fromPath, shopDomain);
    expect(isLoop).toBe(true);
  }, 30_000);

  it("does not flag an external target as a loop", async () => {
    const isLoop = await detectRedirectLoop(
      session,
      `/linkguard-integration-unrelated-${suffix}`,
      "https://example.com/somewhere-else",
      shopDomain,
    );
    expect(isLoop).toBe(false);
  });
});
