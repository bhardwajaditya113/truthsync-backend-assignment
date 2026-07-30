import pg from "pg";
import type { NormalizedRecord, SourceName, SyncRepository, SyncRunResult } from "../domain/types.js";

const { Pool } = pg;
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

export class PostgresRepository implements SyncRepository {
  async getSyncState(source: SourceName) {
    const result = await pool.query<{ cursor: string | null }>("select cursor from sync_state where source = $1", [source]);
    return { cursor: result.rows[0]?.cursor ?? null };
  }

  async savePage(source: SourceName, records: NormalizedRecord[], nextCursor: string | null | undefined): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      for (const record of records) {
        await client.query(
          `insert into normalized_records
            (source, external_id, kind, occurred_at, source_updated_at, name, email,
             amount_minor, currency, source_status, metadata)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           on conflict (source, external_id) do update set
             kind=excluded.kind, occurred_at=excluded.occurred_at,
             source_updated_at=excluded.source_updated_at, name=excluded.name,
             email=excluded.email, amount_minor=excluded.amount_minor,
             currency=excluded.currency, source_status=excluded.source_status,
             metadata=excluded.metadata, ingested_at=now()
           where normalized_records.source_updated_at <= excluded.source_updated_at`,
          [record.source, record.externalId, record.kind, record.occurredAt, record.updatedAt,
            record.name ?? null, record.email ?? null, record.amountMinor ?? null,
            record.currency?.toLowerCase() ?? null, record.sourceStatus?.toLowerCase() ?? null,
            JSON.stringify(record.metadata)]
        );
      }
      if (nextCursor !== undefined) {
        await client.query(
          `insert into sync_state(source, cursor, updated_at) values ($1,$2,now())
           on conflict(source) do update set cursor=excluded.cursor, updated_at=now()`,
          [source, nextCursor]
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordRun(run: SyncRunResult): Promise<void> {
    await pool.query(
      `insert into sync_runs(source,status,mode,records_written,error,finished_at)
       values($1,$2,$3,$4,$5,now())`,
      [run.source, run.status, run.mode, run.recordsWritten, run.error ?? null]
    );
  }
}
