import "dotenv/config";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const [summary, breakdown, duplicates, excluded] = await Promise.all([
    db.query<{ currency: string; total: string }>(
      `select currency, sum(amount_minor)::bigint::text as total
       from revenue_by_period('2025-01-01','2025-02-01','day') group by currency order by currency`
    ),
    db.query<{ currency: string; total: string }>(
      `select currency, sum(amount_minor)::bigint::text as total
       from revenue_by_period('2025-01-01','2025-02-01','week') group by currency order by currency`
    ),
    db.query<{ count: string }>(
      `select count(*)::text from (
         select source, external_id from normalized_records
         group by source, external_id having count(*) > 1
       ) duplicate_identities`
    ),
    db.query<{ count: string }>(
      `select count(*)::text from normalized_records r
       where r.kind='transaction' and not exists (
         select 1 from collected_statuses s
         where s.source=r.source and s.source_status=r.source_status
       )`
    )
  ]);
  if (JSON.stringify(summary.rows) !== JSON.stringify(breakdown.rows)) {
    throw new Error("Revenue summary and breakdown do not reconcile");
  }
  if (duplicates.rows[0]?.count !== "0") throw new Error("Duplicate provider identities found");
  console.log(JSON.stringify({
    reconciledTotals: summary.rows,
    duplicateIdentities: Number(duplicates.rows[0]?.count ?? 0),
    transactionsExcludedByAllowList: Number(excluded.rows[0]?.count ?? 0)
  }, null, 2));
} finally {
  await db.end();
}
