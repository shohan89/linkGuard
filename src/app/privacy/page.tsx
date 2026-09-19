import type { Metadata } from "next";
import { LegalPage } from "../_lib/legal-page";

export const metadata: Metadata = { title: "Privacy Policy — LinkGuard" };

const LAST_UPDATED = "September 13, 2026";
const CONTACT_EMAIL = "clustercloudbd@gmail.com";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>Last updated: {LAST_UPDATED}</p>

      <section>
        <p>
          LinkGuard (&quot;we&quot;, &quot;us&quot;) is a Shopify app that monitors a store&apos;s
          published pages for broken links, error pages, and redirect problems. This policy
          describes what data LinkGuard collects when a merchant installs it, why, and how it can
          be removed.
        </p>
      </section>

      <section>
        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Shop information</strong>: your store&apos;s <code>.myshopify.com</code> domain,
            install/uninstall timestamps, and (if available) a contact email cached from your
            store&apos;s Shopify profile, used only to send LinkGuard&apos;s own notification emails
            (new issues, scan results, weekly summaries).
          </li>
          <li>
            <strong>Storefront content URLs</strong>: the addresses of your store&apos;s products,
            collections, pages, blog articles, and navigation links — discovered via the Shopify
            Admin API so LinkGuard knows what to check. These are public storefront addresses, not
            personal data.
          </li>
          <li>
            <strong>Link-check results</strong>: HTTP status codes, response times, and redirect
            chains for the links above, and the issues LinkGuard derives from them (broken links,
            5xx errors, redirect loops).
          </li>
          <li>
            <strong>Redirects you create through LinkGuard</strong>: recorded locally as a history,
            in addition to being created directly on your store via Shopify&apos;s URL Redirect API.
          </li>
          <li>
            <strong>Billing state</strong>: your current plan and subscription status, obtained
            from and kept in sync with Shopify&apos;s Billing API. LinkGuard never sees or stores
            payment card details — Shopify handles all payment processing.
          </li>
          <li>
            <strong>Operational logs</strong>: webhook delivery records and usage counters (e.g.
            scans run this month), kept for reliability and plan-limit enforcement.
          </li>
        </ul>
        <p>
          <strong>LinkGuard does not collect or store any of your customers&apos; personal
          information.</strong> It only ever reads storefront content (products, pages, navigation)
          and Shopify&apos;s own redirect configuration — never order, customer, or checkout data.
        </p>
      </section>

      <section>
        <h2>Why we collect it</h2>
        <p>
          Solely to provide the service: discovering your store&apos;s links, checking them,
          detecting and reporting problems, letting you fix broken links with redirects, enforcing
          the limits of your chosen plan, and billing you for paid plans through Shopify.
        </p>
      </section>

      <section>
        <h2>Third parties</h2>
        <p>LinkGuard runs on and relies on the following infrastructure providers:</p>
        <ul>
          <li>Shopify — Admin API access, billing, and app hosting platform (Vercel/Railway).</li>
          <li>A managed PostgreSQL provider (Supabase) — stores the data described above.</li>
          <li>Redis hosted on Railway — background job queue and rate limiting (holds job metadata and request counters, not store content).</li>
          <li>Resend — delivers LinkGuard&apos;s notification emails.</li>
        </ul>
        <p>
          We do not sell, rent, or share your data with any other third party, and we do not use
          it for advertising.
        </p>
      </section>

      <section>
        <h2>Data retention and deletion</h2>
        <p>
          Data is retained for as long as the app is installed. When you uninstall LinkGuard, your
          store is marked inactive immediately. Shopify sends a <code>shop/redact</code> webhook 48
          hours after uninstall, at which point LinkGuard permanently deletes every row associated
          with your shop — URLs, scan history, issues, redirect history, subscription record, and
          notification log.
        </p>
        <p>
          LinkGuard also implements Shopify&apos;s mandatory <code>customers/data_request</code> and{" "}
          <code>customers/redact</code> webhooks. Since LinkGuard never stores customer personal
          data in the first place, these are no-ops by design — there is nothing to export or
          redact on that front.
        </p>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>
          You can request a copy of, or deletion of, your shop&apos;s data at any time by
          uninstalling the app (triggers deletion automatically) or by emailing{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>

      <section>
        <h2>Changes to this policy</h2>
        <p>
          We may update this policy as the app changes. Material changes will be reflected here
          with an updated date at the top of this page.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions about this policy or your data: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
