import { prisma } from "@/lib/database/client.server";
import { getShop } from "@/lib/database/shops.server";
import { EmailNotConfiguredError, EmailService } from "@/lib/notifications/email.server";
import type { IssueDTO } from "@/lib/issues/issue.server";
import type { ScanSummary } from "@/lib/scanner";
import type { NotificationType, Prisma } from "@prisma/client";

export interface WeeklyReportData {
  shopDomain: string;
  periodStart: Date;
  periodEnd: Date;
  scansRun: number;
  newIssues: number;
  resolvedIssues: number;
  openIssues: number;
  healthScore: number;
}

interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function issueEmail(issue: IssueDTO): EmailContent {
  const is404 = issue.type === "BROKEN_404";
  const label = is404 ? "New 404 error" : `New ${issue.severity.toLowerCase()} issue`;
  const prefix = issue.severity === "CRITICAL" ? "🔴 Critical: " : "";
  const subject = `${prefix}${label} on your store`;
  const text =
    `LinkGuard found a new ${issue.type.replaceAll("_", " ").toLowerCase()} issue.\n\n` +
    `URL: ${issue.url}\n` +
    (issue.statusCode ? `Status code: ${issue.statusCode}\n` : "") +
    `Severity: ${issue.severity}\n` +
    `First detected: ${issue.firstSeenAt.toISOString()}\n`;
  const html =
    `<p>LinkGuard found a new <strong>${issue.type.replaceAll("_", " ").toLowerCase()}</strong> issue.</p>` +
    `<p><strong>URL:</strong> ${issue.url}<br>` +
    (issue.statusCode ? `<strong>Status code:</strong> ${issue.statusCode}<br>` : "") +
    `<strong>Severity:</strong> ${issue.severity}<br>` +
    `<strong>First detected:</strong> ${issue.firstSeenAt.toISOString()}</p>`;
  return { subject, html, text };
}

function scanCompletedEmail(summary: ScanSummary): EmailContent {
  const subject = `Scan completed — ${summary.issuesFound} issue(s) found`;
  const text =
    `Your LinkGuard scan finished.\n\n` +
    `Links checked: ${summary.linksChecked}\n` +
    `Issues found: ${summary.issuesFound}\n` +
    `Finished: ${summary.finishedAt.toISOString()}\n`;
  const html =
    `<p>Your LinkGuard scan finished.</p>` +
    `<p><strong>Links checked:</strong> ${summary.linksChecked}<br>` +
    `<strong>Issues found:</strong> ${summary.issuesFound}<br>` +
    `<strong>Finished:</strong> ${summary.finishedAt.toISOString()}</p>`;
  return { subject, html, text };
}

function weeklyReportEmail(report: WeeklyReportData): EmailContent {
  const subject = `Your weekly LinkGuard report — health score ${report.healthScore}%`;
  const text =
    `Weekly summary for ${report.periodStart.toDateString()} – ${report.periodEnd.toDateString()}\n\n` +
    `Health score: ${report.healthScore}%\n` +
    `Scans run: ${report.scansRun}\n` +
    `New issues: ${report.newIssues}\n` +
    `Resolved issues: ${report.resolvedIssues}\n` +
    `Currently open: ${report.openIssues}\n`;
  const html =
    `<p>Weekly summary for ${report.periodStart.toDateString()} – ${report.periodEnd.toDateString()}</p>` +
    `<p><strong>Health score:</strong> ${report.healthScore}%<br>` +
    `<strong>Scans run:</strong> ${report.scansRun}<br>` +
    `<strong>New issues:</strong> ${report.newIssues}<br>` +
    `<strong>Resolved issues:</strong> ${report.resolvedIssues}<br>` +
    `<strong>Currently open:</strong> ${report.openIssues}</p>`;
  return { subject, html, text };
}

/** New issues only warrant an immediate email for these — everything else
 * shows up in the dashboard and the scan-completed / weekly summaries
 * instead of paging the merchant for every single warning. */
function isAlertWorthy(issue: IssueDTO): boolean {
  return issue.type === "BROKEN_404" || issue.severity === "CRITICAL";
}

async function sendAndRecord(
  shopDomain: string,
  type: NotificationType,
  content: EmailContent,
): Promise<void> {
  const shop = await getShop(shopDomain);
  if (!shop) {
    return;
  }

  if (!shop.contactEmail) {
    await prisma.notification.create({
      data: {
        shopId: shop.id,
        type,
        channel: "EMAIL",
        status: "FAILED",
        payload: content as unknown as Prisma.InputJsonValue,
        error: "No contact email on file for this shop",
      },
    });
    return;
  }

  try {
    await EmailService.send({ to: shop.contactEmail, ...content });
    await prisma.notification.create({
      data: {
        shopId: shop.id,
        type,
        channel: "EMAIL",
        status: "SENT",
        payload: content as unknown as Prisma.InputJsonValue,
        sentAt: new Date(),
      },
    });
  } catch (error) {
    const message =
      error instanceof EmailNotConfiguredError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown email error";

    await prisma.notification.create({
      data: {
        shopId: shop.id,
        type,
        channel: "EMAIL",
        status: "FAILED",
        payload: content as unknown as Prisma.InputJsonValue,
        error: message,
      },
    });
  }
}

export const NotificationService = {
  /** Called when IssueService creates a brand-new issue. Only 404s and
   * CRITICAL-severity issues actually trigger an email. */
  async notifyIssueDetected(shopDomain: string, issue: IssueDTO): Promise<void> {
    if (!isAlertWorthy(issue)) {
      return;
    }
    await sendAndRecord(shopDomain, "NEW_ISSUES", issueEmail(issue));
  },

  async notifyScanCompleted(shopDomain: string, summary: ScanSummary): Promise<void> {
    await sendAndRecord(shopDomain, "SCAN_COMPLETE", scanCompletedEmail(summary));
  },

  async notifyScanFailed(shopDomain: string, errorMessage: string): Promise<void> {
    await sendAndRecord(shopDomain, "SCAN_FAILED", {
      subject: "LinkGuard scan failed",
      text: `Your scheduled scan failed: ${errorMessage}`,
      html: `<p>Your scheduled scan failed:</p><p>${errorMessage}</p>`,
    });
  },

  async notifyWeeklyReport(report: WeeklyReportData): Promise<void> {
    await sendAndRecord(report.shopDomain, "WEEKLY_REPORT", weeklyReportEmail(report));
  },
};
