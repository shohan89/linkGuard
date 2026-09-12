import { prisma } from "@/lib/database/client.server";
import { getShop } from "@/lib/database/shops.server";
import { NotificationService } from "@/lib/notifications";
import type { IssueSeverity, IssueStatus, IssueType, ScanResultType } from "@prisma/client";

export interface IssueDTO {
  id: string;
  url: string;
  isExternal: boolean;
  type: IssueType;
  severity: IssueSeverity;
  status: IssueStatus;
  statusCode: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
}

export interface ProcessScanResultInput {
  shopId: string;
  shopDomain: string;
  urlLinkId: string;
  /** The link's target URL — threaded through by the caller (already has
   * it in hand) so this doesn't need its own DB round-trip just to build
   * a notification email. */
  url: string;
  isExternal: boolean;
  scanResultId: string;
  statusCode: number | null;
  resultType: ScanResultType;
  redirectChainLength: number;
}

/** Chains of more hops than this are flagged as a REDIRECT_PROBLEM even
 * though they do eventually resolve — slow and worth cleaning up, but not
 * broken the way a loop is. */
const REDIRECT_CHAIN_WARNING_THRESHOLD = 2;

function determineIssueType(
  resultType: ScanResultType,
  redirectChainLength: number,
): IssueType | null {
  switch (resultType) {
    case "OK":
      return redirectChainLength > REDIRECT_CHAIN_WARNING_THRESHOLD
        ? "REDIRECT_PROBLEM"
        : null;
    case "REDIRECT":
      // Our crawler only ever produces this resultType by exhausting
      // maxRedirects without reaching a terminal response — that's
      // indistinguishable from a genuine loop from the outside, and
      // functionally just as broken either way.
      return "REDIRECT_LOOP";
    case "NOT_FOUND":
    case "GONE":
      return "BROKEN_404";
    case "SERVER_ERROR":
      return "SERVER_ERROR_5XX";
    case "TIMEOUT":
      return "TIMEOUT";
    case "DNS_ERROR":
    case "OTHER_ERROR":
      return "OTHER";
  }
}

/**
 * A broken link on the merchant's own store is their problem to fix and
 * urgent; the same failure on a link pointing off-site is someone else's
 * page breaking, worth knowing about but not urgent. Loops are always
 * critical — they never resolve regardless of whose domain they're on.
 */
function classifySeverity(type: IssueType, isExternal: boolean): IssueSeverity {
  if (type === "REDIRECT_LOOP") return "CRITICAL";
  if (type === "REDIRECT_PROBLEM" || type === "TIMEOUT" || type === "OTHER") {
    return "WARNING";
  }
  // BROKEN_404, SERVER_ERROR_5XX
  return isExternal ? "WARNING" : "CRITICAL";
}

export const IssueService = {
  /**
   * The detection engine's entrypoint — called once per link check, right
   * after its ScanResult is persisted (see lib/scanner/scan.server.ts).
   * Determines what issue (if any) this result warrants, resolves any
   * previously-open issue on this link that the new result no longer
   * supports (self-healing), and opens/updates/reopens the one that's
   * warranted now. IGNORED issues are left alone on purpose — a merchant
   * dismissal shouldn't get silently undone by the next scan — but still
   * get their evidence (lastSeenAt/statusCode/scanResultId) refreshed.
   */
  async processScanResult(input: ProcessScanResultInput): Promise<void> {
    const warrantedType = determineIssueType(input.resultType, input.redirectChainLength);
    const now = new Date();

    await prisma.issue.updateMany({
      where: {
        shopId: input.shopId,
        urlLinkId: input.urlLinkId,
        status: "OPEN",
        ...(warrantedType ? { type: { not: warrantedType } } : {}),
      },
      data: { status: "RESOLVED", resolvedAt: now },
    });

    if (!warrantedType) {
      return;
    }

    const severity = classifySeverity(warrantedType, input.isExternal);

    const existing = await prisma.issue.findUnique({
      where: {
        shopId_urlLinkId_type: {
          shopId: input.shopId,
          urlLinkId: input.urlLinkId,
          type: warrantedType,
        },
      },
    });

    if (!existing) {
      const created = await prisma.issue.create({
        data: {
          shopId: input.shopId,
          urlLinkId: input.urlLinkId,
          scanResultId: input.scanResultId,
          type: warrantedType,
          severity,
          status: "OPEN",
          statusCode: input.statusCode,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });

      await NotificationService.notifyIssueDetected(input.shopDomain, {
        id: created.id,
        url: input.url,
        isExternal: input.isExternal,
        type: created.type,
        severity: created.severity,
        status: created.status,
        statusCode: created.statusCode,
        firstSeenAt: created.firstSeenAt,
        lastSeenAt: created.lastSeenAt,
        resolvedAt: created.resolvedAt,
      });
      return;
    }

    if (existing.status === "IGNORED") {
      await prisma.issue.update({
        where: { id: existing.id },
        data: { lastSeenAt: now, statusCode: input.statusCode, scanResultId: input.scanResultId },
      });
      return;
    }

    // OPEN stays OPEN, RESOLVED reopens (a regression) — either way the
    // problem is present again right now.
    await prisma.issue.update({
      where: { id: existing.id },
      data: {
        status: "OPEN",
        resolvedAt: null,
        lastSeenAt: now,
        severity,
        statusCode: input.statusCode,
        scanResultId: input.scanResultId,
      },
    });
  },

  async listOpenIssues(shopDomain: string): Promise<IssueDTO[]> {
    const shop = await getShop(shopDomain);
    if (!shop) return [];

    const issues = await prisma.issue.findMany({
      where: { shopId: shop.id, status: "OPEN" },
      orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
      include: { urlLink: { select: { targetUrl: true, isExternal: true } } },
    });

    return issues.map(toDTO);
  },

  async listRedirectIssues(shopDomain: string): Promise<IssueDTO[]> {
    const shop = await getShop(shopDomain);
    if (!shop) return [];

    const issues = await prisma.issue.findMany({
      where: {
        shopId: shop.id,
        status: "OPEN",
        type: { in: ["REDIRECT_PROBLEM", "REDIRECT_LOOP"] },
      },
      orderBy: { lastSeenAt: "desc" },
      include: { urlLink: { select: { targetUrl: true, isExternal: true } } },
    });

    return issues.map(toDTO);
  },

  /**
   * Manual merchant action: mark an issue fixed. Scoped to shopId — an
   * issueId is an opaque cuid an attacker could guess or capture from
   * another tenant, so every write must also prove it owns the row.
   * updateMany (not update) is what makes multi-field where clauses
   * possible here; its count tells the caller whether anything happened
   * without revealing *why* (wrong shop vs. nonexistent id look identical).
   */
  async resolveIssue(issueId: string, shopId: string): Promise<boolean> {
    const { count } = await prisma.issue.updateMany({
      where: { id: issueId, shopId },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    return count > 0;
  },

  /** Manual merchant action: dismiss without marking it fixed. Shop-scoped, see resolveIssue. */
  async ignoreIssue(issueId: string, shopId: string): Promise<boolean> {
    const { count } = await prisma.issue.updateMany({
      where: { id: issueId, shopId },
      data: { status: "IGNORED" },
    });
    return count > 0;
  },
};

function toDTO(issue: {
  id: string;
  type: IssueType;
  severity: IssueSeverity;
  status: IssueStatus;
  statusCode: number | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  urlLink: { targetUrl: string; isExternal: boolean };
}): IssueDTO {
  return {
    id: issue.id,
    url: issue.urlLink.targetUrl,
    isExternal: issue.urlLink.isExternal,
    type: issue.type,
    severity: issue.severity,
    status: issue.status,
    statusCode: issue.statusCode,
    firstSeenAt: issue.firstSeenAt,
    lastSeenAt: issue.lastSeenAt,
    resolvedAt: issue.resolvedAt,
  };
}
