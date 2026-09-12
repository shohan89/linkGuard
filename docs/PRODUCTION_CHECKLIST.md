# Production launch checklist

Work through this top to bottom before announcing/listing the app. Items
marked **(manual)** require a human in a browser (Partner Dashboard,
hosting console) — nothing here can run those unattended.

## 1. Shopify Partner Dashboard (manual)

- [ ] **Distribution set** (Apps → LinkGuard → Distribution): Custom or
      public listing draft. Billing API calls fail without this — see
      `docs/DEPLOYMENT.md` and the note in
      `src/lib/billing/index.integration.test.ts`. Verify by actually
      running `npm run test:integration` against production-equivalent
      config once this is set — those tests currently skip themselves
      with a warning until it is.
- [ ] App URL set to the real production `SHOPIFY_APP_URL`.
- [ ] Allowed redirection URL: `<SHOPIFY_APP_URL>/api/auth/callback`.
- [ ] GDPR mandatory webhooks (all three) point at
      `<SHOPIFY_APP_URL>/api/webhooks`.
- [ ] `shopify.app.toml` updated to match (application_url, redirect_urls,
      webhooks.privacy_compliance) and pushed with `npm run shopify:deploy`.
- [ ] Scopes in `shopify.app.toml` `[access_scopes]` match
      `SHOPIFY_SCOPES` env var exactly.
- [ ] App listing content (icon, description, screenshots, pricing page
      text) filled in if pursuing the public app store — not required for
      a custom-distribution install.

## 2. Environment & secrets

- [ ] Every variable in `.env.production.example` set on **both** the web
      and worker processes/services.
- [ ] `NODE_ENV=production`.
- [ ] `SHOPIFY_APP_URL` is the real domain, not a tunnel URL.
- [ ] `SHOPIFY_API_SECRET` matches the Partner Dashboard value exactly (a
      stale/rotated secret breaks session-token and webhook verification
      silently — every request returns 401 with no obvious cause).
- [ ] Secrets are in the platform's env-var store, not committed anywhere
      (`.env*` is gitignored except the `.example` templates — confirm
      `git status` shows no real `.env` staged).
- [ ] `RESEND_API_KEY` set and `NOTIFICATIONS_FROM_EMAIL` uses a domain
      verified in Resend (not the shared `onboarding@resend.dev` sender)
      — otherwise merchants get no notification emails at all, silently.

## 3. Database

- [ ] Production Postgres provisioned (Supabase or equivalent).
- [ ] `DATABASE_URL` (pooled) and `DIRECT_URL` (session/direct) both set
      and pointed at the same database.
- [ ] All 9 migrations applied via `npx prisma migrate deploy` — see
      `docs/DATABASE_MIGRATIONS.md`. **Never** `prisma migrate dev` or
      `prisma db push` against production.
- [ ] `npx prisma generate` run (or confirmed automatic) so
      `@prisma/client` matches the deployed schema.
- [ ] A backup exists (Supabase automatic daily backup on paid plans, or a
      manual on-demand backup) before the first migration run, in case a
      rollback is needed.

## 4. Redis / background jobs

- [ ] Production Redis provisioned (Upstash or equivalent), `REDIS_URL`
      uses `rediss://` (TLS) if the provider requires it.
- [ ] Worker process deployed as a **persistent** process (not a
      serverless function) — confirm its startup log shows `Scan worker +
      scheduler started, waiting for jobs...` with no connection errors.
- [ ] Confirm the scheduler actually registered: after the worker starts,
      check Redis (or wait for the next 3am/Monday-4am window) — no
      manual registration step needed, `registerSchedules()` runs
      idempotently on every worker boot.
- [ ] Rate limiting confirmed working against production Redis (the same
      INCR+EXPIRE check used in `src/lib/security/rate-limit.server.ts`
      — see the live-verification method used in the security audit if
      you want to re-confirm after switching Redis providers).

## 5. Security (carried over from the full security audit — verify these survived the move to production config, don't just trust they still hold)

- [ ] Authentication: session-token JWT verification working (a bad
      `SHOPIFY_API_SECRET` breaks this silently — see §2).
- [ ] Tenant isolation: pages fetch data client-side via
      bearer-token-verified API routes, never server-side from the raw
      `shop` query param — this was the core architectural fix; don't
      reintroduce server-side data fetching in a page component keyed off
      `searchParams.shop`.
- [ ] IDOR: `issueId` ownership checks in redirects flow still in place.
- [ ] SSRF guard active in the crawler (`lib/crawler/ssrf-guard.server.ts`)
      — this depends on outbound DNS resolution working normally from the
      production network; confirm the worker's hosting environment
      doesn't sit behind something that makes all resolved addresses look
      private (some corporate/VPN egress setups do — would make every
      scan fail as "SSRF blocked").
- [ ] Billing callback nonce (CSRF/replay protection) — requires the
      `pendingNonce` migration to be applied (§3).
- [ ] Webhook idempotency — `WebhookEvent` table populated; confirm by
      checking that table has rows after the first real webhook arrives.
- [ ] CSP `frame-ancestors` (middleware.ts) — confirm the app actually
      loads embedded in `https://admin.shopify.com` in production (a
      misconfigured `SHOPIFY_APP_URL` or reverse-proxy stripping headers
      would silently break embedding only in prod, not dev).

## 6. Billing

- [ ] Distribution set (§1) — hard blocker otherwise.
- [ ] All four plan tiers (Free/Starter/Growth/Pro) render correctly on
      `/billing` with real usage numbers.
- [ ] Upgrade flow: start an upgrade, approve on Shopify's real
      confirmation page (not `test: true` — actually spend Shopify's test
      charge flow end to end on a development store first), confirm the
      callback lands back in the app with the new plan active.
- [ ] Downgrade flow: cancel and confirm plan reverts to Free and the
      Shopify subscription shows cancelled in the Partner Dashboard.
- [ ] Confirm `test: true` is only sent in non-production
      (`process.env.NODE_ENV !== "production"` in
      `src/lib/billing/index.ts`) — a real merchant must be charged
      real money, not a test charge.

## 7. Webhooks

- [ ] `app/uninstalled` fires and marks the shop inactive + deletes the
      stored session (verify by uninstalling from a test store).
- [ ] GDPR webhooks (`customers/data_request`, `customers/redact`,
      `shop/redact`) registered and return 200 — Shopify's app review
      checks these are reachable and correctly signed.
- [ ] `shop/redact` actually erases the shop's data (cascading delete) —
      confirmed in the integration suite; re-verify once against
      production if you want extra confidence before real merchant data
      is at stake.

## 8. Testing

- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` clean.
- [ ] `npm test` (unit suite) green.
- [ ] `npm run test:integration` green against a **non-production**
      database/Redis that mirrors production config (never point the
      integration suite at production — it creates and deletes real rows,
      and the redirects/billing suites mutate a real Shopify store).
- [ ] `npm run build` succeeds with no type/lint errors (this is also
      what most hosting platforms run automatically — confirm locally
      first so a broken build doesn't surprise you mid-deploy).

## 9. Monitoring (see `docs/DEPLOYMENT.md`)

- [ ] Both processes' logs reachable somewhere you'll actually look.
- [ ] Know what a healthy worker log looks like at startup, so a silent
      crash-loop is noticeable.
- [ ] Decide who gets paged (or at least emailed) if the worker process
      dies — nothing does this automatically today.

## 10. Launch smoke test (do this on the real production deployment, not staging)

- [ ] Install the app fresh on a real (or spare development) store.
- [ ] Confirm the dashboard loads with real data (zeros, for a fresh
      install — not an error).
- [ ] Trigger a manual scan, confirm it completes and issues appear.
- [ ] Create a redirect from a broken-link issue, confirm it appears on
      the storefront.
- [ ] Upgrade a plan (real charge, not test), confirm it activates.
- [ ] Uninstall the app, confirm `app/uninstalled` processed (shop marked
      inactive within a minute or two).
- [ ] Reinstall, confirm it reactivates cleanly rather than erroring on
      already-existing rows.

## After launch

- [ ] Watch logs closely for the first real merchant installs.
- [ ] Revisit `docs/DATABASE_MIGRATIONS.md`'s zero-downtime notes before
      the first schema change after real merchant data exists.
- [ ] Consider adding real error tracking (Sentry or similar) once volume
      makes log-reading impractical — not wired in today.
