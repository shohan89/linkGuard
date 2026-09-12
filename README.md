# LinkGuard

Shopify public app that monitors stores for broken links, 404s, 5xx errors,
and redirect problems.

**Phase 1 status**: OAuth install, embedded session handling, Polaris shell,
and mandatory GDPR/uninstall webhooks. No link scanning yet.

## Stack

- Next.js (App Router) + TypeScript
- Shopify Polaris (React) for UI
- Shopify App Bridge (CDN script) for embedding
- `@shopify/shopify-api` (core library, hand-wired — there is no official
  Next.js framework package from Shopify)
- PostgreSQL + Prisma

## Prerequisites

- Node.js 22+
- Docker (for local Postgres) or an existing Postgres instance
- A Shopify Partner account and a development store
- A public HTTPS tunnel to your local dev server (Shopify CLI's built-in
  tunnel, ngrok, or Cloudflare Tunnel) — Shopify cannot reach `localhost`

## Setup

1. Install dependencies:

   ```
   npm install
   ```

2. Start Postgres:

   ```
   docker compose up -d
   ```

3. Copy the env template and fill in real values:

   ```
   cp .env.example .env
   ```

   - `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`: from Partner Dashboard →
     your app → Client credentials.
   - `SHOPIFY_APP_URL`: your HTTPS tunnel URL, no trailing slash.
   - `DATABASE_URL`: leave as-is if using the provided `docker-compose.yml`.

4. In the Partner Dashboard, set:
   - App URL: `<SHOPIFY_APP_URL>`
   - Allowed redirection URL(s): `<SHOPIFY_APP_URL>/api/auth/callback`
   - Mandatory GDPR webhook URLs: `<SHOPIFY_APP_URL>/api/webhooks` for all
     three (customer data request, customer redact, shop redact)

   These are also declared in `shopify.app.toml` — update the placeholder
   URLs there to match your tunnel before running `shopify app deploy`.

5. Apply the database schema:

   ```
   npx prisma migrate dev --name init
   ```

6. Run the dev server behind your tunnel:

   ```
   npm run dev
   ```

7. Install the app on your development store by visiting:

   ```
   <SHOPIFY_APP_URL>/api/auth?shop=your-dev-store.myshopify.com
   ```

   This redirects you through Shopify's OAuth consent screen. After
   approval you land back in the embedded app inside Shopify admin.

## Project layout

```
prisma/schema.prisma          Session (OAuth) + Shop tables
src/lib/shopify.server.ts     shopifyApi() instance, session storage
src/lib/session.server.ts     Decode App Bridge session tokens -> offline session
src/lib/db.server.ts          Prisma client singleton
src/app/api/auth/             OAuth begin
src/app/api/auth/callback/    OAuth callback, session persistence
src/app/api/webhooks/         app/uninstalled + GDPR webhook handling
src/app/page.tsx              Install-check + embedded dashboard entry
src/app/dashboard-shell.tsx   Polaris UI (client component)
src/middleware.ts             CSP frame-ancestors for embedding
```

## Notes

- Polaris React components must stay inside `"use client"` files — they
  aren't React Server Component-compatible and will break the server
  bundle if imported directly into an async server component.
- `/api/auth` refuses bot user agents (410) by design — this is
  `@shopify/shopify-api`'s built-in protection, not a bug.
