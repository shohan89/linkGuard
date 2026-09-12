"use client";

import { Card, EmptyState, Page } from "@shopify/polaris";
import type { ScanSummary } from "@/lib/scanner";
import { AuthenticatedPage } from "../_lib/authenticated-page";

type WireScan = Omit<ScanSummary, "startedAt" | "finishedAt"> & {
  startedAt: string;
  finishedAt: string;
};

function mapScans(raw: WireScan[]): ScanSummary[] {
  return raw.map((scan) => ({
    ...scan,
    startedAt: new Date(scan.startedAt),
    finishedAt: new Date(scan.finishedAt),
  }));
}

export function ScansPageClient({ shop }: { shop: string }) {
  return (
    <AuthenticatedPage<WireScan[], ScanSummary[]>
      shop={shop}
      path="/api/scans"
      title="Scans"
      map={mapScans}
    >
      {(scans) => <ScansView scans={scans} />}
    </AuthenticatedPage>
  );
}

export function ScansView({ scans }: { scans: ScanSummary[] }) {
  return (
    <Page title="Scans">
      <Card>
        {scans.length === 0 ? (
          <EmptyState
            heading="No scans yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Scanning isn&apos;t built yet — this is coming in Phase 3.</p>
          </EmptyState>
        ) : (
          <ul>
            {scans.map((scan) => (
              <li key={scan.startedAt.toISOString()}>
                {scan.startedAt.toISOString()}: {scan.issuesFound} issue(s)
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}
