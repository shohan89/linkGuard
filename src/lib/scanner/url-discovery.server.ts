import type { Session } from "@shopify/shopify-api";
import { ShopService } from "@/lib/shopify/services/shop.server";
import { ProductService } from "@/lib/shopify/services/product.server";
import { CollectionService } from "@/lib/shopify/services/collection.server";
import { PageService } from "@/lib/shopify/services/page.server";
import { BlogService } from "@/lib/shopify/services/blog.server";
import { normalizeUrl, isInternalUrl } from "@/lib/url/normalize";

export type DiscoveredUrlSource =
  | "HOMEPAGE"
  | "PRODUCT"
  | "COLLECTION"
  | "PAGE"
  | "BLOG_ARTICLE"
  | "SITEMAP";

export interface DiscoveredUrl {
  url: string;
  source: DiscoveredUrlSource;
  isExternal: boolean;
  resourceId?: string;
}

export interface DiscoveryLimits {
  /** Max items pulled from each of products/collections/pages/blogs. Default 250. */
  maxPerSource?: number;
  /** Page size per Admin API request within a source. Default 50. */
  pageSize?: number;
  /** Max sitemap *files* followed (index + sub-sitemaps combined) — the sitemap loop guard. Default 20. */
  maxSitemapFiles?: number;
  /** Max URLs collected out of the sitemap. Default 500. */
  maxSitemapUrls?: number;
}

const DEFAULT_LIMITS: Required<DiscoveryLimits> = {
  maxPerSource: 250,
  pageSize: 50,
  maxSitemapFiles: 20,
  maxSitemapUrls: 500,
};

export interface DiscoveryResult {
  shopDomain: string;
  urls: DiscoveredUrl[];
  sourceCounts: Record<DiscoveredUrlSource, number>;
}

/**
 * Repeatedly pages through a connection-shaped Admin API call until either
 * `limit` items are collected or the API says there's no more — with a
 * hard iteration cap as a second, unconditional guarantee against looping
 * forever, in case hasNextPage/endCursor ever misbehaves.
 */
async function collectUpTo<T>(
  limit: number,
  pageSize: number,
  fetchPage: (
    after: string | undefined,
  ) => Promise<{ items: T[]; hasNextPage: boolean; endCursor: string | null }>,
): Promise<T[]> {
  const results: T[] = [];
  let after: string | undefined;
  const maxIterations = Math.ceil(limit / pageSize) + 5;

  for (let i = 0; i < maxIterations && results.length < limit; i++) {
    const page = await fetchPage(after);
    results.push(...page.items);

    if (!page.hasNextPage || !page.endCursor) {
      break;
    }
    after = page.endCursor;
  }

  return results.slice(0, limit);
}

/**
 * Shopify's sitemap.xml is always an index pointing at numbered
 * sub-sitemaps (sitemap_products_1.xml, sitemap_pages_1.xml, ...). Walks
 * that index breadth-first. `visited` is the loop guard: a sub-sitemap
 * that circularly references the index (or another already-fetched file)
 * gets skipped instead of re-fetched. maxSitemapFiles bounds total fetches
 * regardless; maxSitemapUrls bounds total <loc> entries collected.
 */
async function fetchSitemapUrls(
  primaryDomainUrl: string,
  limits: { maxSitemapFiles: number; maxSitemapUrls: number },
): Promise<string[]> {
  const visited = new Set<string>();
  const queue: string[] = [`${primaryDomainUrl.replace(/\/+$/, "")}/sitemap.xml`];
  const discovered: string[] = [];

  while (
    queue.length > 0 &&
    visited.size < limits.maxSitemapFiles &&
    discovered.length < limits.maxSitemapUrls
  ) {
    const sitemapUrl = queue.shift()!;
    if (visited.has(sitemapUrl)) {
      continue;
    }
    visited.add(sitemapUrl);

    let xml: string;
    try {
      const response = await fetch(sitemapUrl, {
        headers: { Accept: "application/xml" },
      });
      if (!response.ok) {
        continue;
      }
      xml = await response.text();
    } catch {
      // One unreachable sub-sitemap shouldn't abort discovery entirely.
      continue;
    }

    const locs = Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map(
      (match) => match[1],
    );

    if (/<sitemapindex/i.test(xml)) {
      for (const loc of locs) {
        if (!visited.has(loc) && visited.size + queue.length < limits.maxSitemapFiles) {
          queue.push(loc);
        }
      }
    } else {
      for (const loc of locs) {
        discovered.push(loc);
        if (discovered.length >= limits.maxSitemapUrls) {
          break;
        }
      }
    }
  }

  return discovered;
}

function addUrl(
  seen: Map<string, DiscoveredUrl>,
  rawUrl: string | null | undefined,
  base: string,
  shopHostname: string,
  source: DiscoveredUrlSource,
  resourceId?: string,
): void {
  if (!rawUrl) {
    return;
  }
  const normalized = normalizeUrl(rawUrl, base);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.set(normalized, {
    url: normalized,
    source,
    isExternal: !isInternalUrl(normalized, shopHostname),
    resourceId,
  });
}

export const URLDiscoveryService = {
  /**
   * Builds the full set of URLs LinkGuard should monitor for a shop:
   * homepage, products, collections, pages, blog articles, and whatever
   * the sitemap adds on top. Deduped across all sources — a URL discovered
   * twice (e.g. via both the Admin API and the sitemap) keeps whichever
   * source found it first.
   */
  async discover(
    session: Session,
    limits: DiscoveryLimits = {},
  ): Promise<DiscoveryResult> {
    const { maxPerSource, pageSize, maxSitemapFiles, maxSitemapUrls } = {
      ...DEFAULT_LIMITS,
      ...limits,
    };

    const shop = await ShopService.getShopInfo(session);
    const base = shop.primaryDomainUrl;
    const shopHostname = new URL(base).hostname;

    const seen = new Map<string, DiscoveredUrl>();

    addUrl(seen, base, base, shopHostname, "HOMEPAGE");

    const products = await collectUpTo(maxPerSource, pageSize, async (after) => {
      const page = await ProductService.listProducts(session, { first: pageSize, after });
      return { items: page.products, hasNextPage: page.hasNextPage, endCursor: page.endCursor };
    });
    for (const product of products) {
      addUrl(seen, product.onlineStoreUrl, base, shopHostname, "PRODUCT", product.id);
    }

    const collections = await collectUpTo(maxPerSource, pageSize, async (after) => {
      const page = await CollectionService.listCollections(session, { first: pageSize, after });
      return { items: page.collections, hasNextPage: page.hasNextPage, endCursor: page.endCursor };
    });
    for (const collection of collections) {
      addUrl(seen, `/collections/${collection.handle}`, base, shopHostname, "COLLECTION", collection.id);
    }

    const pages = await collectUpTo(maxPerSource, pageSize, async (after) => {
      const page = await PageService.listPages(session, { first: pageSize, after });
      return { items: page.pages, hasNextPage: page.hasNextPage, endCursor: page.endCursor };
    });
    for (const page of pages) {
      addUrl(seen, `/pages/${page.handle}`, base, shopHostname, "PAGE", page.id);
    }

    const blogs = await BlogService.listBlogsWithArticles(session, {
      first: Math.min(25, maxPerSource),
      articlesFirst: pageSize,
    });
    for (const blog of blogs) {
      for (const article of blog.articles) {
        addUrl(
          seen,
          `/blogs/${blog.handle}/${article.handle}`,
          base,
          shopHostname,
          "BLOG_ARTICLE",
          article.id,
        );
      }
    }

    const sitemapUrls = await fetchSitemapUrls(base, { maxSitemapFiles, maxSitemapUrls });
    for (const url of sitemapUrls) {
      addUrl(seen, url, base, shopHostname, "SITEMAP");
    }

    const urls = Array.from(seen.values());
    const sourceCounts = urls.reduce(
      (counts, entry) => {
        counts[entry.source] += 1;
        return counts;
      },
      {
        HOMEPAGE: 0,
        PRODUCT: 0,
        COLLECTION: 0,
        PAGE: 0,
        BLOG_ARTICLE: 0,
        SITEMAP: 0,
      } as Record<DiscoveredUrlSource, number>,
    );

    return { shopDomain: shop.myshopifyDomain, urls, sourceCounts };
  },
};
