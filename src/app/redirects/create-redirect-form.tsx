"use client";

import { useState } from "react";
import { Banner, BlockStack, Button, Card, Modal, Text, TextField } from "@shopify/polaris";
import { authenticatedFetch } from "../_lib/authenticated-fetch";

export function CreateRedirectForm({
  initialFromUrl = "",
  issueId,
}: {
  initialFromUrl?: string;
  issueId?: string;
}) {
  const [fromUrl, setFromUrl] = useState(initialFromUrl);
  const [toUrl, setToUrl] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);

    try {
      const response = await authenticatedFetch("/api/redirects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUrl, toUrl, confirmed: true, issueId }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to create redirect");
        return;
      }

      setSuccess(`Redirect created: ${data.redirect.fromPath} → ${data.redirect.toTarget}`);
      setFromUrl("");
      setToUrl("");
    } catch {
      setError("Network error creating the redirect. Please try again.");
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Create a redirect
        </Text>
        {error ? <Banner tone="critical">{error}</Banner> : null}
        {success ? <Banner tone="success">{success}</Banner> : null}

        <TextField
          label="Old URL"
          value={fromUrl}
          onChange={setFromUrl}
          autoComplete="off"
          placeholder="/old-page"
          helpText="The broken path on your store, e.g. /old-page"
        />
        <TextField
          label="New URL"
          value={toUrl}
          onChange={setToUrl}
          autoComplete="off"
          placeholder="/new-page"
          helpText="Where it should send customers instead"
        />
        <div>
          <Button
            variant="primary"
            disabled={!fromUrl.trim() || !toUrl.trim()}
            onClick={() => setConfirmOpen(true)}
          >
            Create redirect
          </Button>
        </div>
      </BlockStack>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm redirect"
        primaryAction={{
          content: "Create redirect",
          onAction: handleConfirm,
          loading: submitting,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setConfirmOpen(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p">
              Redirect <strong>{fromUrl}</strong> to <strong>{toUrl}</strong>?
            </Text>
            <Text as="p" tone="subdued">
              This creates a real redirect on your live store immediately.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Card>
  );
}
