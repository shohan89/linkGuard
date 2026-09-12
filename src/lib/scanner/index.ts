import { prisma } from "@/lib/database/client.server";
import { getShop } from "@/lib/database/shops.server";
import { loadOfflineSessionForShop } from "@/lib/shopify/session.server";
import { URLDiscoveryService } from "@/lib/scanner/url-discovery.server";
import { ScanService } from "@/lib/scanner/scan.server";
import { NotificationService } from "@/lib/notifications";
import { BillingService } from "@/lib/billing";
import type { UrlSource } from "@prisma/client";

export interface ScanSummary {
  shopDomain: string;
  linksChecked: number;
  issuesFound: number;
  startedAt: Date;
  finishedAt: Date;
}

/**
 * The full pipeline for one scan job: discover the shop's URLs, persist
 * them as Url/UrlLink rows (idempotent — safe to run again on retry),
 * check every link, and finalize the ScanJob. Runs entirely inside the
 * queue worker (src/worker.ts) — never called from a web request, which
 * is what keeps a large store's scan from blocking anything.
 *
 * Throws on failure rather than swallowing it, so BullMQ's retry/backoff
 * sees the failure and can retry the whole job. The worker's 'failed'
 * event handler (not this function) is what marks the ScanJob FAILED —
 * only once retries are exhausted, not on every transient attempt.
 */
export async function runScan(
  shopDomain: string,
  scanJobId: string,
): Promise<ScanSummary> {
  const shop = await getShop(shopDomain);
  if (!shop) {
    throw new Error(`No shop record for ${shopDomain}`);
  }

  const session = await loadOfflineSessionForShop(shopDomain);
  if (!session) {
    throw new Error(`No offline session for ${shopDomain} — cannot scan`);
  }

  const startedAt = new Date();
  await prisma.scanJob.update({
    where: { id: scanJobId },
    data: { status: "RUNNING", startedAt },
  });

  const [discovery, maxUrls] = await Promise.all([
    URLDiscoveryService.discover(session),
    BillingService.getMaxUrls(shopDomain),
  ]);
  // Discovery runs unconstrained by plan (it's cheap, read-only Admin API
  // calls); the plan's URL cap is applied here, to what actually gets
  // persisted and checked.
  const discoveredUrls = discovery.urls.slice(0, maxUrls);

  const urlLinks = await Promise.all(
    discoveredUrls.map(async (discovered) => {
      const url = await prisma.url.upsert({
        where: { shopId_url: { shopId: shop.id, url: discovered.url } },
        create: {
          shopId: shop.id,
          url: discovered.url,
          source: discovered.source as UrlSource,
        },
        update: { isActive: true, lastSeenAt: new Date() },
      });

      const urlLink = await prisma.urlLink.upsert({
        where: {
          sourceUrlId_targetUrl: { sourceUrlId: url.id, targetUrl: discovered.url },
        },
        create: {
          shopId: shop.id,
          sourceUrlId: url.id,
          targetUrl: discovered.url,
          isExternal: discovered.isExternal,
        },
        update: {},
      });

      return {
        id: urlLink.id,
        targetUrl: urlLink.targetUrl,
        isExternal: urlLink.isExternal,
      };
    }),
  );

  await prisma.scanJob.update({
    where: { id: scanJobId },
    data: { urlsQueued: urlLinks.length },
  });

  const results = await ScanService.scanUrls({
    shopId: shop.id,
    shopDomain,
    scanJobId,
    urlLinks,
    concurrency: 5,
  });

  const issuesFound = results.filter((result) => result.resultType !== "OK").length;
  const finishedAt = new Date();

  await prisma.scanJob.update({
    where: { id: scanJobId },
    data: { status: "COMPLETED", finishedAt, issuesFound },
  });

  // Recorded on completion, not on start — a BullMQ retry re-running this
  // same job after a transient failure shouldn't cost the merchant a
  // second scan out of their monthly quota for what they see as one scan.
  await BillingService.recordScanUsage(shop.id);

  const summary: ScanSummary = {
    shopDomain,
    linksChecked: results.length,
    issuesFound,
    startedAt,
    finishedAt,
  };

  await NotificationService.notifyScanCompleted(shopDomain, summary);

  return summary;
}

/** All URLs LinkGuard currently monitors for a shop. */
export async function listMonitoredUrls(shopDomain: string): Promise<string[]> {
  const shop = await getShop(shopDomain);
  if (!shop) return [];

  const links = await prisma.urlLink.findMany({
    where: { shopId: shop.id },
    select: { targetUrl: true },
    distinct: ["targetUrl"],
  });
  return links.map((link) => link.targetUrl);
}

/** Past scan runs for a shop's scan-history page, newest first. */
export async function listScans(shopDomain: string): Promise<ScanSummary[]> {
  const shop = await getShop(shopDomain);
  if (!shop) return [];

  const jobs = await prisma.scanJob.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return jobs
    .filter((job) => job.startedAt && job.finishedAt)
    .map((job) => ({
      shopDomain,
      linksChecked: job.urlsChecked,
      issuesFound: job.issuesFound,
      startedAt: job.startedAt as Date,
      finishedAt: job.finishedAt as Date,
    }));
}
