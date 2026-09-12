"use client";

import type { ReactNode } from "react";
import { Card, Page, SkeletonBodyText, SkeletonPage, Text } from "@shopify/polaris";
import { useAuthenticatedData } from "./use-authenticated-data";
import { ExitIframe } from "../exit-iframe";

/**
 * Wraps a page's client view with the loading/auth/error states that come
 * from fetching its data over an authenticated API call instead of trusting
 * the page's own (unverified) shop query param. `map` converts the raw JSON
 * — Dates arrive as ISO strings over the wire — into the shape the existing
 * view component expects.
 */
export function AuthenticatedPage<Raw, Data>({
  shop,
  path,
  title,
  map,
  children,
}: {
  shop: string;
  path: string;
  title: string;
  map: (raw: Raw) => Data;
  children: (data: Data) => ReactNode;
}) {
  const state = useAuthenticatedData<Raw>(path);

  switch (state.status) {
    case "loading":
      return (
        <SkeletonPage title={title}>
          <Card>
            <SkeletonBodyText />
          </Card>
        </SkeletonPage>
      );
    case "unauthenticated":
      return <ExitIframe authUrl={`/api/auth?shop=${encodeURIComponent(shop)}`} />;
    case "error":
      return (
        <Page title={title}>
          <Card>
            <Text as="p" tone="critical">
              {state.message}
            </Text>
          </Card>
        </Page>
      );
    case "ok":
      return <>{children(map(state.data))}</>;
  }
}
