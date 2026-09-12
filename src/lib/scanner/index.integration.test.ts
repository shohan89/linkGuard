import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The one genuinely external dependency here is the Shopify Admin API
// call inside URLDiscoveryService — everything else (DB, crawler network
// calls, issue detection) is real. Discovery is pointed at a fixed,
// controlled set of httpbin.org URLs instead of live storefront content,
// so the scan pipeline's own DB persistence is what's under test.
const discoverMock = vi.fn();
vi.mock("@/lib/scanner/url-discovery.server", () => ({
  URLDiscoveryService: { discover: discoverMock },
}));

const { prisma } = await import("@/lib/database/client.server");
const { getShop, markShopInstalled } = await import("@/lib/database/shops.server");
const { shopify, sessionStorage } = await import("@/lib/shopify/client.server");
const { runScan, listMonitoredUrls, listScans } = await import("./index");
const { Session } = await import("@shopify/shopify-api");
const { cleanupShop, uniqueShopDomain } = await import("@/lib/test-support/integration.server");

describe("Scanner pipeline (real Postgres + real crawler network calls)", () => {
  const shopDomain = uniqueShopDomain("scanner");
  let shopId: string;

  beforeAll(async () => {
    await markShopInstalled(shopDomain);
    shopId = (await getShop(shopDomain))!.id;

    await sessionStorage.storeSession(
      new Session({
        id: shopify.session.getOfflineId(shopDomain),
        shop: shopDomain,
        state: "test-state",
        isOnline: false,
        accessToken: "shpat_test_token_value",
      }),
    );

    discoverMock.mockResolvedValue({
      shopDomain,
      urls: [
        { url: "https://httpbin.org/status/200", source: "HOMEPAGE", isExternal: false },
        { url: "https://httpbin.org/status/404", source: "PAGE", isExternal: false },
        { url: "https://httpbin.org/status/500", source: "PAGE", isExternal: false },
      ],
      sourceCounts: {},
    });
  });

  afterAll(async () => {
    await cleanupShop(shopDomain);
  });

  it("discovers, persists, checks (real network), and finalizes a scan job", async () => {
    const scanJob = await prisma.scanJob.create({
      data: { shopId, status: "PENDING", trigger: "MANUAL" },
    });

    const summary = await runScan(shopDomain, scanJob.id);

    expect(summary.linksChecked).toBe(3);
    expect(summary.issuesFound).toBe(2); // the 404 and the 500

    const urls = await listMonitoredUrls(shopDomain);
    expect(urls.sort()).toEqual(
      [
        "https://httpbin.org/status/200",
        "https://httpbin.org/status/404",
        "https://httpbin.org/status/500",
      ].sort(),
    );

    // runScan finalizes success itself (COMPLETED + finishedAt) — only the
    // FAILED path is left to the worker's catch handler, for a thrown error.
    const finishedJob = await prisma.scanJob.findUnique({ where: { id: scanJob.id } });
    expect(finishedJob?.status).toBe("COMPLETED");
    expect(finishedJob?.finishedAt).not.toBeNull();
  }, 30_000);

  it("real ScanResult rows and Issue rows exist for the broken links", async () => {
    const issues = await prisma.issue.findMany({ where: { shopId }, include: { urlLink: true } });
    const types = issues.map((i) => `${i.type}:${i.urlLink.targetUrl}`);

    expect(types).toContain("BROKEN_404:https://httpbin.org/status/404");
    expect(types).toContain("SERVER_ERROR_5XX:https://httpbin.org/status/500");
    expect(issues.every((i) => i.status === "OPEN")).toBe(true);

    const scanResults = await prisma.scanResult.findMany({ where: { shopId } });
    expect(scanResults).toHaveLength(3);
  });

  it("listScans reports the completed job runScan already finalized", async () => {
    const scans = await listScans(shopDomain);
    expect(scans).toHaveLength(1);
    expect(scans[0].issuesFound).toBe(2);
    expect(scans[0].linksChecked).toBe(3);
  });
});
