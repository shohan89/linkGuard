import type { Metadata } from "next";
import { LegalPage } from "../_lib/legal-page";

export const metadata: Metadata = { title: "Terms of Service — LinkGuard" };

const LAST_UPDATED = "September 13, 2026";
const CONTACT_EMAIL = "clustercloudbd@gmail.com";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>Last updated: {LAST_UPDATED}</p>

      <section>
        <p>
          These terms govern your use of LinkGuard, a Shopify app that monitors your store for
          broken links, error pages, and redirect problems. By installing LinkGuard, you agree to
          these terms.
        </p>
      </section>

      <section>
        <h2>The service</h2>
        <p>
          LinkGuard periodically scans your store&apos;s published content for broken links, 404s,
          server errors, and redirect problems, reports what it finds, and lets you fix broken
          links by creating redirects — created directly on your store through Shopify&apos;s own
          URL Redirect feature. Scan frequency, number of monitored URLs, and monthly scan quota
          depend on your plan (see Pricing on the app listing, or the in-app Billing page).
        </p>
      </section>

      <section>
        <h2>Subscriptions and billing</h2>
        <ul>
          <li>
            All charges are processed by Shopify through the Shopify Billing API — LinkGuard never
            collects payment details directly.
          </li>
          <li>Paid plans renew automatically every 30 days until cancelled.</li>
          <li>
            You can cancel or downgrade to the Free plan at any time from the app&apos;s Billing
            page; the change takes effect immediately, and no partial-period refund is issued for
            time already billed.
          </li>
          <li>Exceeding your plan&apos;s monthly scan or monitored-URL limit pauses further scans
            until the next billing cycle or until you upgrade.</li>
        </ul>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>
          You agree not to use LinkGuard to scan, probe, or otherwise direct traffic at domains you
          do not own or have authorization to test, and not to attempt to circumvent its plan
          limits or rate limits.
        </p>
      </section>

      <section>
        <h2>No warranty</h2>
        <p>
          LinkGuard is provided &quot;as is&quot;. Link-checking results depend on the target
          servers&apos; availability and behavior at the moment of the check and can be incomplete,
          delayed, or occasionally inaccurate (e.g. a site that blocks automated requests). We
          don&apos;t guarantee that LinkGuard will catch every broken link or that a redirect it
          creates resolves every SEO or traffic impact of a broken link.
        </p>
      </section>

      <section>
        <h2>Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, LinkGuard and its operator are not liable for
          indirect, incidental, or consequential damages arising from use of the app, including
          lost sales or search-ranking impact from undetected or incorrectly flagged link issues.
          Our total liability for any claim is limited to the amount you paid for the service in
          the 3 months preceding the claim.
        </p>
      </section>

      <section>
        <h2>Data</h2>
        <p>
          See our <a href="/privacy">Privacy Policy</a> for what data LinkGuard collects and how
          it&apos;s handled, including deletion on uninstall.
        </p>
      </section>

      <section>
        <h2>Termination</h2>
        <p>
          You may stop using LinkGuard at any time by uninstalling it from your Shopify admin. We
          may suspend or terminate access for violation of these terms or of Shopify&apos;s own
          policies.
        </p>
      </section>

      <section>
        <h2>Changes to these terms</h2>
        <p>
          We may update these terms as the app changes. Material changes will be reflected here
          with an updated date at the top of this page.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
