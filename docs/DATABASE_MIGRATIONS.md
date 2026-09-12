# Database migrations

Schema: `prisma/schema.prisma`. History: `prisma/migrations/*/migration.sql`
(currently 9 migrations — `20260910110553_init` through
`20260912120000_billing_nonce`). Every migration in that folder has already
been applied to the dev database this project has used throughout
development; production starts from zero and needs all of them applied in
order.

## First production deploy — applying all migrations

Run this **once**, before either the `web` or `worker` process ever
connects to the production database:

```bash
# DATABASE_URL and DIRECT_URL must both point at the production database.
npx prisma migrate deploy
```

`migrate deploy`:
- Applies every migration in `prisma/migrations/` not yet recorded in the
  database's `_prisma_migrations` table, in filename order.
- Never prompts, never generates a new migration, never resets data — the
  only command that belongs in a production/CI pipeline (as opposed to
  `prisma migrate dev`, which is dev-only and will ask to reset the
  database on drift).
- Uses `DIRECT_URL`, not `DATABASE_URL` — see "Why two connection strings"
  below.

After `migrate deploy` succeeds, run `npx prisma generate` (or make sure
your platform's build step does — see `docs/DEPLOYMENT.md`) so the
`@prisma/client` package matches the schema before either process starts.

## Why two connection strings (Supabase specifically)

- `DATABASE_URL` — the **transaction-mode pooler** (port 6543 on
  Supabase). The running app uses this for every normal query. Pooled
  connections are cheap and scale with request volume, but the pooler
  doesn't support the session-level features (prepared statements,
  advisory locks) that Prisma Migrate relies on.
- `DIRECT_URL` — the **session-mode pooler** (port 5432) or a true direct
  connection. Used **only** by `prisma migrate deploy` / `migrate dev` /
  `migrate diff`. Never used by the running app.

If you're not on Supabase, the same split applies to any provider using
PgBouncer in transaction mode (Neon, RDS Proxy, etc.) — point
`DATABASE_URL` at the pooled connection and `DIRECT_URL` at an unpooled
one. If your Postgres has no pooler at all, both variables can point at
the same connection string.

## Adding a new migration (development workflow)

This is how every migration in this repo so far was produced — keep doing
it this way rather than hand-writing SQL from scratch:

```bash
# 1. Edit prisma/schema.prisma with the model change.

# 2. Generate the SQL diff between the current dev DB and the new schema:
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/diff.sql

# 3. Create a new timestamped migration folder and put the SQL there:
mkdir prisma/migrations/$(date +%Y%m%d%H%M%S)_short_description
mv /tmp/diff.sql prisma/migrations/<that-folder>/migration.sql

# 4. Apply it to your dev database:
npx prisma migrate deploy

# 5. Regenerate the client (kill any process holding the old client's
#    native query-engine binary first — on Windows in particular, a
#    running dev server/worker will lock the .dll and generate fails):
npx prisma generate
```

Review the generated SQL before applying it, especially for anything that
isn't a straightforward `ADD COLUMN`/`CREATE TABLE` — Prisma's diff is
usually right but a dropped/renamed column is destructive and worth a
second look.

## Rollback

Prisma has no automatic "down" migration. If a migration turns out to be
wrong after deploying:

- **Additive mistake** (wrong default, extra nullable column): write a
  new forward migration that fixes it. Don't try to delete or edit an
  already-applied migration folder — `_prisma_migrations` has already
  recorded it as applied, and editing history after the fact desyncs any
  other environment that already ran the original.
- **Destructive mistake** (dropped a column/table that's needed): restore
  from a database backup taken before the migration ran (Supabase does
  automatic daily backups on paid plans, and on-demand backups are
  available from the dashboard — take one manually right before any
  migration you're unsure about, per the checklist).
- If a migration partially applied and failed partway through (rare, but
  possible for a multi-statement migration on a flaky connection), Prisma
  marks it "failed" in `_prisma_migrations`. Resolve with
  `npx prisma migrate resolve --rolled-back <migration-name>` after
  manually reverting whatever partial changes it made, then fix and
  reapply.

## Zero-downtime considerations

The web and worker processes restart independently and briefly run
old-code/new-schema or new-code/old-schema during a deploy. To avoid a
window where one process errors on a schema mismatch:

- **Adding a column/table**: safe to migrate before, during, or after
  deploying the code that uses it — old code simply ignores the new
  column.
- **Removing a column/table**: migrate it away only *after* deploying code
  that no longer references it (deploy code first, migrate later) —
  otherwise a still-running old-code instance errors on every query
  touching the now-missing column.
- **Renaming a column**: treat as add-new + backfill + remove-old across
  two separate deploys, not a single `ALTER ... RENAME` — a rename is
  effectively simultaneous add+remove and breaks whichever code version
  is running during the gap.

At this project's current scale (a handful of tables, no production
traffic yet), none of the existing 9 migrations are large enough to need
`CREATE INDEX CONCURRENTLY` or table-lock-avoidance techniques — revisit
this once `scan_results`/`issues` are large enough that a plain migration
against them would hold a noticeable lock.
