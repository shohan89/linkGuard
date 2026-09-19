/**
 * Inserts realistic scan/issue/redirect data for ONE shop so App Store
 * screenshots don't show an empty dashboard. Writes straight to the
 * database configured in .env — point it only at a development store.
 *
 *   npx tsx scripts/seed-demo-data.ts --shop <domain>            # add demo data
 *   npx tsx scripts/seed-demo-data.ts --shop <domain> --remove   # delete exactly what it added
 *
 * Everything it creates is tagged (Url.resourceId, ScanJob.error,
 * UrlRedirect.shopifyRedirectId prefix, UsageEvent.metadata) so --remove
 * never touches real scan data.
 */
import "dotenv/config";
import { prisma } from "@/lib/database/client.server";

const TAG = "demo-seed";
const REDIRECT_PREFIX = "gid://shopify/UrlRedirect/demo-";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1] ?? "");
};

const daysAgo = (d: number, hour = 3) => {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() - d);
  t.setUTCHours(hour, 0, 0, 0);
  return t;
};

async function remove(shopId: string) {
  await prisma.urlRedirect.deleteMany({
    where: { shopId, shopifyRedirectId: { startsWith: REDIRECT_PREFIX } },
  });
  await prisma.usageEvent.deleteMany({ where: { shopId, metadata: { path: ["seed"], equals: TAG } } });
  await prisma.scanJob.deleteMany({ where: { shopId, error: TAG } }); // cascades ScanResult
  await prisma.url.deleteMany({ where: { shopId, resourceId: TAG } }); // cascades UrlLink, Issue
}

async function main() {
  const shopDomain = arg("shop");
  if (!shopDomain?.endsWith(".myshopify.com")) {
    throw new Error("Usage: --shop <name>.myshopify.com [--remove]");
  }
  const shop = await prisma.shop.findUnique({ where: { shopDomain } });
  if (!shop) throw new Error(`No Shop row for ${shopDomain} — install the app on it first`);

  await remove(shop.id);
  if (process.argv.includes("--remove")) {
    console.log(`Removed demo data for ${shopDomain}`);
    return;
  }

  const base = `https://${shopDomain}`;
  const pages: { path: string; source: "HOMEPAGE" | "PRODUCT" | "COLLECTION" | "PAGE" | "BLOG_ARTICLE" }[] = [
    { path: "/", source: "HOMEPAGE" },
    ...["classic-tee", "denim-jacket", "canvas-tote", "leather-belt", "wool-beanie", "running-shoes", "linen-shirt", "summer-dress"].map(
      (h) => ({ path: `/products/${h}`, source: "PRODUCT" as const }),
    ),
    ...["all", "new-arrivals", "sale", "accessories"].map((h) => ({ path: `/collections/${h}`, source: "COLLECTION" as const })),
    ...["about-us", "contact", "shipping-policy", "size-guide", "faq"].map((h) => ({ path: `/pages/${h}`, source: "PAGE" as const })),
    ...["spring-lookbook", "care-guide"].map((h) => ({ path: `/blogs/news/${h}`, source: "BLOG_ARTICLE" as const })),
  ];

  const urls: Awaited<ReturnType<typeof prisma.url.create>>[] = [];
  for (const p of pages) {
    urls.push(
      await prisma.url.create({
        data: { shopId: shop.id, url: base + p.path, source: p.source, resourceId: TAG },
      }),
    );
  }
  const homepage = urls[0];

  // Links found on the pages — mostly healthy, a handful broken.
  const linkSpecs = [
    ...urls.slice(1).map((u) => ({ target: u.url, external: false })),
    { target: `${base}/products/vintage-scarf`, external: false }, // deleted product
    { target: `${base}/pages/returns`, external: false }, // page renamed
    { target: `${base}/collections/summer-2024`, external: false }, // old collection
    { target: "https://www.fashion-weekly.example/features/denim-trends", external: true },
    { target: "https://blog.styleguide.example/how-to-care-for-linen", external: true },
    { target: "https://cdn.partner-widgets.example/size-chart", external: true },
    { target: "https://instagram.com/linkguard.demo", external: true },
  ];
  const links: Awaited<ReturnType<typeof prisma.urlLink.create>>[] = [];
  for (const spec of linkSpecs) {
    links.push(
      await prisma.urlLink.create({
        data: {
          shopId: shop.id,
          sourceUrlId: homepage.id,
          targetUrl: spec.target,
          isExternal: spec.external,
          linkText: TAG,
          lastCheckedAt: daysAgo(0),
        },
      }),
    );
  }
  const link = (needle: string) => links.find((l) => l.targetUrl.includes(needle))!;

  // Scan history: three completed runs, newest first in the UI.
  const runs = [
    { ago: 6, checked: links.length - 2, issues: 3 },
    { ago: 3, checked: links.length - 1, issues: 5 },
    { ago: 0, checked: links.length, issues: 7 },
  ];
  let latestJobId = "";
  for (const r of runs) {
    const started = daysAgo(r.ago);
    const job = await prisma.scanJob.create({
      data: {
        shopId: shop.id,
        status: "COMPLETED",
        trigger: r.ago === 0 ? "MANUAL" : "SCHEDULED",
        urlsQueued: r.checked,
        urlsChecked: r.checked,
        issuesFound: r.issues,
        startedAt: started,
        finishedAt: new Date(started.getTime() + 47_000),
        error: TAG,
      },
    });
    latestJobId = job.id;
    await prisma.usageEvent.create({
      data: { shopId: shop.id, type: "SCAN_RUN", occurredAt: started, metadata: { seed: TAG } },
    });
  }

  const result = async (needle: string, resultType: "NOT_FOUND" | "SERVER_ERROR" | "TIMEOUT" | "REDIRECT" | "OK", statusCode: number | null) =>
    prisma.scanResult.create({
      data: {
        shopId: shop.id,
        scanJobId: latestJobId,
        urlLinkId: link(needle).id,
        resultType,
        statusCode,
        responseTimeMs: resultType === "TIMEOUT" ? 10_000 : 180,
        checkedAt: daysAgo(0),
      },
    });

  const issue = async (
    needle: string,
    type: "BROKEN_404" | "SERVER_ERROR_5XX" | "REDIRECT_PROBLEM" | "TIMEOUT",
    severity: "CRITICAL" | "WARNING",
    resultType: "NOT_FOUND" | "SERVER_ERROR" | "TIMEOUT" | "REDIRECT",
    statusCode: number | null,
    firstSeenDaysAgo: number,
    extra: { status?: "OPEN" | "RESOLVED"; resolvedAt?: Date } = {},
  ) => {
    const scanResult = await result(needle, resultType, statusCode);
    return prisma.issue.create({
      data: {
        shopId: shop.id,
        urlLinkId: link(needle).id,
        scanResultId: scanResult.id,
        type,
        severity,
        status: extra.status ?? "OPEN",
        statusCode,
        firstSeenAt: daysAgo(firstSeenDaysAgo),
        lastSeenAt: daysAgo(0),
        resolvedAt: extra.resolvedAt ?? null,
      },
    });
  };

  const brokenScarf = await issue("vintage-scarf", "BROKEN_404", "CRITICAL", "NOT_FOUND", 404, 5);
  await issue("/pages/returns", "BROKEN_404", "CRITICAL", "NOT_FOUND", 404, 3);
  await issue("summer-2024", "BROKEN_404", "CRITICAL", "NOT_FOUND", 404, 3);
  await issue("fashion-weekly", "BROKEN_404", "WARNING", "NOT_FOUND", 404, 2);
  await issue("partner-widgets", "SERVER_ERROR_5XX", "WARNING", "SERVER_ERROR", 503, 1);
  await issue("styleguide.example", "TIMEOUT", "WARNING", "TIMEOUT", null, 1);
  await issue("/collections/sale", "REDIRECT_PROBLEM", "WARNING", "REDIRECT", 301, 4);

  // Redirect history: two fixes already made.
  const fixed = [
    { from: "/products/old-denim-jacket", to: "/products/denim-jacket", ago: 4 },
    { from: "/collections/winter-2023", to: "/collections/all", ago: 2 },
  ];
  for (const [i, f] of fixed.entries()) {
    await prisma.urlRedirect.create({
      data: {
        shopId: shop.id,
        fromPath: f.from,
        toTarget: f.to,
        shopifyRedirectId: `${REDIRECT_PREFIX}${i + 1}`,
        createdAt: daysAgo(f.ago, 10),
      },
    });
  }

  console.log(
    `Seeded ${urls.length} URLs, ${links.length} links, ${runs.length} scans, 7 open issues, ${fixed.length} redirects for ${shopDomain}`,
  );
  console.log(`(first issue id ${brokenScarf.id})  Undo with: npx tsx scripts/seed-demo-data.ts --shop ${shopDomain} --remove`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
