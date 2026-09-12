import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkCheckResult } from "@/lib/crawler";

const checkLinkMock = vi.fn();
const scanResultCreateMock = vi.fn();
const urlLinkUpdateMock = vi.fn();
const scanJobUpdateMock = vi.fn();
const processScanResultMock = vi.fn();

vi.mock("@/lib/crawler", () => ({ checkLink: checkLinkMock }));
vi.mock("@/lib/database/client.server", () => ({
  prisma: {
    scanResult: { create: scanResultCreateMock },
    urlLink: { update: urlLinkUpdateMock },
    scanJob: { update: scanJobUpdateMock },
  },
}));
vi.mock("@/lib/issues/issue.server", () => ({
  IssueService: { processScanResult: processScanResultMock },
}));

const { ScanService } = await import("./scan.server");

function fakeResult(overrides: Partial<LinkCheckResult> = {}): LinkCheckResult {
  return {
    url: "https://shop.example/a",
    finalUrl: "https://shop.example/a",
    statusCode: 200,
    responseTimeMs: 42,
    redirectChain: [],
    resultType: "OK",
    errorMessage: null,
    checkedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("ScanService.checkUrl", () => {
  it("passes through to lib/crawler with no persistence", async () => {
    checkLinkMock.mockReset().mockResolvedValue(fakeResult());
    const result = await ScanService.checkUrl("https://shop.example/a", { timeoutMs: 5000 });

    expect(checkLinkMock).toHaveBeenCalledWith("https://shop.example/a", { timeoutMs: 5000 });
    expect(result.resultType).toBe("OK");
    expect(scanResultCreateMock).not.toHaveBeenCalled();
  });
});

describe("ScanService.scanUrls", () => {
  beforeEach(() => {
    checkLinkMock.mockReset();
    scanResultCreateMock.mockReset().mockResolvedValue({ id: "scan-result-1" });
    urlLinkUpdateMock.mockReset().mockResolvedValue(undefined);
    scanJobUpdateMock.mockReset().mockResolvedValue(undefined);
    processScanResultMock.mockReset().mockResolvedValue(undefined);
  });

  it("checks every link and persists one ScanResult each, in order", async () => {
    checkLinkMock.mockImplementation(async (url: string) =>
      fakeResult({ url, finalUrl: url }),
    );

    const urlLinks = [
      { id: "link-1", targetUrl: "https://shop.example/1", isExternal: false },
      { id: "link-2", targetUrl: "https://shop.example/2", isExternal: false },
      { id: "link-3", targetUrl: "https://shop.example/3", isExternal: true },
    ];

    const results = await ScanService.scanUrls({
      shopId: "shop-1",
      shopDomain: "shop.myshopify.com",
      scanJobId: "job-1",
      urlLinks,
    });

    expect(results.map((r) => r.url)).toEqual([
      "https://shop.example/1",
      "https://shop.example/2",
      "https://shop.example/3",
    ]);
    expect(scanResultCreateMock).toHaveBeenCalledTimes(3);
    expect(urlLinkUpdateMock).toHaveBeenCalledTimes(3);
    expect(scanJobUpdateMock).toHaveBeenCalledTimes(3);

    expect(scanResultCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shopId: "shop-1",
        scanJobId: "job-1",
        urlLinkId: "link-1",
        statusCode: 200,
        resultType: "OK",
      }),
    });
    expect(scanJobUpdateMock).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { urlsChecked: { increment: 1 } },
    });
    expect(processScanResultMock).toHaveBeenCalledWith({
      shopId: "shop-1",
      shopDomain: "shop.myshopify.com",
      urlLinkId: "link-1",
      url: "https://shop.example/1",
      isExternal: false,
      scanResultId: "scan-result-1",
      statusCode: 200,
      resultType: "OK",
      redirectChainLength: 0,
    });
    expect(processScanResultMock).toHaveBeenCalledWith(
      expect.objectContaining({ urlLinkId: "link-3", isExternal: true }),
    );
  });

  it("respects the concurrency cap (never more in-flight than requested)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    checkLinkMock.mockImplementation(async (url: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return fakeResult({ url });
    });

    const urlLinks = Array.from({ length: 10 }, (_, i) => ({
      id: `link-${i}`,
      targetUrl: `https://shop.example/${i}`,
      isExternal: false,
    }));

    await ScanService.scanUrls({
      shopId: "shop-1",
      shopDomain: "shop.myshopify.com",
      scanJobId: "job-1",
      urlLinks,
      concurrency: 2,
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(checkLinkMock).toHaveBeenCalledTimes(10);
  });

  it("continues checking remaining links when persisting one result fails", async () => {
    checkLinkMock.mockImplementation(async (url: string) => fakeResult({ url }));
    scanResultCreateMock
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue({ id: "scan-result-2" });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const urlLinks = [
      { id: "link-1", targetUrl: "https://shop.example/1", isExternal: false },
      { id: "link-2", targetUrl: "https://shop.example/2", isExternal: false },
    ];

    const results = await ScanService.scanUrls({
      shopId: "shop-1",
      shopDomain: "shop.myshopify.com",
      scanJobId: "job-1",
      urlLinks,
      concurrency: 1,
    });

    // Both checks still ran and both are in the returned results, even
    // though the first one's DB write failed.
    expect(results).toHaveLength(2);
    expect(checkLinkMock).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalled();
    // The link whose create() failed never got a scanResultId, so issue
    // detection correctly never ran for it.
    expect(processScanResultMock).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });

  it("returns an empty array for an empty batch without touching the database", async () => {
    const results = await ScanService.scanUrls({
      shopId: "shop-1",
      shopDomain: "shop.myshopify.com",
      scanJobId: "job-1",
      urlLinks: [],
    });

    expect(results).toEqual([]);
    expect(checkLinkMock).not.toHaveBeenCalled();
  });
});
