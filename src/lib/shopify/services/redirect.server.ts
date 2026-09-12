import type { Session } from "@shopify/shopify-api";
import { runAdminQuery } from "@/lib/shopify/admin.server";

export interface ShopifyRedirect {
  id: string;
  path: string;
  target: string;
}

const FIND_BY_PATH_QUERY = `#graphql
  query FindRedirectByPath($query: String) {
    urlRedirects(first: 1, query: $query) {
      edges {
        node {
          id
          path
          target
        }
      }
    }
  }
`;

interface FindByPathResponse {
  urlRedirects: { edges: { node: ShopifyRedirect }[] };
}

const CREATE_REDIRECT_MUTATION = `#graphql
  mutation CreateRedirect($input: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $input) {
      urlRedirect {
        id
        path
        target
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface CreateRedirectResponse {
  urlRedirectCreate: {
    urlRedirect: ShopifyRedirect | null;
    userErrors: { field: string[] | null; message: string }[];
  };
}

export class ShopifyRedirectUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyRedirectUserError";
  }
}

export const RedirectService = {
  /**
   * Exact-match lookup for an existing redirect FROM this path. Used both
   * to give a friendly "that path already redirects somewhere" error
   * before hitting the mutation, and to walk the redirect graph when
   * checking for loops.
   */
  async findRedirectByPath(session: Session, path: string): Promise<ShopifyRedirect | null> {
    const data = await runAdminQuery<FindByPathResponse>(session, FIND_BY_PATH_QUERY, {
      query: `path:${path}`,
    });
    return data.urlRedirects.edges[0]?.node ?? null;
  },

  /**
   * Creates the redirect on Shopify. Throws ShopifyRedirectUserError for
   * userErrors (e.g. "path has already been taken") so callers can
   * distinguish a validation problem from a genuine API/network failure —
   * both surface as thrown errors, but only one is the merchant's fault.
   */
  async createRedirect(
    session: Session,
    input: { path: string; target: string },
  ): Promise<ShopifyRedirect> {
    const data = await runAdminQuery<CreateRedirectResponse>(
      session,
      CREATE_REDIRECT_MUTATION,
      { input },
    );

    const { urlRedirect, userErrors } = data.urlRedirectCreate;

    if (userErrors.length > 0) {
      throw new ShopifyRedirectUserError(userErrors.map((e) => e.message).join("; "));
    }
    if (!urlRedirect) {
      throw new ShopifyRedirectUserError("Shopify did not return the created redirect");
    }

    return urlRedirect;
  },
};
