# Deployment

LinkGuard is two long-running processes plus three managed services:

| Process / service | What it does | Can it be serverless? |
|---|---|---|
| **Web** (`npm start`, runs `next start`) | Serves the embedded app UI + all `/api/*` routes | Yes |
| **Worker** (`npm run worker`, runs `src/worker.ts`) | Runs scans (BullMQ), the daily-scan/weekly-report cron schedulers | **No** — must be a persistent process |
| Postgres (Supabase) | All app data | managed |
| Redis (Railway) | BullMQ queue + rate limiting | managed |
| Resend | Outbound notification emails | managed |

The worker being a persistent process is the one constraint that rules out
a pure-serverless platform for the whole app. Pick one of the two shapes
below.

## Option A — single platform, two services (recommended)

Render, Railway, and Fly.io all support "one repo, two processes" natively
(a `Procfile` or per-service build/start command pointing at the same
repo). This keeps deployment, env vars, and logs in one place.

1. Create **two services** from this repo:
   - `web`: build `npm run build`, start `npm start`
   - `worker`: build `npm run build` (needs the same compiled/typechecked
     code and `node_modules`, even though it runs via `tsx`), start `npm run worker`
2. Set every variable from `.env.production.example` on **both** services.
3. Point your custom domain at the `web` service. The `worker` service
   needs no public URL/domain at all — it never listens on a port.
4. Health check: `web` should respond `200` on `GET /` when not embedded
   (renders `NotEmbeddedNotice`) — use that as the platform's health-check
   path, not an admin-only route.

## Option B — split platforms (Vercel + a persistent-process host)

If you specifically want Vercel for the web app (its Next.js optimizations
are real), the worker still needs somewhere that isn't serverless:

- **Web**: deploy to Vercel as a normal Next.js app. Set all env vars in
  Vercel's Project Settings → Environment Variables (Production
  environment). Vercel's build runs `next build`, which also runs
  `tsc`/ESLint as part of the Next.js build step (see
  `package.json`'s `build` script) — a broken build fails the deploy
  automatically.
- **Worker**: deploy to Railway, Render, Fly.io, or a small persistent VM.
  Build: `npm ci && npx prisma generate`. Start: `npm run worker`. Set the
  same env vars there too (it needs `DATABASE_URL`, `REDIS_URL`,
  `SHOPIFY_*` — it talks to Shopify's Admin API directly during scans).

Either way, **both processes need `npx prisma generate` to have run**
against the current `prisma/schema.prisma` before starting. `package.json`
has a `postinstall` script (`prisma generate`) that runs automatically
after `npm install` / `npm ci` on any platform, so this normally just
works — worth confirming once on a new platform rather than assuming.

## Database and Redis

This project has used Supabase (Postgres) and Railway (Redis) throughout
development — both have generous free tiers and work well for a
launch-stage app. See `docs/DATABASE_MIGRATIONS.md` for the Supabase
pooler-URL split (`DATABASE_URL` vs `DIRECT_URL`) in detail. Any
Postgres-compatible host works; if you switch providers, keep the same
transaction-pooler-vs-direct-connection distinction if the provider offers
pooling, since Prisma Migrate needs a non-pooled (or session-mode) connection.

## Shopify Partner Dashboard configuration

Before the app can be installed by real merchants, update in the Partner
Dashboard (Apps → LinkGuard):

1. **App URL**: your production `SHOPIFY_APP_URL`.
2. **Allowed redirection URL(s)**: `<SHOPIFY_APP_URL>/api/auth/callback`.
3. **GDPR mandatory webhooks** (Compliance webhooks section): all three
   pointed at `<SHOPIFY_APP_URL>/api/webhooks` — customer data request,
   customer redact, shop redact.
4. **Distribution**: must be **Public**. Custom distribution can never use the
   Billing API (and can't be converted to Public afterwards), so every
   upgrade attempt would fail with "Apps without a public
   distribution cannot use the Billing API" (see `docs/PRODUCTION_CHECKLIST.md`).

`shopify.app.toml` mirrors most of this — update its `application_url`,
`[webhooks.privacy_compliance]` URLs, and `[auth].redirect_urls` to the
real production URL, then run:

```
npm run shopify:deploy
```

to push the config to Shopify (this updates the Partner Dashboard's app
configuration record; it does **not** deploy your code — that's the
platform-specific step above).

## Environment variables

See `.env.production.example` for the full list with explanations. Set
every one of them on both the web and worker processes — the worker talks
to Postgres, Redis, and Shopify's Admin API directly, so it needs the same
`DATABASE_URL`, `REDIS_URL`, and `SHOPIFY_*` values as the web process.

## Rollout sequence for a first production deploy

1. Provision Postgres + Redis, get their connection strings.
2. Set all env vars on both services (`docs/.env.production.example`).
3. Run the database migration (`docs/DATABASE_MIGRATIONS.md`) — **before**
   starting either process against this database for the first time.
4. Deploy `worker` first, confirm its logs show `Scan worker + scheduler
   started, waiting for jobs...` with no connection errors.
5. Deploy `web`, confirm `GET /` returns 200.
6. Update the Partner Dashboard + `shopify.app.toml` as above, run
   `npm run shopify:deploy`.
7. Install on a real (or development) store and walk through
   `docs/PRODUCTION_CHECKLIST.md`'s smoke test before announcing/launching.

## Rolling out a code change after launch

1. Merge to your deploy branch.
2. If the change includes a new Prisma migration, run it against
   production **before** the new code that depends on it goes live (see
   `docs/DATABASE_MIGRATIONS.md`) — a new column/table should exist before
   code that reads/writes it starts running; dropping a column should wait
   until no deployed code still reads it.
3. Deploy `worker`, then `web` (the worker has no HTTP traffic to drain,
   so it's the lower-risk one to restart first; deploying it first also
   means any in-flight scan job picks up on the new worker code as soon as
   it restarts, rather than briefly running old-worker/new-web).
4. Watch logs on both for a few minutes after each restart.

## Logging and monitoring

Nothing beyond `console.log`/`console.error` is wired up today. At
minimum before launch:

- Forward both processes' stdout/stderr to your platform's log viewer
  (Render/Railway/Fly.io do this by default) or a log aggregator.
- Watch for repeated `console.error` lines matching `Failed to persist
  scan result`, `Failed to cache contact email`, or `Worker process failed
  to start` — these currently only log, they don't page anyone.
- Consider adding a real error-tracking service (Sentry or similar) if you
  want to be notified of failures instead of having to read logs — not
  currently wired into this codebase.
