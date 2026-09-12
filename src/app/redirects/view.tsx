"use client";

import { Badge, BlockStack, Card, EmptyState, InlineStack, Page, Text } from "@shopify/polaris";
import type { IssueDTO } from "@/lib/issues/issue.server";
import type { RedirectHistoryEntry } from "@/lib/redirects";
import { CreateRedirectForm } from "./create-redirect-form";
import { AuthenticatedPage } from "../_lib/authenticated-page";

const SEVERITY_TONE = {
  CRITICAL: "critical",
  WARNING: "warning",
  INFO: "info",
} as const;

type WireIssue = Omit<IssueDTO, "firstSeenAt" | "lastSeenAt" | "resolvedAt"> & {
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
};
type WireHistoryEntry = Omit<RedirectHistoryEntry, "createdAt"> & { createdAt: string };
interface WireRedirectsData {
  issues: WireIssue[];
  history: WireHistoryEntry[];
}
interface RedirectsData {
  issues: IssueDTO[];
  history: RedirectHistoryEntry[];
}

function mapRedirectsData(raw: WireRedirectsData): RedirectsData {
  return {
    issues: raw.issues.map((issue) => ({
      ...issue,
      firstSeenAt: new Date(issue.firstSeenAt),
      lastSeenAt: new Date(issue.lastSeenAt),
      resolvedAt: issue.resolvedAt ? new Date(issue.resolvedAt) : null,
    })),
    history: raw.history.map((entry) => ({ ...entry, createdAt: new Date(entry.createdAt) })),
  };
}

export function RedirectsPageClient({
  shop,
  initialFromUrl,
  issueId,
}: {
  shop: string;
  initialFromUrl?: string;
  issueId?: string;
}) {
  return (
    <AuthenticatedPage<WireRedirectsData, RedirectsData>
      shop={shop}
      path="/api/redirects"
      title="Redirects"
      map={mapRedirectsData}
    >
      {(data) => (
        <RedirectsView
          issues={data.issues}
          history={data.history}
          initialFromUrl={initialFromUrl}
          issueId={issueId}
        />
      )}
    </AuthenticatedPage>
  );
}

export function RedirectsView({
  issues,
  history,
  initialFromUrl,
  issueId,
}: {
  issues: IssueDTO[];
  history: RedirectHistoryEntry[];
  initialFromUrl?: string;
  issueId?: string;
}) {
  return (
    <Page title="Redirects">
      <BlockStack gap="400">
        <CreateRedirectForm initialFromUrl={initialFromUrl} issueId={issueId} />

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Redirect problems
            </Text>
            {issues.length === 0 ? (
              <EmptyState
                heading="No redirect problems found"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>No redirect loops or excessive chains as of the last scan.</p>
              </EmptyState>
            ) : (
              <BlockStack gap="300">
                {issues.map((issue) => (
                  <div key={issue.id}>
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={SEVERITY_TONE[issue.severity]}>{issue.severity}</Badge>
                      <Text as="span" fontWeight="medium">
                        {issue.type === "REDIRECT_LOOP" ? "Redirect loop" : "Long redirect chain"}
                      </Text>
                    </InlineStack>
                    <Text as="p" tone="subdued">
                      {issue.url}
                    </Text>
                  </div>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Redirect history
            </Text>
            {history.length === 0 ? (
              <Text as="p" tone="subdued">
                No redirects created yet.
              </Text>
            ) : (
              <BlockStack gap="200">
                {history.map((entry) => (
                  <div key={entry.id}>
                    <Text as="p">
                      {entry.fromPath} → {entry.toTarget}
                    </Text>
                    <Text as="p" tone="subdued">
                      {entry.createdAt.toLocaleString()}
                    </Text>
                  </div>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
