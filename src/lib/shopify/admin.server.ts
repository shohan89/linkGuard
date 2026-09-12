import type { Session } from "@shopify/shopify-api";
import {
  GraphqlQueryError,
  HttpResponseError,
  HttpThrottlingError,
  ShopifyError,
} from "@shopify/shopify-api";
import { shopify } from "@/lib/shopify/client.server";

export type ShopifyApiErrorKind =
  | "rate_limited"
  | "graphql_error"
  | "http_error"
  | "unknown";

/**
 * Every service (ProductService, CollectionService, ShopService, ...) sees
 * this one error type instead of the four different classes the underlying
 * client can throw (GraphqlQueryError, HttpThrottlingError,
 * HttpResponseError, or a bare network failure). `kind` is what callers
 * should actually branch on — e.g. retry on "rate_limited", surface
 * "graphql_error" to the merchant, log-and-skip an "http_error".
 */
export class ShopifyApiError extends Error {
  readonly kind: ShopifyApiErrorKind;
  readonly statusCode?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    options: {
      kind: ShopifyApiErrorKind;
      statusCode?: number;
      retryAfterSeconds?: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "ShopifyApiError";
    this.kind = options.kind;
    this.statusCode = options.statusCode;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/** GraphQL Admin API client bound to a shop's offline session. */
export function getAdminGraphqlClient(session: Session) {
  return new shopify.clients.Graphql({ session });
}

/**
 * Runs one Admin API GraphQL request through the shared client. This is
 * the only place in the codebase that should call `client.request`
 * directly — every service goes through here so error handling and
 * client construction stay in one place.
 */
export async function runAdminQuery<
  TData,
  TVariables extends Record<string, unknown> = Record<string, unknown>,
>(session: Session, query: string, variables?: TVariables): Promise<TData> {
  const client = getAdminGraphqlClient(session);

  try {
    const response = await client.request<TData>(query, { variables });

    if (!response.data) {
      throw new ShopifyApiError("Admin API returned no data", {
        kind: "graphql_error",
      });
    }

    return response.data;
  } catch (error) {
    throw toShopifyApiError(error);
  }
}

function toShopifyApiError(error: unknown): ShopifyApiError {
  if (error instanceof ShopifyApiError) {
    return error;
  }

  if (error instanceof HttpThrottlingError) {
    return new ShopifyApiError("Shopify Admin API rate limit exceeded", {
      kind: "rate_limited",
      statusCode: error.response.code,
      retryAfterSeconds: error.response.retryAfter,
      cause: error,
    });
  }

  if (error instanceof GraphqlQueryError) {
    return new ShopifyApiError(error.message, {
      kind: "graphql_error",
      cause: error,
    });
  }

  if (error instanceof HttpResponseError) {
    return new ShopifyApiError(error.message, {
      kind: "http_error",
      statusCode: error.response.code,
      cause: error,
    });
  }

  if (error instanceof ShopifyError) {
    return new ShopifyApiError(error.message, { kind: "unknown", cause: error });
  }

  return new ShopifyApiError("Unexpected error calling Shopify Admin API", {
    kind: "unknown",
    cause: error,
  });
}
