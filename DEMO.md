# Demo script (target: 4 minutes 30 seconds)

## 0:00–0:35 — Context and architecture

Show the README diagram. Explain normalized provider identities, transactional cursor updates, and why integer minor units and per-currency totals prevent false numbers.

## 0:35–1:15 — Live service and real data

Open `/health`, then call authenticated `POST /sync`. Point out the three independent results and `mode`. Show recent `/sync/runs` entries.

## 1:15–2:00 — Idempotency

Run `POST /sync` again. Query Supabase:

```sql
select source, external_id, count(*)
from normalized_records
group by source, external_id
having count(*) > 1;
```

The result is empty because uniqueness is enforced in Postgres, not assumed in application timing.

## 2:00–2:50 — One number, two views

Call summary and daily breakdown with the exact same half-open range. Add the buckets and show equality with the summary for each currency. Briefly show `revenue_by_period` and the positive `collected_statuses` join.

Insert a transaction with status `future_new_status`, call both endpoints again, and show the total does not change. Then deliberately add that `(source,status)` to the allow-list and show both views change together.

## 2:50–3:50 — Required edge cases

Run:

```bash
npm run demo:failure
```

Explain that Stripe fails independently, Google Calendar simulates `410` and successfully switches from incremental to full, and HubSpot still lands. Show that the process returns structured per-source results rather than crashing.

## 3:50–4:30 — Verification and tradeoffs

Run `npm test`. Mention inclusive cursor overlap plus idempotent upsert, atomic page/cursor commits, unknown-status exclusion, refund handling, and the large-tenant HubSpot time-window follow-up.
