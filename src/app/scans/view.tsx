"use client";

import { useEffect, useState } from "react";
import {
  Banner,
  BlockStack,
  Card,
  EmptyState,
  InlineStack,
  Page,
  Spinner,
  Text,
} from "@shopify/polaris";
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

type ScanJobStatusLike = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

interface ActiveJob {
  id: string;
  status: ScanJobStatusLike;
  urlsQueued: number;
  urlsChecked: number;
}

const IN_PROGRESS_STATUSES: ScanJobStatusLike[] = ["PENDING", "RUNNING"];
const POLL_INTERVAL_MS = 2000;

export function ScansView({ scans: initialScans }: { scans: ScanSummary[] }) {
  const [scans, setScans] = useState(initialScans);
  const [busy, setBusy] = useState(false);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "critical" | "warning"; text: string } | null>(
    null,
  );

  // Polls the just-triggered scan job until it leaves PENDING/RUNNING, then
  // refreshes the history list — this is what drives the "scanning..."
  // animation below rather than a one-shot "scan started" message.
  useEffect(() => {
    if (!activeJob || !IN_PROGRESS_STATUSES.includes(activeJob.status)) {
      return;
    }
    const jobId = activeJob.id;

    const interval = setInterval(async () => {
      let response: Response;
      try {
        response = await authenticatedFetch(`/api/scans/${jobId}`);
      } catch {
        clearInterval(interval);
        setActiveJob(null);
        setMessage({ tone: "critical", text: "Lost connection while checking scan progress." });
        return;
      }

      if (!response.ok) {
        clearInterval(interval);
        setActiveJob(null);
        return;
      }

      const data = await response.json();
      setActiveJob({
        id: jobId,
        status: data.status,
        urlsQueued: data.urlsQueued,
        urlsChecked: data.urlsChecked,
      });

      if (!IN_PROGRESS_STATUSES.includes(data.status)) {
        clearInterval(interval);
        setMessage(
          data.status === "COMPLETED"
            ? {
                tone: "success",
                text: `Scan complete — ${data.urlsChecked} link(s) checked, ${data.issuesFound} issue(s) found.`,
              }
            : { tone: "critical", text: "The scan failed. Please try again." },
        );

        const listResponse = await authenticatedFetch("/api/scans");
        if (listResponse.ok) {
          setScans(mapScans(await listResponse.json()));
        }
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
    // Deliberately narrow: re-run only when the job id changes or its
    // status transitions (e.g. RUNNING -> COMPLETED stops the interval).
    // Depending on the whole activeJob object would restart the interval
    // on every poll tick, since urlsChecked changes each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.id, activeJob?.status]);

  async function handleRunScan() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/scans", { method: "POST" });
      const data = await response.json().catch(() => ({}));

      if (response.status === 202) {
        setActiveJob({ id: data.scanJobId, status: "PENDING", urlsQueued: 0, urlsChecked: 0 });
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

  const scanInProgress = activeJob !== null && IN_PROGRESS_STATUSES.includes(activeJob.status);

  return (
    <Page
      title="Scans"
      primaryAction={{
        content: "Run scan",
        onAction: handleRunScan,
        loading: busy || scanInProgress,
        disabled: scanInProgress,
      }}
    >
      <BlockStack gap="400">
        {scanInProgress ? (
          <Banner tone="info">
            <InlineStack gap="200" blockAlign="center">
              <Spinner size="small" accessibilityLabel="Scan in progress" />
              <Text as="span">
                {activeJob!.status === "PENDING"
                  ? "Scan queued…"
                  : activeJob!.urlsQueued > 0
                    ? `Scanning your store… ${activeJob!.urlsChecked}/${activeJob!.urlsQueued} links checked`
                    : "Scanning your store…"}
              </Text>
            </InlineStack>
          </Banner>
        ) : message ? (
          <Banner tone={message.tone}>{message.text}</Banner>
        ) : null}

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
