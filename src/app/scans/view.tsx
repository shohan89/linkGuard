"use client";

import { useState } from "react";
import { Banner, BlockStack, Card, EmptyState, Page, Text } from "@shopify/polaris";
import type { ScanSummary } from "@/lib/scanner";
import { AuthenticatedPage } from "../_lib/authenticated-page";
import { authenticatedFetch } from "../_lib/authenticated-fetch";

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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "critical" | "warning"; text: string } | null>(
    null,
  );

  async function handleRunScan() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/scans", { method: "POST" });
      const data = await response.json().catch(() => ({}));

      if (response.status === 202) {
        setMessage({
          tone: "success",
          text: "Scan started. Refresh this page in a minute or two to see the results.",
        });
        return;
      }
      if (response.status === 409) {
        setMessage({ tone: "warning", text: "A scan is already queued or running for this store." });
        return;
      }
      if (response.status === 402) {
        setMessage({
          tone: "warning",
          text: typeof data.error === "string" ? data.error : "Monthly scan limit reached for your plan.",
        });
        return;
      }
      setMessage({
        tone: "critical",
        text: typeof data.error === "string" ? data.error : "Failed to start the scan.",
      });
    } catch {
      setMessage({ tone: "critical", text: "Network error starting the scan. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Scans"
      primaryAction={{ content: "Run scan", onAction: handleRunScan, loading: busy }}
    >
      <BlockStack gap="400">
        {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}

        <Card>
          {scans.length === 0 ? (
            <EmptyState
              heading="No scans yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Run a scan to check your store&apos;s links for the first time.</p>
            </EmptyState>
          ) : (
            <BlockStack gap="200">
              {scans.map((scan) => (
                <BlockStack gap="050" key={scan.startedAt.toISOString()}>
                  <Text as="p" fontWeight="medium">
                    {scan.startedAt.toLocaleString()}
                  </Text>
                  <Text as="p" tone="subdued">
                    {scan.linksChecked} link(s) checked · {scan.issuesFound} issue(s) found
                  </Text>
                </BlockStack>
              ))}
            </BlockStack>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
