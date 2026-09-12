import type { Session } from "@shopify/shopify-api";
import { runAdminQuery } from "@/lib/shopify/admin.server";

export interface Collection {
  id: string;
  title: string;
  // The Admin API has no onlineStoreUrl field on Collection (unlike
  // Product) — the crawler builds /collections/{handle} itself in Phase 3
  // and lets a 404 be the signal it isn't published, same as any other link.
  handle: string;
  updatedAt: string;
}

export interface CollectionPage {
  collections: Collection[];
  hasNextPage: boolean;
  endCursor: string | null;
}

const COLLECTIONS_QUERY = `#graphql
  query Collections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
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

interface CollectionsResponse {
  collections: {
    edges: { node: Collection }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export const CollectionService = {
  /** One page of collections. Defaults to 50 per page. */
  async listCollections(
    session: Session,
    options: { first?: number; after?: string } = {},
  ): Promise<CollectionPage> {
    const data = await runAdminQuery<CollectionsResponse>(
      session,
      COLLECTIONS_QUERY,
      { first: options.first ?? 50, after: options.after ?? null },
    );

    return {
      collections: data.collections.edges.map((edge) => edge.node),
      hasNextPage: data.collections.pageInfo.hasNextPage,
      endCursor: data.collections.pageInfo.endCursor,
    };
  },
};
