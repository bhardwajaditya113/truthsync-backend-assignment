import Stripe from "stripe";
import type { FetchPage, SourceAdapter } from "../domain/types.js";
import { StaleCursorError } from "../domain/types.js";

export class StripeAdapter implements SourceAdapter {
  readonly name = "stripe" as const;
  private readonly stripe: Stripe;
  constructor(secretKey: string, client?: Stripe) { this.stripe = client ?? new Stripe(secretKey); }

  async fetchIncremental(cursor: string): Promise<FetchPage> {
    let parsed: { created: number; upper?: number; startingAfter?: string };
    try { parsed = JSON.parse(cursor); } catch { throw new StaleCursorError("Invalid Stripe cursor"); }
    if (!Number.isInteger(parsed.created) || parsed.created < 0) throw new StaleCursorError("Invalid Stripe cursor timestamp");
    const upper = parsed.upper ?? Math.floor(Date.now() / 1000);
    return this.fetch(
      { created: { gte: parsed.created, lt: upper }, starting_after: parsed.startingAfter },
      { created: parsed.created, upper }
    );
  }

  async fetchFull(cursor?: string): Promise<FetchPage> {
    const parsed = cursor ? JSON.parse(cursor) as { upper?: number; startingAfter?: string } : {};
    const upper = parsed.upper ?? Math.floor(Date.now() / 1000);
    return this.fetch({ created: { lt: upper }, starting_after: parsed.startingAfter }, { upper });
  }

  private async fetch(
    params: { created?: Stripe.RangeQueryParam; starting_after?: string },
    bounds: { created?: number; upper: number }
  ): Promise<FetchPage> {
    const page = await this.stripe.charges.list({ limit: 100, ...params });
    const last = page.data.at(-1)?.id;
    return {
      records: page.data.map((charge) => ({
        source: this.name, externalId: charge.id, kind: "transaction", occurredAt: new Date(charge.created * 1000), updatedAt: new Date(charge.created * 1000),
        amountMinor: Math.max(0, charge.amount_captured - charge.amount_refunded), currency: charge.currency,
        sourceStatus: charge.refunded ? "refunded" : charge.status,
        email: charge.billing_details.email ?? charge.receipt_email ?? undefined,
        metadata: { description: charge.description, livemode: charge.livemode, amountRefunded: charge.amount_refunded }
      })),
      nextCursor: page.has_more && last
        ? JSON.stringify({ ...bounds, startingAfter: last })
        : JSON.stringify({ created: bounds.upper }),
      hasMore: page.has_more
    };
  }
}
