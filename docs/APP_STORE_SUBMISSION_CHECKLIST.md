# Shopify App Store submission checklist

Status as of this writing — ✅ done, ⚠️ needs your action, ❌ not started.
Re-verify everything against Shopify's current published requirements
before submitting; these change over time and this list reflects what's
known now.

## 1. App listing

- ⚠️ Copy drafted in `docs/APP_STORE_LISTING.md` (name, tagline,
  description, feature list, category, keywords) — review and paste into
  Partner Dashboard.
- ⚠️ App icon: placeholder generated at `docs/assets/app-icon.png` (1200×1200, source in `app-icon.svg`). Replace with a designed one if you have a logo.
- ⚠️ Pricing table in the listing must match `src/lib/billing/plans.ts`
  exactly — re-check if plans change before submitting.
- ⚠️ Distribution must be switched from Custom to Public (or the public
  listing draft started) in Partner Dashboard → Distribution — this is
  what unlocks the App listing form at all.

## 2. Screenshots

- ❌ Not taken — see `docs/SCREENSHOTS.md` for the exact shot list, specs,
  and how to get realistic (not empty) data into them first.
- Minimum 3 images, 1600×900 or 1200×800, no browser chrome.

## 3. Pricing

- ✅ Four real tiers implemented and live-tested this session (Free/
  Starter/Growth/Pro), enforced via `BillingService` + real Shopify
  Billing API (`ShopifyBillingService`).
- ✅ Upgrade/downgrade/cancel flows built, with CSRF/replay-protected
  callback (nonce) and real-DB-backed plan-limit enforcement.
- ⚠️ Never actually completed a *real* (non-test) end-to-end charge —
  a partner development store always gets a `test: true` charge (it has
  no payment method), so the real-charge path is untested. Do at least one real upgrade on a
  store capable of paying before/shortly after launch, to confirm the
  live (non-test) billing path works exactly like the tested one.
- ⚠️ Confirm Shopify's Distribution requirement is satisfied (§1) — the
  Billing API rejects every call otherwise, confirmed directly by the
  integration test suite earlier.

## 4. Privacy policy

- ✅ Written and published: `src/app/privacy/page.tsx` →
  `/privacy`. Describes exactly what's collected (shop domain, storefront
  URLs, scan results, billing state — no customer PII), why, third
  parties (Shopify, Supabase, Railway, Vercel, Resend), and deletion on uninstall.
- ⚠️ Not legal advice — this is accurate to what the code actually does,
  but have it reviewed by someone qualified before relying on it for a
  live public app handling real merchants' data.
- ⚠️ Update the contact email in the page if `clustercloudbd@gmail.com`
  isn't the right address going forward.

## 5. Terms of service

- ✅ Written and published: `src/app/terms/page.tsx` → `/terms`. Covers
  the service description, billing/cancellation, acceptable use, warranty
  disclaimer, liability limitation, termination.
- ⚠️ Same caveat as privacy — draft, not a substitute for legal review.
  In particular the liability-limitation and governing-law sections are
  generic boilerplate; consider having a lawyer confirm they're
  appropriate for your situation/jurisdiction.

## 6. Support page

- ✅ Written and published: `src/app/support/page.tsx` → `/support`.
  Contact email + FAQ covering scan frequency, issue severity, fixing
  links, billing changes, uninstall data handling, and the no-customer-
  data point.
- ⚠️ Confirm `clustercloudbd@gmail.com` is an inbox you'll actually
  monitor once this is public — App Store reviewers do test this.

## 7. Security requirements

Carried over from the full security audit performed earlier this
session (see conversation history / commit history for details) — all
still in place as of the last check:

- ✅ Authentication: real HS256 JWT session-token verification
  (`lib/shopify/session.server.ts`), live-tested against forged/expired/
  wrong-audience/tampered tokens.
- ✅ Tenant isolation: all tenant data now flows through bearer-token-
  verified API routes; pages never trust the raw `shop` query param for
  data access (only for UI shell / re-auth redirect target).
- ✅ IDOR fix: `issueId` ownership verified before any redirect
  creation/issue mutation, shop-scoped `updateMany` throughout.
- ✅ SSRF guard on the crawler (`lib/crawler/ssrf-guard.server.ts`) —
  blocks private/loopback/link-local/metadata addresses, live-verified.
- ✅ Webhook HMAC verification (delegated to `@shopify/shopify-api`,
  confirmed via real-HMAC integration tests) + idempotency/audit trail
  (`WebhookEvent` table, dedup by `shopifyWebhookId`).
- ✅ Billing callback CSRF/replay protection via single-use nonce.
- ✅ Rate limiting on mutating endpoints (scans, redirects, billing
  subscribe/cancel), Redis-backed, live-verified against the real Redis.
- ✅ No secrets logged, no tokens reaching client components (checked via
  grep audit).
- ✅ HTTPS-only in production (`SHOPIFY_APP_URL`), CSP `frame-ancestors`
  scoped to the requesting shop + `admin.shopify.com`.
- ⚠️ Re-run `npm run test:integration` once against the actual production
  database/Redis configuration (not just dev) to catch any environment-
  specific drift before submitting.

## 8. Compliance requirements

- ✅ Mandatory GDPR webhooks implemented and tested:
  `customers/data_request`, `customers/redact` (no-ops — no customer PII
  stored, documented as such), `shop/redact` (full cascading delete,
  live-tested).
- ✅ `app/uninstalled` webhook — deactivates shop + deletes stored
  session.
- ✅ Only requests scopes actually used — see justification table in
  `docs/APP_STORE_LISTING.md`.
- ✅ Embedded via App Bridge, session-token authenticated (not the
  deprecated cookie-session pattern).
- ⚠️ Shopify's automated "Built for Shopify" / App Requirements checks
  (performance, latest App Bridge version, no deprecated API usage) run
  during submission — nothing in this codebase is knowingly deprecated
  (API version 2026-10, App Bridge loaded from Shopify's CDN), but these
  checks should be treated as authoritative over this list at submission
  time.
- ❌ Have not run Shopify's own pre-submission requirement checklist tool
  inside Partner Dashboard (it appears once Distribution is set to
  Public) — do this and resolve anything it flags before submitting.

## Before you click submit

1. §1–2: finish listing copy + icon + screenshots.
2. §3: do one real (non-test) billing charge somewhere capable of paying.
3. §4–6: confirm contact email, get legal eyes on privacy/terms if at all
   feasible.
4. §7: re-run integration tests against production config.
5. §8: run Partner Dashboard's own in-app requirements checklist once
   Distribution is set to Public, and resolve everything it flags —
   treat it as the final authority, this document is a starting point.
