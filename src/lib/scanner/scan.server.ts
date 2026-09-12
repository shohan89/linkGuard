import { checkLink } from "@/lib/crawler";
import type { CheckLinkOptions, LinkCheckResult } from "@/lib/crawler";
import { prisma } from "@/lib/database/client.server";
import { IssueService } from "@/lib/issues/issue.server";
import type { Prisma } from "@prisma/client";

export interface UrlLinkToScan {
  id: string;
  targetUrl: string;
  isExternal: boolean;
}

export interface ScanUrlsParams extends CheckLinkOptions {
  shopId: string;
  shopDomain: string;
  scanJobId: string;
  urlLinks: UrlLinkToScan[];
  /** Simultaneous in-flight checks. Default 5 — keeps us from opening
   * hundreds of sockets against one merchant's store at once. */
  concurrency?: number;
}

export const ScanService = {
  /** Ad-hoc single-URL check — no persistence, just the raw result. */
  async checkUrl(url: string, options?: CheckLinkOptions): Promise<LinkCheckResult> {
    return checkLink(url, options);
  },

  /**
   * Checks a batch of url_links belonging to one scan job: runs
   * lib/crawler.checkLink over each (bounded concurrency), persists one
   * ScanResult row per link, updates that link's lastCheckedAt, and bumps
   * the job's urlsChecked counter as it goes. checkLink itself never
   * throws (every failure mode becomes a result), so a per-link try/catch
   * here only guards the database writes — one write failure logs and
   * moves on rather than aborting the rest of the batch.
   */
  async scanUrls(params: ScanUrlsParams): Promise<LinkCheckResult[]> {
    const concurrency = Math.max(1, Math.min(params.concurrency ?? 5, params.urlLinks.length || 1));
    const results: LinkCheckResult[] = new Array(params.urlLinks.length);

    let nextIndex = 0;

    async function worker() {
      for (;;) {
        const index = nextIndex++;
        if (index >= params.urlLinks.length) {
          return;
        }

        const link = params.urlLinks[index];
        const result = await checkLink(link.targetUrl, {
          timeoutMs: params.timeoutMs,
          maxRedirects: params.maxRedirects,
        });
        results[index] = result;

        try {
          const scanResult = await prisma.scanResult.create({
            data: {
              shopId: params.shopId,
              scanJobId: params.scanJobId,
              urlLinkId: link.id,
              statusCode: result.statusCode,
              responseTimeMs: result.responseTimeMs,
              finalUrl: result.finalUrl,
              redirectChain: result.redirectChain as unknown as Prisma.InputJsonValue,
              resultType: result.resultType,
              errorMessage: result.errorMessage,
              checkedAt: result.checkedAt,
            },
          });

          await prisma.urlLink.update({
            where: { id: link.id },
            data: { lastCheckedAt: result.checkedAt },
          });

          await prisma.scanJob.update({
            where: { id: params.scanJobId },
            data: { urlsChecked: { increment: 1 } },
          });

          await IssueService.processScanResult({
            shopId: params.shopId,
            shopDomain: params.shopDomain,
            urlLinkId: link.id,
            url: link.targetUrl,
            isExternal: link.isExternal,
            scanResultId: scanResult.id,
            statusCode: result.statusCode,
            resultType: result.resultType,
            redirectChainLength: result.redirectChain.length,
          });
        } catch (error) {
          console.error(
            `Failed to persist scan result for urlLink ${link.id}:`,
            error,
          );
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    return results;
  },
};
