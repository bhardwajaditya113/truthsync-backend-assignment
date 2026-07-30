import type { Pool } from "pg";

export type Bucket = "day" | "week";
export interface RevenueRow { period: Date; currency: string; amount_minor: string; }

export class RevenueService {
  constructor(private readonly db: Pool) {}

  async breakdown(from: Date, to: Date, bucket: Bucket): Promise<RevenueRow[]> {
    const result = await this.db.query<RevenueRow>(
      "select period, currency, amount_minor from revenue_by_period($1,$2,$3)", [from, to, bucket]
    );
    return result.rows;
  }

  async summary(from: Date, to: Date): Promise<Array<{ currency: string; amountMinor: string }>> {
    // Deliberately aggregates the canonical function; no second revenue predicate exists.
    const result = await this.db.query<{ currency: string; amount_minor: string }>(
      `select currency, coalesce(sum(amount_minor),0)::bigint::text as amount_minor
       from revenue_by_period($1,$2,'day') group by currency order by currency`, [from, to]
    );
    return result.rows.map((row) => ({ currency: row.currency, amountMinor: row.amount_minor }));
  }
}
