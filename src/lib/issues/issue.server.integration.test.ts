import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/database/client.server";
import { getShop, markShopInstalled } from "@/lib/database/shops.server";
import { IssueService } from "@/lib/issues/issue.server";
import { cleanupShop, uniqueShopDomain } from "@/lib/test-support/integration.server";

/**
 * Runs the real detection state machine against real Postgres, including
 * the shopId_urlLinkId_type unique constraint that a mocked findUnique
 * could never actually validate — this is what would catch a migration
 * drifting out of sync with the Prisma schema.
 */
describe("Issue detection (real Postgres)", () => {
  const shopDomain = uniqueShopDomain("issues");
  let shopId: string;
  let urlLinkId: string;

  beforeAll(async () => {
    await markShopInstalled(shopDomain);
    shopId = (await getShop(shopDomain))!.id;
  });

  afterAll(async () => {
    await cleanupShop(shopDomain);
  });

  beforeEach(async () => {
    await prisma.issue.deleteMany({ where: { shopId } });
    await prisma.scanResult.deleteMany({ where: { shopId } });
    await prisma.urlLink.deleteMany({ where: { shopId } });
    await prisma.url.deleteMany({ where: { shopId } });
    scanJobId = undefined;
    const url = await prisma.url.create({
      data: { shopId, url: `https://${shopDomain}/`, source: "HOMEPAGE" },
    });
    const urlLink = await prisma.urlLink.create({
      data: { shopId, sourceUrlId: url.id, targetUrl: `https://${shopDomain}/page`, isExternal: false },
    });
    urlLinkId = urlLink.id;
  });

  async function scanResult(resultType: "OK" | "NOT_FOUND" | "SERVER_ERROR" = "NOT_FOUND") {
    return prisma.scanResult.create({
      data: { shopId, scanJobId: await ensureScanJob(), urlLinkId, resultType, statusCode: 404 },
    });
  }

  let scanJobId: string | undefined;
  async function ensureScanJob(): Promise<string> {
    if (scanJobId) return scanJobId;
    const job = await prisma.scanJob.create({ data: { shopId, status: "RUNNING", trigger: "MANUAL" } });
    scanJobId = job.id;
    return job.id;
  }

  it("creates an OPEN, CRITICAL issue for an internal 404", async () => {
    const result = await scanResult("NOT_FOUND");

    await IssueService.processScanResult({
      shopId,
      shopDomain,
      urlLinkId,
      url: `https://${shopDomain}/page`,
      isExternal: false,
      scanResultId: result.id,
      statusCode: 404,
      resultType: "NOT_FOUND",
      redirectChainLength: 0,
    });

    const issues = await IssueService.listOpenIssues(shopDomain);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("BROKEN_404");
    expect(issues[0].severity).toBe("CRITICAL");
  });

  it("classifies the same failure as WARNING when the link is external", async () => {
    const result = await scanResult("NOT_FOUND");

    await IssueService.processScanResult({
      shopId,
      shopDomain,
      urlLinkId,
      url: `https://${shopDomain}/page`,
      isExternal: true,
      scanResultId: result.id,
      statusCode: 404,
      resultType: "NOT_FOUND",
      redirectChainLength: 0,
    });

    const issues = await IssueService.listOpenIssues(shopDomain);
    expect(issues[0].severity).toBe("WARNING");
  });

  it("respects the real unique constraint: a second 404 on the same link updates, never duplicates", async () => {
    for (let i = 0; i < 2; i++) {
      const result = await scanResult("NOT_FOUND");
      await IssueService.processScanResult({
        shopId,
        shopDomain,
        urlLinkId,
        url: `https://${shopDomain}/page`,
        isExternal: false,
        scanResultId: result.id,
        statusCode: 404,
        resultType: "NOT_FOUND",
        redirectChainLength: 0,
      });
    }

    const rows = await prisma.issue.findMany({ where: { shopId, urlLinkId, type: "BROKEN_404" } });
    expect(rows).toHaveLength(1);
  });

  it("self-heals: a later OK result resolves the open issue automatically", async () => {
    const broken = await scanResult("NOT_FOUND");
    await IssueService.processScanResult({
      shopId,
      shopDomain,
      urlLinkId,
      url: `https://${shopDomain}/page`,
      isExternal: false,
      scanResultId: broken.id,
      statusCode: 404,
      resultType: "NOT_FOUND",
      redirectChainLength: 0,
    });

    const fixed = await scanResult("OK");
    await IssueService.processScanResult({
      shopId,
      shopDomain,
      urlLinkId,
      url: `https://${shopDomain}/page`,
      isExternal: false,
      scanResultId: fixed.id,
      statusCode: 200,
      resultType: "OK",
      redirectChainLength: 0,
    });

    expect(await IssueService.listOpenIssues(shopDomain)).toEqual([]);
    const resolved = await prisma.issue.findFirst({ where: { shopId, urlLinkId } });
    expect(resolved?.status).toBe("RESOLVED");
  });

  it("reopens a resolved issue if the same failure recurs (a regression)", async () => {
    const first = await scanResult("NOT_FOUND");
    await IssueService.processScanResult({
      shopId, shopDomain, urlLinkId, url: `https://${shopDomain}/page`, isExternal: false,
      scanResultId: first.id, statusCode: 404, resultType: "NOT_FOUND", redirectChainLength: 0,
    });
    await IssueService.resolveIssue(
      (await prisma.issue.findFirstOrThrow({ where: { shopId, urlLinkId } })).id,
      shopId,
    );

    const again = await scanResult("NOT_FOUND");
    await IssueService.processScanResult({
      shopId, shopDomain, urlLinkId, url: `https://${shopDomain}/page`, isExternal: false,
      scanResultId: again.id, statusCode: 404, resultType: "NOT_FOUND", redirectChainLength: 0,
    });

    const issue = await prisma.issue.findFirstOrThrow({ where: { shopId, urlLinkId } });
    expect(issue.status).toBe("OPEN");
    expect(issue.resolvedAt).toBeNull();
  });

  it("an IGNORED issue stays ignored across rescans but still gets fresh evidence", async () => {
    const first = await scanResult("NOT_FOUND");
    await IssueService.processScanResult({
      shopId, shopDomain, urlLinkId, url: `https://${shopDomain}/page`, isExternal: false,
      scanResultId: first.id, statusCode: 404, resultType: "NOT_FOUND", redirectChainLength: 0,
    });
    const issueId = (await prisma.issue.findFirstOrThrow({ where: { shopId, urlLinkId } })).id;
    await IssueService.ignoreIssue(issueId, shopId);

    const again = await scanResult("NOT_FOUND");
    await IssueService.processScanResult({
      shopId, shopDomain, urlLinkId, url: `https://${shopDomain}/page`, isExternal: false,
      scanResultId: again.id, statusCode: 404, resultType: "NOT_FOUND", redirectChainLength: 0,
    });

    const issue = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });
    expect(issue.status).toBe("IGNORED");
    expect(issue.scanResultId).toBe(again.id);
    expect(await IssueService.listOpenIssues(shopDomain)).toEqual([]);
  });
});
