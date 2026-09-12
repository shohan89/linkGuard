import { beforeEach, describe, expect, it, vi } from "vitest";

const issueUpdateManyMock = vi.fn();
const issueFindUniqueMock = vi.fn();
const issueCreateMock = vi.fn();
const issueUpdateMock = vi.fn();
const issueFindManyMock = vi.fn();
const getShopMock = vi.fn();
const notifyIssueDetectedMock = vi.fn();

vi.mock("@/lib/database/client.server", () => ({
  prisma: {
    issue: {
      updateMany: issueUpdateManyMock,
      findUnique: issueFindUniqueMock,
      create: issueCreateMock,
      update: issueUpdateMock,
      findMany: issueFindManyMock,
    },
  },
}));
vi.mock("@/lib/database/shops.server", () => ({ getShop: getShopMock }));
vi.mock("@/lib/notifications", () => ({
  NotificationService: { notifyIssueDetected: notifyIssueDetectedMock },
}));

const { IssueService } = await import("./issue.server");

function baseInput(overrides: Partial<Parameters<typeof IssueService.processScanResult>[0]> = {}) {
  return {
    shopId: "shop-1",
    shopDomain: "shop.myshopify.com",
    urlLinkId: "link-1",
    url: "https://shop.example/page",
    isExternal: false,
    scanResultId: "result-1",
    statusCode: 200,
    resultType: "OK" as const,
    redirectChainLength: 0,
    ...overrides,
  };
}

/** Mirrors what Prisma's create() actually does: returns the row it just wrote. */
function echoCreate({
  data,
}: {
  data: {
    type: string;
    severity: string;
    status: string;
    statusCode: number | null;
    firstSeenAt: Date;
    lastSeenAt: Date;
  };
}) {
  return Promise.resolve({
    id: "new-issue-id",
    type: data.type,
    severity: data.severity,
    status: data.status,
    statusCode: data.statusCode,
    firstSeenAt: data.firstSeenAt,
    lastSeenAt: data.lastSeenAt,
    resolvedAt: null,
  });
}

describe("IssueService.processScanResult — type & severity classification", () => {
  beforeEach(() => {
    issueUpdateManyMock.mockReset().mockResolvedValue({ count: 0 });
    issueFindUniqueMock.mockReset().mockResolvedValue(null);
    issueCreateMock.mockReset().mockImplementation(echoCreate);
    notifyIssueDetectedMock.mockReset().mockResolvedValue(undefined);
    issueUpdateMock.mockReset().mockResolvedValue(undefined);
  });

  it("does nothing for a clean OK with no redirect", async () => {
    await IssueService.processScanResult(baseInput());
    expect(issueCreateMock).not.toHaveBeenCalled();
  });

  it("does not flag a short redirect chain (2 hops) that resolves OK", async () => {
    await IssueService.processScanResult(
      baseInput({ resultType: "OK", redirectChainLength: 2 }),
    );
    expect(issueCreateMock).not.toHaveBeenCalled();
  });

  it("flags a long redirect chain (3+ hops) as REDIRECT_PROBLEM/WARNING", async () => {
    await IssueService.processScanResult(
      baseInput({ resultType: "OK", redirectChainLength: 3 }),
    );
    expect(issueCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "REDIRECT_PROBLEM", severity: "WARNING" }),
      }),
    );
  });

  it("notifies NotificationService with the shop domain and issue DTO whenever a new issue is created", async () => {
    await IssueService.processScanResult(
      baseInput({ resultType: "NOT_FOUND", statusCode: 404, url: "https://shop.example/missing" }),
    );

    expect(notifyIssueDetectedMock).toHaveBeenCalledWith(
      "shop.myshopify.com",
      expect.objectContaining({
        id: "new-issue-id",
        url: "https://shop.example/missing",
        type: "BROKEN_404",
      }),
    );
  });

  it("does not notify when the result is healthy and no issue is created", async () => {
    await IssueService.processScanResult(baseInput({ resultType: "OK" }));
    expect(notifyIssueDetectedMock).not.toHaveBeenCalled();
  });

  it("flags an exhausted redirect chain as REDIRECT_LOOP/CRITICAL regardless of external", async () => {
    await IssueService.processScanResult(
      baseInput({ resultType: "REDIRECT", isExternal: true }),
    );
    expect(issueCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "REDIRECT_LOOP", severity: "CRITICAL" }),
      }),
    );
  });

  it("classifies a 404 on an internal link as CRITICAL", async () => {
    await IssueService.processScanResult(
      baseInput({ resultType: "NOT_FOUND", isExternal: false, statusCode: 404 }),
    );
    expect(issueCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "BROKEN_404", severity: "CRITICAL" }),
      }),
    );
  });

  it("classifies a 404 on an external link as WARNING", async () => {
    await IssueService.processScanResult(
      baseInput({ resultType: "NOT_FOUND", isExternal: true, statusCode: 404 }),
    );
    expect(issueCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "BROKEN_404", severity: "WARNING" }),
      }),
    );
  });

  it("classifies 410 GONE the same as a broken link", async () => {
    await IssueService.processScanResult(
      baseInput({ resultType: "GONE", isExternal: false, statusCode: 410 }),
    );
    expect(issueCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "BROKEN_404" }) }),
    );
  });

  it("classifies a 5xx on an internal link as CRITICAL, external as WARNING", async () => {
    await IssueService.processScanResult(
      baseInput({ resultType: "SERVER_ERROR", isExternal: false, statusCode: 500 }),
    );
    expect(issueCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "SERVER_ERROR_5XX", severity: "CRITICAL" }),
      }),
    );

    issueCreateMock.mockClear();
    await IssueService.processScanResult(
      baseInput({ resultType: "SERVER_ERROR", isExternal: true, statusCode: 503 }),
    );
    expect(issueCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "SERVER_ERROR_5XX", severity: "WARNING" }),
      }),
    );
  });

  it("classifies a timeout as TIMEOUT/WARNING", async () => {
    await IssueService.processScanResult(baseInput({ resultType: "TIMEOUT", statusCode: null }));
    expect(issueCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "TIMEOUT", severity: "WARNING" }) }),
    );
  });

  it("classifies a DNS failure as OTHER/WARNING", async () => {
    await IssueService.processScanResult(baseInput({ resultType: "DNS_ERROR", statusCode: null }));
    expect(issueCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "OTHER", severity: "WARNING" }) }),
    );
  });
});

describe("IssueService.processScanResult — lifecycle (dedup, resolve, reopen)", () => {
  beforeEach(() => {
    issueUpdateManyMock.mockReset().mockResolvedValue({ count: 0 });
    issueFindUniqueMock.mockReset().mockResolvedValue(null);
    issueCreateMock.mockReset().mockImplementation(echoCreate);
    notifyIssueDetectedMock.mockReset().mockResolvedValue(undefined);
    issueUpdateMock.mockReset().mockResolvedValue(undefined);
  });

  it("resolves any other open issue type on the same link that's no longer warranted", async () => {
    await IssueService.processScanResult(baseInput({ resultType: "NOT_FOUND", statusCode: 404 }));

    expect(issueUpdateManyMock).toHaveBeenCalledWith({
      where: {
        shopId: "shop-1",
        urlLinkId: "link-1",
        status: "OPEN",
        type: { not: "BROKEN_404" },
      },
      data: { status: "RESOLVED", resolvedAt: expect.any(Date) },
    });
  });

  it("resolves ALL open issues on a link that's healthy again (no warranted type)", async () => {
    await IssueService.processScanResult(baseInput({ resultType: "OK" }));

    expect(issueUpdateManyMock).toHaveBeenCalledWith({
      where: { shopId: "shop-1", urlLinkId: "link-1", status: "OPEN" },
      data: { status: "RESOLVED", resolvedAt: expect.any(Date) },
    });
    expect(issueCreateMock).not.toHaveBeenCalled();
  });

  it("bumps lastSeenAt on an existing OPEN issue of the same type instead of duplicating", async () => {
    issueFindUniqueMock.mockResolvedValue({ id: "issue-1", status: "OPEN" });

    await IssueService.processScanResult(baseInput({ resultType: "NOT_FOUND", statusCode: 404 }));

    expect(issueCreateMock).not.toHaveBeenCalled();
    expect(issueUpdateMock).toHaveBeenCalledWith({
      where: { id: "issue-1" },
      data: expect.objectContaining({ status: "OPEN", lastSeenAt: expect.any(Date) }),
    });
    // Not a new issue — no notification for a repeat detection of the same one.
    expect(notifyIssueDetectedMock).not.toHaveBeenCalled();
  });

  it("reopens a RESOLVED issue that's recurring (regression)", async () => {
    issueFindUniqueMock.mockResolvedValue({ id: "issue-1", status: "RESOLVED" });

    await IssueService.processScanResult(baseInput({ resultType: "SERVER_ERROR", statusCode: 500 }));

    expect(issueUpdateMock).toHaveBeenCalledWith({
      where: { id: "issue-1" },
      data: expect.objectContaining({ status: "OPEN", resolvedAt: null }),
    });
  });

  it("leaves an IGNORED issue ignored but refreshes its evidence", async () => {
    issueFindUniqueMock.mockResolvedValue({ id: "issue-1", status: "IGNORED" });

    await IssueService.processScanResult(
      baseInput({ resultType: "NOT_FOUND", statusCode: 404, scanResultId: "result-2" }),
    );

    expect(issueUpdateMock).toHaveBeenCalledWith({
      where: { id: "issue-1" },
      data: { lastSeenAt: expect.any(Date), statusCode: 404, scanResultId: "result-2" },
    });
    // Never flips it back to OPEN.
    expect(issueUpdateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "OPEN" }) }),
    );
  });
});

describe("IssueService.listOpenIssues / listRedirectIssues", () => {
  beforeEach(() => {
    getShopMock.mockReset();
    issueFindManyMock.mockReset();
  });

  it("returns [] when the shop doesn't exist", async () => {
    getShopMock.mockResolvedValue(null);
    expect(await IssueService.listOpenIssues("ghost.myshopify.com")).toEqual([]);
  });

  it("maps Issue + urlLink join into the flat DTO", async () => {
    getShopMock.mockResolvedValue({ id: "shop-1" });
    const now = new Date("2026-01-01T00:00:00Z");
    issueFindManyMock.mockResolvedValue([
      {
        id: "issue-1",
        type: "BROKEN_404",
        severity: "CRITICAL",
        status: "OPEN",
        statusCode: 404,
        firstSeenAt: now,
        lastSeenAt: now,
        resolvedAt: null,
        urlLink: { targetUrl: "https://shop.example/missing", isExternal: false },
      },
    ]);

    const issues = await IssueService.listOpenIssues("shop.myshopify.com");

    expect(issues).toEqual([
      {
        id: "issue-1",
        url: "https://shop.example/missing",
        isExternal: false,
        type: "BROKEN_404",
        severity: "CRITICAL",
        status: "OPEN",
        statusCode: 404,
        firstSeenAt: now,
        lastSeenAt: now,
        resolvedAt: null,
      },
    ]);
  });

  it("listRedirectIssues filters to redirect-related types only", async () => {
    getShopMock.mockResolvedValue({ id: "shop-1" });
    issueFindManyMock.mockResolvedValue([]);

    await IssueService.listRedirectIssues("shop.myshopify.com");

    expect(issueFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: { in: ["REDIRECT_PROBLEM", "REDIRECT_LOOP"] },
        }),
      }),
    );
  });
});

describe("IssueService manual actions", () => {
  beforeEach(() => {
    issueUpdateManyMock.mockReset();
  });

  it("resolveIssue marks RESOLVED with a resolvedAt, scoped to shopId", async () => {
    issueUpdateManyMock.mockResolvedValue({ count: 1 });
    const ok = await IssueService.resolveIssue("issue-1", "shop-1");
    expect(issueUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "issue-1", shopId: "shop-1" },
      data: { status: "RESOLVED", resolvedAt: expect.any(Date) },
    });
    expect(ok).toBe(true);
  });

  it("resolveIssue returns false when the issue doesn't belong to shopId", async () => {
    issueUpdateManyMock.mockResolvedValue({ count: 0 });
    const ok = await IssueService.resolveIssue("issue-1", "other-shop");
    expect(ok).toBe(false);
  });

  it("ignoreIssue marks IGNORED, scoped to shopId", async () => {
    issueUpdateManyMock.mockResolvedValue({ count: 1 });
    const ok = await IssueService.ignoreIssue("issue-1", "shop-1");
    expect(issueUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "issue-1", shopId: "shop-1" },
      data: { status: "IGNORED" },
    });
    expect(ok).toBe(true);
  });

  it("ignoreIssue returns false when the issue doesn't belong to shopId", async () => {
    issueUpdateManyMock.mockResolvedValue({ count: 0 });
    const ok = await IssueService.ignoreIssue("issue-1", "other-shop");
    expect(ok).toBe(false);
  });
});
