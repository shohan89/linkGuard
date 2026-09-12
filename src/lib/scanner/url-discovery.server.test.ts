import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@shopify/shopify-api";

const getShopInfoMock = vi.fn();
const listProductsMock = vi.fn();
const listCollectionsMock = vi.fn();
const listPagesMock = vi.fn();
const listBlogsWithArticlesMock = vi.fn();

vi.mock("@/lib/shopify/services/shop.server", () => ({
  ShopService: { getShopInfo: getShopInfoMock },
}));
vi.mock("@/lib/shopify/services/product.server", () => ({
  ProductService: { listProducts: listProductsMock },
}));
vi.mock("@/lib/shopify/services/collection.server", () => ({
  CollectionService: { listCollections: listCollectionsMock },
}));
vi.mock("@/lib/shopify/services/page.server", () => ({
  PageService: { listPages: listPagesMock },
}));
vi.mock("@/lib/shopify/services/blog.server", () => ({
  BlogService: { listBlogsWithArticles: listBlogsWithArticlesMock },
}));

const { URLDiscoveryService } = await import("./url-discovery.server");

const fakeSession = { shop: "test-shop.myshopify.com" } as Session;
const shopInfo = {
  id: "gid://shopify/Shop/1",
  name: "Test Shop",
  myshopifyDomain: "test-shop.myshopify.com",
  email: "owner@test-shop.example",
  currencyCode: "USD",
  primaryDomainUrl: "https://test-shop.example",
  planDisplayName: "Basic",
};

function emptyPage() {
  return { hasNextPage: false, endCursor: null };
}

describe("URLDiscoveryService.discover", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    getShopInfoMock.mockReset().mockResolvedValue(shopInfo);
    listProductsMock.mockReset().mockResolvedValue({ products: [], ...emptyPage() });
    listCollectionsMock.mockReset().mockResolvedValue({ collections: [], ...emptyPage() });
    listPagesMock.mockReset().mockResolvedValue({ pages: [], ...emptyPage() });
    listBlogsWithArticlesMock.mockReset().mockResolvedValue([]);
    fetchMock.mockReset().mockResolvedValue(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("always includes the homepage", async () => {
    const result = await URLDiscoveryService.discover(fakeSession);

    expect(result.urls).toContainEqual({
      url: "https://test-shop.example/",
      source: "HOMEPAGE",
      isExternal: false,
      resourceId: undefined,
    });
    expect(result.shopDomain).toBe("test-shop.myshopify.com");
  });

  it("skips products with no onlineStoreUrl (not published) but keeps published ones", async () => {
    listProductsMock.mockResolvedValue({
      products: [
        { id: "gid://1", title: "A", handle: "a", status: "ACTIVE", onlineStoreUrl: null, updatedAt: "" },
        {
          id: "gid://2",
          title: "B",
          handle: "b",
          status: "ACTIVE",
          onlineStoreUrl: "https://test-shop.example/products/b",
          updatedAt: "",
        },
      ],
      ...emptyPage(),
    });

    const result = await URLDiscoveryService.discover(fakeSession);

    expect(result.sourceCounts.PRODUCT).toBe(1);
    expect(result.urls.some((u) => u.url.endsWith("/products/b"))).toBe(true);
  });

  it("builds collection and page URLs from handle", async () => {
    listCollectionsMock.mockResolvedValue({
      collections: [{ id: "gid://c1", title: "Sale", handle: "sale", updatedAt: "" }],
      ...emptyPage(),
    });
    listPagesMock.mockResolvedValue({
      pages: [{ id: "gid://p1", title: "About", handle: "about", updatedAt: "" }],
      ...emptyPage(),
    });

    const result = await URLDiscoveryService.discover(fakeSession);

    expect(result.urls.map((u) => u.url)).toEqual(
      expect.arrayContaining([
        "https://test-shop.example/collections/sale",
        "https://test-shop.example/pages/about",
      ]),
    );
  });

  it("dedupes a URL discovered by two different sources", async () => {
    listCollectionsMock.mockResolvedValue({
      collections: [{ id: "gid://c1", title: "Sale", handle: "sale", updatedAt: "" }],
      ...emptyPage(),
    });
    fetchMock.mockResolvedValue(
      new Response(
        "<urlset><url><loc>https://test-shop.example/collections/sale</loc></url></urlset>",
        { status: 200 },
      ),
    );

    const result = await URLDiscoveryService.discover(fakeSession);

    const matches = result.urls.filter(
      (u) => u.url === "https://test-shop.example/collections/sale",
    );
    expect(matches).toHaveLength(1);
    // First source to claim a URL wins — collection, not sitemap.
    expect(matches[0].source).toBe("COLLECTION");
  });

  it("classifies an external URL found via the sitemap", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        "<urlset><url><loc>https://cdn.other-host.example/asset</loc></url></urlset>",
        { status: 200 },
      ),
    );

    const result = await URLDiscoveryService.discover(fakeSession);

    const external = result.urls.find((u) => u.source === "SITEMAP");
    expect(external?.isExternal).toBe(true);
  });

  it("handles a 404 sitemap gracefully instead of throwing", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));

    await expect(URLDiscoveryService.discover(fakeSession)).resolves.toBeDefined();
  });

  it("handles a network error on the sitemap gracefully", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const result = await URLDiscoveryService.discover(fakeSession);
    expect(result.sourceCounts.SITEMAP).toBe(0);
  });

  it("does not loop forever on a sitemap index that references itself", async () => {
    const indexUrl = "https://test-shop.example/sitemap.xml";
    fetchMock.mockImplementation(async (url: string) => {
      if (url === indexUrl) {
        return new Response(
          `<sitemapindex><sitemap><loc>${indexUrl}</loc></sitemap></sitemapindex>`,
          { status: 200 },
        );
      }
      return new Response("", { status: 404 });
    });

    await expect(URLDiscoveryService.discover(fakeSession)).resolves.toBeDefined();
    // The self-referencing index should only ever be fetched once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("respects maxPerSource and terminates pagination deterministically", async () => {
    // hasNextPage always true, cursor always advancing — collectUpTo must
    // still stop once maxPerSource items are collected, not loop forever.
    let call = 0;
    listProductsMock.mockImplementation(async () => {
      call += 1;
      return {
        products: [
          {
            id: `gid://${call}`,
            title: `P${call}`,
            handle: `p${call}`,
            status: "ACTIVE",
            onlineStoreUrl: `https://test-shop.example/products/p${call}`,
            updatedAt: "",
          },
        ],
        hasNextPage: true,
        endCursor: `cursor-${call}`,
      };
    });

    const result = await URLDiscoveryService.discover(fakeSession, {
      maxPerSource: 3,
      pageSize: 1,
    });

    expect(result.sourceCounts.PRODUCT).toBe(3);
    expect(call).toBe(3);
  });
});
