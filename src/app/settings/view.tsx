"use client";

import { Badge, BlockStack, Card, InlineGrid, Page, Text } from "@shopify/polaris";
import type { ReactNode } from "react";
import type { PlanDefinition } from "@/lib/billing";
import { AuthenticatedPage } from "../_lib/authenticated-page";

export interface SettingsData {
  shopDomain: string;
  installedAt: Date;
  isActive: boolean;
  plan: PlanDefinition;
}

type WireSettingsData = Omit<SettingsData, "installedAt"> & { installedAt: string };

export function SettingsPageClient({ shop }: { shop: string }) {
  return (
    <AuthenticatedPage<WireSettingsData, SettingsData>
      shop={shop}
      path="/api/settings"
      title="Settings"
      map={(raw) => ({ ...raw, installedAt: new Date(raw.installedAt) })}
    >
      {(data) => <SettingsView data={data} />}
    </AuthenticatedPage>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <BlockStack gap="050">
      <Text as="p" tone="subdued">
        {label}
      </Text>
      <Text as="p">{children}</Text>
    </BlockStack>
  );
}

export function SettingsView({ data }: { data: SettingsData }) {
  return (
    <Page title="Settings" subtitle={data.shopDomain}>
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Store
            </Text>
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
              <Field label="Domain">{data.shopDomain}</Field>
              <Field label="Status">
                <Badge tone={data.isActive ? "success" : "critical"}>
                  {data.isActive ? "Active" : "Uninstalled"}
                </Badge>
              </Field>
              <Field label="Installed">{data.installedAt.toLocaleDateString()}</Field>
              <Field label="Plan">{data.plan.name}</Field>
            </InlineGrid>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Scan defaults
            </Text>
            <Text as="p" tone="subdued">
              Per-shop scan configuration (frequency, concurrency, timeout)
              isn&apos;t adjustable yet — every scan currently uses the same
              built-in defaults below.
            </Text>
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
              <Field label="Monitored URLs">{data.plan.maxUrls}</Field>
              <Field label="Scans per month">{data.plan.maxScansPerMonth}</Field>
              <Field label="Concurrent link checks">5</Field>
              <Field label="Request timeout">10s</Field>
            </InlineGrid>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
