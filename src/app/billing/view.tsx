"use client";

import { useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Grid,
  InlineStack,
  Modal,
  Page,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import type { SubscriptionPlan } from "@prisma/client";
import type { PlanDefinition } from "@/lib/billing";
import { authenticatedFetch } from "../_lib/authenticated-fetch";
import { AuthenticatedPage } from "../_lib/authenticated-page";

export interface BillingUsage {
  scansUsed: number;
  scansLimit: number;
  urlsUsed: number;
  urlsLimit: number;
}

interface BillingData {
  plans: PlanDefinition[];
  currentTier: SubscriptionPlan;
  usage: BillingUsage;
}

export function BillingPageClient({ shop, host }: { shop: string; host: string }) {
  return (
    <AuthenticatedPage<BillingData, BillingData>
      shop={shop}
      path="/api/billing"
      title="Billing"
      map={(raw) => raw}
    >
      {(data) => (
        <BillingView
          shop={shop}
          host={host}
          plans={data.plans}
          currentTier={data.currentTier}
          usage={data.usage}
        />
      )}
    </AuthenticatedPage>
  );
}

function topLevelRedirect(url: string): void {
  if (window.top && window.top !== window.self) {
    window.top.location.href = url;
  } else {
    window.location.href = url;
  }
}

function PlanCard({
  plan,
  isCurrent,
  isDowngradeTarget,
  onUpgrade,
  onDowngrade,
  busy,
}: {
  plan: PlanDefinition;
  isCurrent: boolean;
  isDowngradeTarget: boolean;
  onUpgrade: (tier: SubscriptionPlan) => void;
  onDowngrade: () => void;
  busy: boolean;
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            {plan.name}
          </Text>
          {isCurrent ? <Badge tone="success">Current plan</Badge> : null}
        </InlineStack>
        <Text as="p" variant="heading2xl">
          {plan.priceUsd === 0 ? "Free" : `$${plan.priceUsd.toFixed(2)}`}
          {plan.priceUsd > 0 ? (
            <Text as="span" tone="subdued">
              {" "}
              /month
            </Text>
          ) : null}
        </Text>
        <Text as="p" tone="subdued">
          {plan.maxUrls} URLs monitored · {plan.maxScansPerMonth} scans/month ·{" "}
          {plan.dailyScansEnabled ? "Daily scans" : "Weekly scans"}
        </Text>
        {isCurrent ? (
          plan.tier !== "FREE" ? (
            <Button disabled={busy} onClick={onDowngrade}>
              Downgrade to Free
            </Button>
          ) : null
        ) : isDowngradeTarget ? (
          <Button disabled={busy} onClick={onDowngrade}>
            Downgrade to Free
          </Button>
        ) : (
          <Button variant="primary" disabled={busy} onClick={() => onUpgrade(plan.tier)}>
            Upgrade
          </Button>
        )}
      </BlockStack>
    </Card>
  );
}

export function BillingView({
  shop,
  host,
  plans,
  currentTier,
  usage,
}: {
  shop: string;
  host: string;
  plans: PlanDefinition[];
  currentTier: SubscriptionPlan;
  usage: BillingUsage;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDowngrade, setConfirmDowngrade] = useState(false);

  async function handleUpgrade(targetTier: SubscriptionPlan) {
    setBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTier, host }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to start upgrade");
        setBusy(false);
        return;
      }
      topLevelRedirect(data.confirmationUrl);
    } catch {
      setError("Network error starting the upgrade. Please try again.");
      setBusy(false);
    }
  }

  async function handleDowngrade() {
    setBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/billing/cancel", { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to downgrade");
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch {
      setError("Network error downgrading. Please try again.");
      setBusy(false);
    } finally {
      setConfirmDowngrade(false);
    }
  }

  return (
    <Page title="Billing">
      <BlockStack gap="400">
        {error ? <Banner tone="critical">{error}</Banner> : null}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              This month&apos;s usage — {shop}
            </Text>
            <BlockStack gap="100">
              <Text as="p">
                Scans: {usage.scansUsed} / {usage.scansLimit}
              </Text>
              <ProgressBar
                progress={Math.min(100, (usage.scansUsed / usage.scansLimit) * 100)}
                tone={usage.scansUsed >= usage.scansLimit ? "critical" : "primary"}
              />
            </BlockStack>
            <BlockStack gap="100">
              <Text as="p">
                URLs monitored: {usage.urlsUsed} / {usage.urlsLimit}
              </Text>
              <ProgressBar
                progress={Math.min(100, (usage.urlsUsed / usage.urlsLimit) * 100)}
                tone={usage.urlsUsed >= usage.urlsLimit ? "critical" : "primary"}
              />
            </BlockStack>
          </BlockStack>
        </Card>

        <Grid columns={{ xs: 1, sm: 2, md: 4, lg: 4, xl: 4 }}>
          {plans.map((plan) => (
            <Grid.Cell key={plan.tier} columnSpan={{ xs: 1, sm: 1, md: 1, lg: 1, xl: 1 }}>
              <PlanCard
                plan={plan}
                isCurrent={plan.tier === currentTier}
                isDowngradeTarget={plan.tier === "FREE" && currentTier !== "FREE"}
                onUpgrade={handleUpgrade}
                onDowngrade={() => setConfirmDowngrade(true)}
                busy={busy}
              />
            </Grid.Cell>
          ))}
        </Grid>
      </BlockStack>

      <Modal
        open={confirmDowngrade}
        onClose={() => setConfirmDowngrade(false)}
        title="Downgrade to Free?"
        primaryAction={{ content: "Downgrade", onAction: handleDowngrade, loading: busy }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirmDowngrade(false) }]}
      >
        <Modal.Section>
          <Text as="p">
            This cancels your current subscription immediately and drops your plan limits to
            Free. You can upgrade again anytime.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
