import "dotenv/config";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const rows = [
  ["stripe", "pi_demo_paid_1", "2025-01-15T10:00:00Z", 12500, "usd", "succeeded"],
  ["stripe", "pi_demo_pending", "2025-01-15T11:00:00Z", 9900, "usd", "processing"],
  ["hubspot", "invoice_demo_1", "2025-01-16T10:00:00Z", 7500, "usd", "closedwon"],
  ["hubspot", "invoice_demo_unknown", "2025-01-16T11:00:00Z", 999999, "usd", "brand_new_status"]
];
try {
  for (const [source, id, occurredAt, amount, currency, status] of rows) {
    await db.query(`insert into normalized_records
      (source,external_id,kind,occurred_at,source_updated_at,amount_minor,currency,source_status,metadata)
      values($1,$2,'transaction',$3,$3,$4,$5,$6,'{"demo":true}')
      on conflict(source,external_id) do update set amount_minor=excluded.amount_minor, source_status=excluded.source_status`,
      [source, id, occurredAt, amount, currency, status]);
  }
  console.log("Demo data seeded idempotently. Expected collected USD total: 20000");
} finally { await db.end(); }
