"use client";

import { Card, EmptyState, Page } from "@shopify/polaris";
import { AuthenticatedPage } from "../_lib/authenticated-page";

export function UrlsPageClient({ shop }: { shop: string }) {
  return (
    <AuthenticatedPage<string[], string[]>
      shop={shop}
      path="/api/urls"
      title="URLs"
      map={(urls) => urls}
    >
      {(urls) => <UrlsView urls={urls} />}
    </AuthenticatedPage>
  );
}

export function UrlsView({ urls }: { urls: string[] }) {
  return (
    <Page title="URLs">
      <Card>
        {urls.length === 0 ? (
          <EmptyState
            heading="No URLs monitored yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>URL discovery hasn&apos;t run yet — this is coming in Phase 3.</p>
          </EmptyState>
        ) : (
          <ul>
            {urls.map((url) => (
              <li key={url}>{url}</li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}
