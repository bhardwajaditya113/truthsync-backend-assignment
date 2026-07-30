import "dotenv/config";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const from = process.argv[2] ?? "2025-01-01T00:00:00Z";
const to = process.argv[3] ?? "2027-01-01T00:00:00Z";
if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) {
  throw new Error("Usage: npm run verify:db -- <from-ISO> <to-ISO>; from must be before to");
}
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const [summary, breakdown, duplicates, excluded, rowSecurity, exposedRoles] = await Promise.all([
    db.query<{ currency: string; total: string }>(
      `select currency, sum(amount_minor)::bigint::text as total
       from revenue_by_period($1::timestamptz,$2::timestamptz,'day') group by currency order by currency`,
      [from, to]
    ),
    db.query<{ currency: string; total: string }>(
      `select currency, sum(amount_minor)::bigint::text as total
       from revenue_by_period($1::timestamptz,$2::timestamptz,'week') group by currency order by currency`,
      [from, to]
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
    ),
    db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relname = any($1::text[]) order by relname`,
      [["normalized_records", "collected_statuses", "sync_state", "sync_runs"]]
    ),
    db.query<{ rolname: string; table_read: boolean; function_execute: boolean }>(
      `select rolname,
         has_table_privilege(rolname, 'normalized_records', 'select') as table_read,
         has_function_privilege(rolname,
           'revenue_by_period(timestamptz,timestamptz,text)', 'execute') as function_execute
       from pg_roles where rolname = any($1::text[]) order by rolname`,
      [["anon", "authenticated"]]
    )
  ]);
  if (JSON.stringify(summary.rows) !== JSON.stringify(breakdown.rows)) {
    throw new Error("Revenue summary and breakdown do not reconcile");
  }
  if (duplicates.rows[0]?.count !== "0") throw new Error("Duplicate provider identities found");
  if (rowSecurity.rows.length !== 4 || rowSecurity.rows.some((row) => !row.relrowsecurity)) {
    throw new Error("Row-level security is not enabled on every application table");
  }
  if (exposedRoles.rows.some((row) => row.table_read || row.function_execute)) {
    throw new Error("A Supabase API role can access private sync data or the revenue RPC");
  }
  console.log(JSON.stringify({
    range: { from, to },
    reconciledTotals: summary.rows,
    duplicateIdentities: Number(duplicates.rows[0]?.count ?? 0),
    transactionsExcludedByAllowList: Number(excluded.rows[0]?.count ?? 0),
    rowLevelSecurityTables: rowSecurity.rows.length,
    exposedApiRoles: exposedRoles.rows.filter((row) => row.table_read || row.function_execute).length
  }, null, 2));
} finally {
  await db.end();
}
