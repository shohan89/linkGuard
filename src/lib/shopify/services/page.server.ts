import type { Session } from "@shopify/shopify-api";
import { runAdminQuery } from "@/lib/shopify/admin.server";

export interface Page {
  id: string;
  title: string;
  // No onlineStoreUrl field on Page in the Admin API (verified live,
  // same as Collection) — callers build /pages/{handle} themselves.
  handle: string;
  updatedAt: string;
}

export interface PagePage {
  pages: Page[];
  hasNextPage: boolean;
  endCursor: string | null;
}

const PAGES_QUERY = `#graphql
  query Pages($first: Int!, $after: String) {
    pages(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          updatedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

interface PagesResponse {
  pages: {
    edges: { node: Page }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export const PageService = {
  /** One page of storefront Pages (About Us, FAQ, etc). Defaults to 50 per page. */
  async listPages(
    session: Session,
    options: { first?: number; after?: string } = {},
  ): Promise<PagePage> {
    const data = await runAdminQuery<PagesResponse>(session, PAGES_QUERY, {
      first: options.first ?? 50,
      after: options.after ?? null,
    });

    return {
      pages: data.pages.edges.map((edge) => edge.node),
      hasNextPage: data.pages.pageInfo.hasNextPage,
      endCursor: data.pages.pageInfo.endCursor,
    };
  },
};
