"use client";

import { BlockStack, Card, Grid, Page, ProgressBar, Text } from "@shopify/polaris";
import type { DashboardOverview } from "@/lib/dashboard";
import { AuthenticatedPage } from "../_lib/authenticated-page";

type WireLastScan = Omit<NonNullable<DashboardOverview["lastScan"]>, "startedAt" | "finishedAt"> & {
  startedAt: string | null;
  finishedAt: string | null;
};
type WireOverview = Omit<DashboardOverview, "lastScan"> & { lastScan: WireLastScan | null };

function mapOverview(raw: WireOverview): DashboardOverview {
  return {
    ...raw,
    lastScan: raw.lastScan
      ? {
          ...raw.lastScan,
          startedAt: raw.lastScan.startedAt ? new Date(raw.lastScan.startedAt) : null,
          finishedAt: raw.lastScan.finishedAt ? new Date(raw.lastScan.finishedAt) : null,
        }
      : null,
  };
}

export function DashboardPageClient({ shop }: { shop: string }) {
  return (
    <AuthenticatedPage<WireOverview, DashboardOverview>
      shop={shop}
      path="/api/dashboard"
      title="Overview"
      map={mapOverview}
    >
      {(overview) => <DashboardView shop={shop} overview={overview} />}
    </AuthenticatedPage>
  );
}

function healthTone(score: number): "success" | "primary" | "critical" {
  if (score >= 80) return "success";
  if (score >= 50) return "primary";
  return "critical";
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="heading2xl">
          {value}
        </Text>
      </BlockStack>
    </Card>
  );
}

function formatLastScan(lastScan: DashboardOverview["lastScan"]): string {
  if (!lastScan) return "Never run";
  const when = lastScan.finishedAt ?? lastScan.startedAt;
  const whenLabel = when ? when.toLocaleString() : "";
  return `${lastScan.status}${whenLabel ? ` · ${whenLabel}` : ""}`;
}

export function DashboardView({
  shop,
  overview,
}: {
  shop: string;
  overview: DashboardOverview;
}) {
  return (
    <Page title="Overview" subtitle={shop}>
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Health score
            </Text>
            <ProgressBar
              progress={overview.healthScore}
              tone={healthTone(overview.healthScore)}
              size="large"
            />
            <Text as="p" variant="heading2xl">
              {overview.healthScore}%
            </Text>
          </BlockStack>
        </Card>

        <Grid columns={{ xs: 1, sm: 2, md: 4, lg: 4, xl: 4 }}>
          <Grid.Cell columnSpan={{ xs: 1, sm: 1, md: 1, lg: 1, xl: 1 }}>
            <MetricCard label="Total URLs" value={overview.totalUrls} />
          </Grid.Cell>
          <Grid.Cell columnSpan={{ xs: 1, sm: 1, md: 1, lg: 1, xl: 1 }}>
            <MetricCard label="Broken links" value={overview.brokenLinks} />
          </Grid.Cell>
          <Grid.Cell columnSpan={{ xs: 1, sm: 1, md: 1, lg: 1, xl: 1 }}>
            <MetricCard label="404 errors" value={overview.notFoundErrors} />
          </Grid.Cell>
          <Grid.Cell columnSpan={{ xs: 1, sm: 1, md: 1, lg: 1, xl: 1 }}>
            <MetricCard label="Critical issues" value={overview.criticalIssues} />
          </Grid.Cell>
        </Grid>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Last scan
            </Text>
            <Text as="p">{formatLastScan(overview.lastScan)}</Text>
            {overview.lastScan ? (
              <Text as="p" tone="subdued">
                {overview.lastScan.linksChecked} links checked ·{" "}
                {overview.lastScan.issuesFound} issue(s) found
              </Text>
            ) : null}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
