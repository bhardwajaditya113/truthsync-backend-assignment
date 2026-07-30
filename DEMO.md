# Demo script (target: 4 minutes 30 seconds)

## 0:00–0:35 — Context and architecture

Show the README diagram. Explain normalized provider identities, transactional cursor updates, and why integer minor units and per-currency totals prevent false numbers.

## 0:35–1:35 — Live service, real data, and idempotency

Open `https://truthsync-api.onrender.com`, then run:

```bash
npm run demo:live
```

Explain that the command reads the admin token privately from `.env`. Point out `mode: live`, the three independent successful sources, and the immediate replay writing zero records. Then show that the summary total exactly matches the sum of daily buckets.

## 1:35–2:20 — Hosted database proof

Run:

```bash
npm run verify:db -- 2025-01-01T00:00:00Z 2027-01-01T00:00:00Z
```

Point out `duplicateIdentities: 0`, excluded non-allow-listed transactions, four RLS-protected tables, and zero exposed Supabase API roles.

## 2:20–3:20 — Required edge cases

Run:

```bash
npm run demo:failure
```

Explain that Stripe fails independently, Google Calendar simulates `410` and successfully switches from incremental to full, and HubSpot still lands. Show that the process returns structured per-source results rather than crashing.

## 3:20–4:15 — Tests and tradeoffs

Run `npm test`. Mention inclusive cursor overlap plus idempotent upsert, atomic page/cursor commits, unknown-status exclusion, refund handling, bounded provider timeouts, and the large-tenant HubSpot time-window follow-up.

## 4:15–4:30 — Close

Return to the README and state that the public deployment, source references, tradeoffs, and AI disclosure are linked there.
