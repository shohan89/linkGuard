"use client";

import { Card, Page, Text } from "@shopify/polaris";

export function NotEmbeddedNotice() {
  return (
    <Page title="LinkGuard">
      <Card>
        <Text as="p">
          Open this app from your Shopify admin to continue.
        </Text>
      </Card>
    </Page>
  );
}
