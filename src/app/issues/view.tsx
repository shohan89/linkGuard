"use client";

import { Badge, BlockStack, Card, EmptyState, InlineStack, Page, Text } from "@shopify/polaris";
import Link from "next/link";
import type { IssueDTO } from "@/lib/issues/issue.server";
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

function mapIssues(raw: WireIssue[]): IssueDTO[] {
  return raw.map((issue) => ({
    ...issue,
    firstSeenAt: new Date(issue.firstSeenAt),
    lastSeenAt: new Date(issue.lastSeenAt),
    resolvedAt: issue.resolvedAt ? new Date(issue.resolvedAt) : null,
  }));
}

export function IssuesPageClient({ shop }: { shop: string }) {
  return (
    <AuthenticatedPage<WireIssue[], IssueDTO[]>
      shop={shop}
      path="/api/issues"
      title="Issues"
      map={mapIssues}
    >
      {(issues) => <IssuesView issues={issues} shop={shop} />}
    </AuthenticatedPage>
  );
}

const FIXABLE_WITH_REDIRECT: IssueDTO["type"][] = ["BROKEN_404", "SERVER_ERROR_5XX"];

export function IssuesView({ issues, shop }: { issues: IssueDTO[]; shop: string }) {
  return (
    <Page title="Issues">
      <Card>
        {issues.length === 0 ? (
          <EmptyState
            heading="No open issues"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Nothing broken as of the last scan.</p>
          </EmptyState>
        ) : (
          <BlockStack gap="300">
            {issues.map((issue) => {
              const canFixWithRedirect =
                !issue.isExternal && FIXABLE_WITH_REDIRECT.includes(issue.type);

              return (
                <div key={issue.id}>
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone={SEVERITY_TONE[issue.severity]}>{issue.severity}</Badge>
                    <Text as="span" fontWeight="medium">
                      {issue.type.replaceAll("_", " ")}
                    </Text>
                    {issue.statusCode ? (
                      <Text as="span" tone="subdued">
                        ({issue.statusCode})
                      </Text>
                    ) : null}
                  </InlineStack>
                  <Text as="p" tone="subdued">
                    {issue.url}
                  </Text>
                  <Text as="p" tone="subdued">
                    First detected {issue.firstSeenAt.toLocaleString()} · Last detected{" "}
                    {issue.lastSeenAt.toLocaleString()}
                  </Text>
                  {canFixWithRedirect ? (
                    <Link
                      href={`/redirects?shop=${encodeURIComponent(shop)}&fromUrl=${encodeURIComponent(issue.url)}&issueId=${encodeURIComponent(issue.id)}`}
                    >
                      Fix with a redirect
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </BlockStack>
        )}
      </Card>
    </Page>
  );
}
