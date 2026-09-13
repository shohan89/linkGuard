import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Shared shell for the public, non-embedded pages (privacy/terms/support)
 * Shopify's App Store submission requires as standalone URLs — deliberately
 * plain HTML, not Polaris, since these are viewed outside the admin iframe
 * by reviewers and merchants who haven't (or won't) install the app.
 */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="legal-page">
      <header className="legal-page__header">
        <strong>LinkGuard</strong>
        <nav>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/support">Support</Link>
        </nav>
      </header>
      <main>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}
