import type { Metadata } from "next";
import { LegalPage } from "../_lib/legal-page";

export const metadata: Metadata = { title: "Support — LinkGuard" };

const CONTACT_EMAIL = "clustercloudbd@gmail.com";

export default function SupportPage() {
  return (
    <LegalPage title="Support">
      <section>
        <p>
          Need help with LinkGuard? Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> — we aim to respond within 2
          business days.
        </p>
      </section>

      <section>
        <h2>Frequently asked questions</h2>

        <h3>How often does LinkGuard scan my store?</h3>
        <p>
          Free plan: once a week. All paid plans: once a day. You can also trigger a manual scan
          any time from the Scans page in the app.
        </p>

        <h3>What counts as an &quot;issue&quot;?</h3>
        <p>
          A broken internal or external link (404/410), a server error (5xx) on a linked page, a
          request that times out, or a redirect chain/loop that&apos;s excessively long. Issues are
          grouped by severity — critical issues are broken links on your own store; the same
          problem on an external site is flagged as a warning.
        </p>

        <h3>How do I fix a broken link?</h3>
        <p>
          Open the issue from the Issues page and choose &quot;Fix with a redirect&quot; — this
          creates a real redirect on your store via Shopify&apos;s URL Redirect feature, pointing
          the broken path somewhere that works.
        </p>

        <h3>How do I change or cancel my plan?</h3>
        <p>
          Go to the Billing page in the app. Upgrades take you through Shopify&apos;s standard
          subscription approval; downgrading to Free is immediate and cancels the Shopify charge.
        </p>

        <h3>What happens to my data if I uninstall?</h3>
        <p>
          Uninstalling deactivates the app immediately. Shopify notifies us 48 hours later and we
          permanently delete all of your shop&apos;s data at that point — see our{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>

        <h3>Does LinkGuard access my customers&apos; data?</h3>
        <p>
          No. LinkGuard only reads your store&apos;s public content (products, pages, collections,
          blog posts, navigation) — never orders, customers, or checkout information.
        </p>
      </section>

      <section>
        <h2>Something not covered here?</h2>
        <p>
          Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with your store domain and
          a description of the issue, and we&apos;ll get back to you.
        </p>
      </section>
    </LegalPage>
  );
}
