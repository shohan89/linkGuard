import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/database/client.server";
import { getShop, markShopInstalled } from "@/lib/database/shops.server";
import { IssueService } from "@/lib/issues/issue.server";
import { RedirectManagementService } from "@/lib/redirects";
import { listMonitoredUrls } from "@/lib/scanner";
import { BillingService } from "@/lib/billing";
import { cleanupShop, uniqueShopDomain } from "@/lib/test-support/integration.server";

/**
 * The whole point of a multi-tenant schema: shop A's data must never be
 * readable, writable, or even count toward shop B's queries, and deleting
 * one shop must never touch the other's rows. Built against real Postgres
 * so it actually exercises the FK/cascade behavior, not a mock's idea of it.
 */
describe("Database tenant isolation (real Postgres)", () => {
  const domainA = uniqueShopDomain("tenant-a");
  const domainB = uniqueShopDomain("tenant-b");
  let shopAId: string;
  let shopBId: string;
  let issueAId: string;
  let issueBId: string;

  beforeAll(async () => {
    await markShopInstalled(domainA);
    await markShopInstalled(domainB);
    shopAId = (await getShop(domainA))!.id;
    shopBId = (await getShop(domainB))!.id;

    async function seedShop(shopId: string, domain: string, label: string) {
      const url = await prisma.url.create({
        data: { shopId, url: `https://${domain}/`, source: "HOMEPAGE" },
      });
      const urlLink = await prisma.urlLink.create({
        data: {
          shopId,
          sourceUrlId: url.id,
          targetUrl: `https://${domain}/broken-${label}`,
          isExternal: false,
        },
      });
      const issue = await prisma.issue.create({
        data: {
          shopId,
          urlLinkId: urlLink.id,
          type: "BROKEN_404",
          severity: "CRITICAL",
          status: "OPEN",
        },
      });
      await prisma.subscription.create({
        data: { shopId, plan: label === "a" ? "GROWTH" : "STARTER", status: "ACTIVE" },
      });
      await prisma.webhookEvent.create({
        data: { shopId, shopifyWebhookId: `wh-${label}-${Date.now()}`, topic: "APP_UNINSTALLED", payload: {} },
      });
      return issue.id;
    }

    issueAId = await seedShop(shopAId, domainA, "a");
    issueBId = await seedShop(shopBId, domainB, "b");
  });

  afterAll(async () => {
    await Promise.all([cleanupShop(domainA), cleanupShop(domainB)]);
  });

  it("listOpenIssues never returns another shop's issues", async () => {
    const issuesA = await IssueService.listOpenIssues(domainA);
    const issuesB = await IssueService.listOpenIssues(domainB);

    expect(issuesA.map((i) => i.id)).toEqual([issueAId]);
    expect(issuesB.map((i) => i.id)).toEqual([issueBId]);
    expect(issuesA.map((i) => i.id)).not.toContain(issueBId);
  });

  it("listMonitoredUrls never returns another shop's URLs", async () => {
    const urlsA = await listMonitoredUrls(domainA);
    const urlsB = await listMonitoredUrls(domainB);

    expect(urlsA.every((u) => u.includes(domainA))).toBe(true);
    expect(urlsB.every((u) => u.includes(domainB))).toBe(true);
  });

  it("getActivePlan reflects each shop's own subscription, not the other's", async () => {
    expect((await BillingService.getActivePlan(domainA)).tier).toBe("GROWTH");
    expect((await BillingService.getActivePlan(domainB)).tier).toBe("STARTER");
  });

  it("resolveIssue scoped to the wrong shopId cannot touch another tenant's issue", async () => {
    const ok = await IssueService.resolveIssue(issueBId, shopAId);
    expect(ok).toBe(false);

    const stillOpen = await prisma.issue.findUnique({ where: { id: issueBId } });
    expect(stillOpen?.status).toBe("OPEN");
  });

  it("resolveIssue scoped to the correct shopId does work", async () => {
    const ok = await IssueService.resolveIssue(issueAId, shopAId);
    expect(ok).toBe(true);

    const resolved = await prisma.issue.findUnique({ where: { id: issueAId } });
    expect(resolved?.status).toBe("RESOLVED");
  });

  it("createRedirect refuses an issueId that belongs to another shop", async () => {
    const result = await RedirectManagementService.createRedirect({
      session: { shop: domainA } as Parameters<
        typeof RedirectManagementService.createRedirect
      >[0]["session"],
      shopDomain: domainA,
      fromUrl: "/some-path",
      toUrl: "/some-target",
      confirmed: true,
      issueId: issueBId,
    });

    expect(result).toEqual({ ok: false, error: "Issue not found" });

    // No history row should have been written for shop A pointing at shop B's issue.
    const historyA = await RedirectManagementService.listHistory(domainA);
    expect(historyA.find((entry) => entry.issueId === issueBId)).toBeUndefined();
  });

  it("deleting shop A cascades away only shop A's rows, leaving shop B untouched", async () => {
    await cleanupShop(domainA);

    expect(await getShop(domainA)).toBeNull();
    expect(await prisma.issue.findUnique({ where: { id: issueAId } })).toBeNull();
    expect(await prisma.subscription.findUnique({ where: { shopId: shopAId } })).toBeNull();

    // Shop B's data survives.
    expect(await getShop(domainB)).not.toBeNull();
    expect(await prisma.issue.findUnique({ where: { id: issueBId } })).not.toBeNull();
    expect((await BillingService.getActivePlan(domainB)).tier).toBe("STARTER");
  });
});
