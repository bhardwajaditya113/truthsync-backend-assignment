# TruthSync — resilient multi-source sync and revenue metrics

Backend-only assessment implementing a correctness-first pipeline for HubSpot contacts/deals, Stripe test charges, and Google Calendar events. Records are normalized into Supabase Postgres, replayed safely, and queried through one canonical revenue definition.

## What is implemented

- Incremental and full fetches for all three adapters.
- Google Calendar `410 Gone` and rejected/invalid cursor recovery through a full backfill.
- Page-level transactions, with the completed-run cursor published atomically only on the terminal page.
- Idempotent writes using `unique(source, external_id)` plus `ON CONFLICT ... DO UPDATE`.
- Protection from out-of-order delivery: an older source version cannot overwrite a newer row.
- Per-source failure isolation; one outage or schema-validation failure does not wedge the run.
- Bounded provider calls; a hung upstream becomes a structured source failure after a deadline.
- An auditable `sync_runs` log and admin-protected sync endpoints.
- Revenue calculated only from an explicit `(source, status)` allow-list.
- Summary and daily/weekly views derived from the same Postgres function.
- Currency-safe totals. Different currencies are never silently added together.
- Archived HubSpot objects and cancelled Calendar events land as non-collected tombstones.
- Supabase tables use RLS and explicitly deny browser-facing API roles.
- A deterministic local failure demo and automated contract tests.

## Architecture

```text
HubSpot ─────────┐
Stripe ──────────┼─ adapters ─ sync orchestrator ─ transactional upserts ─ Supabase Postgres
Google Calendar ─┘                       │                            │
                                independent result/run       revenue_by_period()
                                                                     │
                                                      summary API ───┴── breakdown API
```

The adapter boundary is the anti-corruption layer: each provider shape becomes a `NormalizedRecord`. The orchestrator knows nothing about provider fields. The database owns uniqueness, cursor atomicity, and the canonical revenue predicate.

## Normalized model

Every record has `source`, `external_id`, `kind`, `occurred_at`, and `source_updated_at`, plus nullable common fields (`name`, `email`, `amount_minor`, `currency`, `source_status`) and JSONB metadata. Money is stored in integer minor units, never floating point.

Identity is `(source, external_id)`, not just the provider ID. Replaying a webhook or sync page updates the same logical row. The schema permits a future source name without a migration; revenue remains zero until its collected statuses are deliberately added to `collected_statuses`.

## Revenue invariant

`migrations/001_initial.sql` contains the only revenue definition:

1. Select transaction rows in the half-open range `[from, to)`.
2. Inner-join the positive allow-list `collected_statuses` on both source and status.
3. Group by requested period and currency.

An unknown source or status cannot count accidentally. `/summary` aggregates `revenue_by_period`; `/breakdown` returns it directly. A SQL contract test rejects negative status predicates, and a service test proves both paths call the same function and reconcile.

Refunded Stripe charges map to `refunded` and are excluded. Partially refunded charges remain `succeeded`, with only the captured amount less refunded amount stored. This makes the metric net collected revenue.

## Run locally

Requirements: Node.js 22 and PostgreSQL 15+.

```bash
cp .env.example .env
npm install
npm run migrate
npm run seed:demo
npm run seed:hubspot
npm run seed:stripe
npm run seed:calendar
npm run sync:once
npm test
npm run dev
```

Set a real `DATABASE_URL`; a Supabase session-pooler connection string is appropriate for Render. For a credential-free adapter demonstration set `DEMO_MODE=true`. The seed script is also idempotent and creates collected, pending, and unknown-status transactions; the expected USD total is `20000` minor units.

```bash
curl http://localhost:3000/health

curl -X POST http://localhost:3000/sync \
  -H "Authorization: Bearer $SYNC_ADMIN_TOKEN"

curl "http://localhost:3000/metrics/revenue/summary?from=2025-01-01T00:00:00Z&to=2025-02-01T00:00:00Z"

curl "http://localhost:3000/metrics/revenue/breakdown?from=2025-01-01T00:00:00Z&to=2025-02-01T00:00:00Z&bucket=day"

npm run demo:failure
```

The failure demo intentionally makes Stripe unavailable and gives Calendar an expired cursor. HubSpot lands, Calendar falls back to full, Stripe reports failure, and the process exits normally with two records.

## Connect real free-tier sources

### HubSpot

1. Create a developer/test account and a private app with `crm.objects.contacts.read` and `crm.objects.deals.read`.
2. Add several contacts and deals, including open and closed-won deals.
3. Set `HUBSPOT_ACCESS_TOKEN`.

The adapter pages through both CRM object types under one source cursor. Incremental searches use a fixed `[previous high-water − 2 minutes, run high-water)` window and provider paging tokens. The small overlap protects against search-index delay and is safe because writes are idempotent. Because HubSpot excludes archived objects from search, every run also scans archived contact/deal pages; an archived closed-won deal becomes an `archived` tombstone and stops counting. Currency strings are scaled with the ISO currency exponent without floating-point arithmetic. Set `HUBSPOT_CURRENCY` to the account currency if a deal omits its currency property.

### Google Calendar

1. Create a Google Cloud project and enable the Calendar API.
2. Create a service account and share a dedicated calendar with its email using
   **Make changes to events** permission. Base64-encode the service-account JSON into
   `GOOGLE_SERVICE_ACCOUNT_JSON`. OAuth client/secret/refresh-token credentials are
   also supported as an alternative.
3. Set `GOOGLE_CALENDAR_ID` to the dedicated calendar ID and run `npm run seed:calendar`.

The initial fetch stores `nextSyncToken`. Incremental fetches reuse it; a `410` triggers a full fetch and replaces the token only after pages commit.

### Stripe

1. Use a Stripe sandbox/test-mode account and create successful, failed, and refunded payments with test cards.
2. Set `STRIPE_SECRET_KEY=sk_test_...`.

The adapter reads a full test-mode charge snapshot, then consumes Stripe events for incremental updates so a
refund applied to an older charge is not missed. Event cursors beyond Stripe's retention window deliberately
trigger a full snapshot. Never commit keys or use real card details.

## Supabase and Render deployment

1. Create a free Supabase project and copy its Postgres session-pooler URI.
2. Push this repository to GitHub.
3. In Render, create a Blueprint from `render.yaml` or a free Node web service.
4. Add `DATABASE_URL`, provider secrets, and `SYNC_ADMIN_TOKEN` as secret environment variables.
5. Deploy. Render runs migrations before starting and checks `/health`.
6. Trigger `/sync`, then verify both metrics endpoints for the same range.

Render free services can sleep when idle, so the first request may be slow. Supabase is the durable store; the service never relies on Render's ephemeral filesystem. The migration enables RLS on every application table and revokes table/function access from Supabase's `anon` and `authenticated` API roles; the backend uses the direct owner connection.

## Tests and verification

```bash
npm run typecheck
npm test
npm run build
npm run sync:once
npm run sync:once # immediate replay proves idempotency
npm run verify:db -- 2025-01-01T00:00:00Z 2027-01-01T00:00:00Z
npm run demo:failure
```

Tests cover replay idempotency, stale-cursor fallback, source failure isolation/timeouts, Stripe refund events, exact currency scaling, shared revenue computation, summary/breakdown reconciliation, and an architectural guard that forbids direct application reads from the revenue tables.

## Tradeoffs and production follow-ups

- The assignment-sized orchestrator processes one page at a time. At larger volume I would use a durable queue and source-specific concurrency/rate limiting.
- HubSpot search can have indexing delay and a 10,000-result cap. Inclusive timestamp overlap protects delay at this scale; a large tenant needs time-window partitioning.
- A failed full backfill upserts valid pages before failure but does not advance past the failed page. Re-running is safe. A snapshot-generation table would provide atomic visibility for destructive reconciliation.
- Provider deletions are retained as explicit tombstone statuses rather than physically deleted, preserving auditability without counting deleted revenue.
- The API returns `207 Multi-Status` when at least one source completes and `503` only if all fail.
- There is no scheduler dependency: Render or any external cron can call the authenticated `/sync` endpoint.

## Five-minute demo outline

See [DEMO.md](DEMO.md) for a timed script. Show the live health endpoint, run sync twice and show no duplicate rows, compare summary to the sum of breakdown buckets, add an unknown status and show zero metric impact, then run the isolated-outage/expired-cursor case.

## Sources and references

- [HubSpot CRM search](https://developers.hubspot.com/docs/api-reference/latest/crm/search-the-crm), [object list/archived parameter](https://developers.hubspot.com/docs/api-reference/latest/crm/objects/objects/get-objects), and [Contacts API](https://developers.hubspot.com/docs/api-reference/latest/crm/objects/contacts/guide)
- [Google Calendar incremental synchronization and `410` recovery](https://developers.google.com/workspace/calendar/api/guides/sync)
- [Stripe test environments](https://docs.stripe.com/testing-use-cases), [test cards](https://docs.stripe.com/testing), [Charges list API](https://docs.stripe.com/api/charges/list), and [Events API](https://docs.stripe.com/api/events/list)
- [Supabase Postgres connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres) and [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Render Node deployment](https://render.com/docs/deploy-node-express-app) and [free-tier limitations](https://render.com/docs/free)
- [Fastify](https://fastify.dev/docs/latest/), [node-postgres](https://node-postgres.com/), [Zod](https://zod.dev/), and [Vitest](https://vitest.dev/)

## AI usage

AI was used for architecture review, implementation assistance, test-case generation, and documentation. Every generated change was reviewed and verified with TypeScript compilation, automated tests, and the deterministic failure demo. The full disclosure and sanitization notes are in [AI_USAGE.md](AI_USAGE.md).

## Submission links

- Live deployment: https://truthsync-api.onrender.com
- Demo video (4:18): https://drive.google.com/file/d/1iKH7pcnl6YLhC72tVelPzEST9UWhrFt7/view?usp=sharing
- Public GitHub repository: https://github.com/bhardwajaditya113/truthsync-backend-assignment
- Sources and references: https://github.com/bhardwajaditya113/truthsync-backend-assignment#sources-and-references
- AI usage disclosure: https://github.com/bhardwajaditya113/truthsync-backend-assignment/blob/main/AI_USAGE.md
- Sanitized AI chat export: https://github.com/bhardwajaditya113/truthsync-backend-assignment/blob/main/AI_CHAT_EXPORT.md
