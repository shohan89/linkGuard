import type { Session } from "@shopify/shopify-api";
import { runAdminQuery } from "@/lib/shopify/admin.server";

export interface Product {
  id: string;
  title: string;
  handle: string;
  status: string;
  onlineStoreUrl: string | null;
  updatedAt: string;
}

export interface ProductPage {
  products: Product[];
  hasNextPage: boolean;
  endCursor: string | null;
}

const PRODUCTS_QUERY = `#graphql
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          status
          onlineStoreUrl
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

interface ProductsResponse {
  products: {
    edges: { node: Product }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export const ProductService = {
  /** One page of products, newest-API-cursor style. Defaults to 50 per page. */
  async listProducts(
    session: Session,
    options: { first?: number; after?: string } = {},
  ): Promise<ProductPage> {
    const data = await runAdminQuery<ProductsResponse>(session, PRODUCTS_QUERY, {
      first: options.first ?? 50,
      after: options.after ?? null,
    });

    return {
      products: data.products.edges.map((edge) => edge.node),
      hasNextPage: data.products.pageInfo.hasNextPage,
      endCursor: data.products.pageInfo.endCursor,
    };
  },
};
