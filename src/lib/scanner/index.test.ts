import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@shopify/shopify-api";

const scanJobUpdateMock = vi.fn();
const urlUpsertMock = vi.fn();
const urlLinkUpsertMock = vi.fn();
const urlLinkFindManyMock = vi.fn();
const scanJobFindManyMock = vi.fn();
const scanJobFindFirstMock = vi.fn();
const getShopMock = vi.fn();
const loadOfflineSessionForShopMock = vi.fn();
const discoverMock = vi.fn();
const scanUrlsMock = vi.fn();
const notifyScanCompletedMock = vi.fn();
const getMaxUrlsMock = vi.fn();
const recordScanUsageMock = vi.fn();

vi.mock("@/lib/database/client.server", () => ({
  prisma: {
    scanJob: { update: scanJobUpdateMock, findMany: scanJobFindManyMock, findFirst: scanJobFindFirstMock },
    url: { upsert: urlUpsertMock },
    urlLink: { upsert: urlLinkUpsertMock, findMany: urlLinkFindManyMock },
  },
}));
vi.mock("@/lib/database/shops.server", () => ({ getShop: getShopMock }));
vi.mock("@/lib/shopify/session.server", () => ({
  loadOfflineSessionForShop: loadOfflineSessionForShopMock,
}));
vi.mock("@/lib/scanner/url-discovery.server", () => ({
  URLDiscoveryService: { discover: discoverMock },
}));
vi.mock("@/lib/scanner/scan.server", () => ({
  ScanService: { scanUrls: scanUrlsMock },
}));
vi.mock("@/lib/notifications", () => ({
  NotificationService: { notifyScanCompleted: notifyScanCompletedMock },
}));
vi.mock("@/lib/billing", () => ({
  BillingService: { getMaxUrls: getMaxUrlsMock, recordScanUsage: recordScanUsageMock },
}));

const { runScan, listMonitoredUrls, listScans, getScanStatus } = await import("./index");

const fakeSession = { shop: "test.myshopify.com" } as Session;

describe("runScan", () => {
  beforeEach(() => {
    scanJobUpdateMock.mockReset().mockResolvedValue(undefined);
    urlUpsertMock.mockReset();
    urlLinkUpsertMock.mockReset();
    getShopMock.mockReset().mockResolvedValue({ id: "shop-1", shopDomain: "test.myshopify.com" });
    loadOfflineSessionForShopMock.mockReset().mockResolvedValue(fakeSession);
    discoverMock.mockReset();
    scanUrlsMock.mockReset();
    notifyScanCompletedMock.mockReset().mockResolvedValue(undefined);
    getMaxUrlsMock.mockReset().mockResolvedValue(1000);
    recordScanUsageMock.mockReset().mockResolvedValue(undefined);
  });

  it("throws when there's no Shop row for the domain", async () => {
    getShopMock.mockResolvedValue(null);
    await expect(runScan("ghost.myshopify.com", "job-1")).rejects.toThrow(
      "No shop record",
    );
  });

  it("throws when there's no stored offline session", async () => {
    loadOfflineSessionForShopMock.mockResolvedValue(undefined);
    await expect(runScan("test.myshopify.com", "job-1")).rejects.toThrow(
      "No offline session",
    );
  });

  it("discovers, persists Url/UrlLink rows, scans them, and finalizes as COMPLETED", async () => {
    discoverMock.mockResolvedValue({
      shopDomain: "test.myshopify.com",
      urls: [
        { url: "https://test.example/", source: "HOMEPAGE", isExternal: false },
        { url: "https://test.example/products/a", source: "PRODUCT", isExternal: false },
      ],
      sourceCounts: {},
    });
    urlUpsertMock
      .mockResolvedValueOnce({ id: "url-1", url: "https://test.example/" })
      .mockResolvedValueOnce({ id: "url-2", url: "https://test.example/products/a" });
    urlLinkUpsertMock
      .mockResolvedValueOnce({ id: "link-1", targetUrl: "https://test.example/", isExternal: false })
      .mockResolvedValueOnce({
        id: "link-2",
        targetUrl: "https://test.example/products/a",
        isExternal: false,
      });
    scanUrlsMock.mockResolvedValue([
      { url: "https://test.example/", resultType: "OK" },
      { url: "https://test.example/products/a", resultType: "NOT_FOUND" },
    ]);

    const summary = await runScan("test.myshopify.com", "job-1");

    expect(scanUrlsMock).toHaveBeenCalledWith({
      shopId: "shop-1",
      shopDomain: "test.myshopify.com",
      scanJobId: "job-1",
      urlLinks: [
        { id: "link-1", targetUrl: "https://test.example/", isExternal: false },
        { id: "link-2", targetUrl: "https://test.example/products/a", isExternal: false },
      ],
      concurrency: 5,
    });

    // RUNNING -> urlsQueued -> COMPLETED
    expect(scanJobUpdateMock).toHaveBeenNthCalledWith(1, {
      where: { id: "job-1" },
      data: expect.objectContaining({ status: "RUNNING" }),
    });
    expect(scanJobUpdateMock).toHaveBeenNthCalledWith(2, {
      where: { id: "job-1" },
      data: { urlsQueued: 2 },
    });
    expect(scanJobUpdateMock).toHaveBeenNthCalledWith(3, {
      where: { id: "job-1" },
      data: expect.objectContaining({ status: "COMPLETED", issuesFound: 1 }),
    });

    expect(summary.linksChecked).toBe(2);
    expect(summary.issuesFound).toBe(1);
    expect(summary.shopDomain).toBe("test.myshopify.com");
    expect(notifyScanCompletedMock).toHaveBeenCalledWith("test.myshopify.com", summary);
    // Recorded once, on completion — not per-URL, not per-retry.
    expect(recordScanUsageMock).toHaveBeenCalledTimes(1);
    expect(recordScanUsageMock).toHaveBeenCalledWith("shop-1");
  });

  it("caps discovered URLs at the plan's maxUrls before persisting any of them", async () => {
    getMaxUrlsMock.mockResolvedValue(1);
    discoverMock.mockResolvedValue({
      shopDomain: "test.myshopify.com",
      urls: [
        { url: "https://test.example/", source: "HOMEPAGE", isExternal: false },
        { url: "https://test.example/products/a", source: "PRODUCT", isExternal: false },
      ],
      sourceCounts: {},
    });
    urlUpsertMock.mockResolvedValueOnce({ id: "url-1", url: "https://test.example/" });
    urlLinkUpsertMock.mockResolvedValueOnce({
      id: "link-1",
      targetUrl: "https://test.example/",
      isExternal: false,
    });
    scanUrlsMock.mockResolvedValue([{ url: "https://test.example/", resultType: "OK" }]);

    await runScan("test.myshopify.com", "job-1");

    expect(urlUpsertMock).toHaveBeenCalledTimes(1);
    expect(scanUrlsMock).toHaveBeenCalledWith(
      expect.objectContaining({ urlLinks: [{ id: "link-1", targetUrl: "https://test.example/", isExternal: false }] }),
    );
  });

  it("propagates a discovery failure without marking the job FAILED itself", async () => {
    discoverMock.mockRejectedValue(new Error("Admin API rate limited"));

    await expect(runScan("test.myshopify.com", "job-1")).rejects.toThrow(
      "Admin API rate limited",
    );
    // Only the initial RUNNING update should have happened — finalizing
    // (COMPLETED/FAILED) is the worker's job, not runScan's.
    expect(scanJobUpdateMock).toHaveBeenCalledTimes(1);
  });
});

describe("listMonitoredUrls", () => {
  it("returns [] when the shop doesn't exist", async () => {
    getShopMock.mockReset().mockResolvedValue(null);
    expect(await listMonitoredUrls("ghost.myshopify.com")).toEqual([]);
  });

  it("returns distinct target URLs for the shop", async () => {
    getShopMock.mockReset().mockResolvedValue({ id: "shop-1" });
    urlLinkFindManyMock.mockReset().mockResolvedValue([
      { targetUrl: "https://test.example/a" },
      { targetUrl: "https://test.example/b" },
    ]);

    const urls = await listMonitoredUrls("test.myshopify.com");

    expect(urls).toEqual(["https://test.example/a", "https://test.example/b"]);
  });
});

describe("listScans", () => {
  it("returns [] when the shop doesn't exist", async () => {
    getShopMock.mockReset().mockResolvedValue(null);
    expect(await listScans("ghost.myshopify.com")).toEqual([]);
  });

  it("maps finished ScanJob rows and skips ones still in progress", async () => {
    getShopMock.mockReset().mockResolvedValue({ id: "shop-1" });
    scanJobFindManyMock.mockReset().mockResolvedValue([
      {
        urlsChecked: 10,
        issuesFound: 2,
        startedAt: new Date("2026-01-01"),
        finishedAt: new Date("2026-01-01T00:05:00Z"),
      },
      { urlsChecked: 0, issuesFound: 0, startedAt: null, finishedAt: null },
    ]);

    const scans = await listScans("test.myshopify.com");

    expect(scans).toHaveLength(1);
    expect(scans[0].linksChecked).toBe(10);
    expect(scans[0].issuesFound).toBe(2);
  });
});

describe("getScanStatus", () => {
  beforeEach(() => {
    getShopMock.mockReset();
    scanJobFindFirstMock.mockReset();
  });

  it("returns null when the shop doesn't exist", async () => {
    getShopMock.mockResolvedValue(null);
    expect(await getScanStatus("ghost.myshopify.com", "job-1")).toBeNull();
    expect(scanJobFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns null when the job doesn't exist for this shop (wrong shop or bad id)", async () => {
    getShopMock.mockResolvedValue({ id: "shop-1" });
    scanJobFindFirstMock.mockResolvedValue(null);

    expect(await getScanStatus("test.myshopify.com", "someone-elses-job")).toBeNull();
    expect(scanJobFindFirstMock).toHaveBeenCalledWith({
      where: { id: "someone-elses-job", shopId: "shop-1" },
      select: { status: true, urlsQueued: true, urlsChecked: true, issuesFound: true },
    });
  });

  it("returns the job's live status fields", async () => {
    getShopMock.mockResolvedValue({ id: "shop-1" });
    scanJobFindFirstMock.mockResolvedValue({
      status: "RUNNING",
      urlsQueued: 10,
      urlsChecked: 4,
      issuesFound: 1,
    });

    const status = await getScanStatus("test.myshopify.com", "job-1");

    expect(status).toEqual({ status: "RUNNING", urlsQueued: 10, urlsChecked: 4, issuesFound: 1 });
  });
});
