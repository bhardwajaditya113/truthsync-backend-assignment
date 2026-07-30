import Stripe from "stripe";
import type { FetchPage, SourceAdapter } from "../domain/types.js";
import { StaleCursorError } from "../domain/types.js";

export class StripeAdapter implements SourceAdapter {
  readonly name = "stripe" as const;
  private readonly stripe: Stripe;
  constructor(secretKey: string, client?: Stripe) {
    this.stripe = client ?? new Stripe(secretKey, { timeout: 25_000, maxNetworkRetries: 1 });
  }

  async fetchIncremental(cursor: string): Promise<FetchPage> {
    let parsed: { created: number; upper?: number; startingAfter?: string };
    try { parsed = JSON.parse(cursor); } catch { throw new StaleCursorError("Invalid Stripe cursor"); }
    if (!Number.isInteger(parsed.created) || parsed.created < 0) throw new StaleCursorError("Invalid Stripe cursor timestamp");
    const now = Math.floor(Date.now() / 1000);
    // Stripe's Events API retains only a rolling window. A full charge snapshot is
    // safer than pretending an older event cursor can still describe every change.
    if (parsed.created < now - 29 * 24 * 60 * 60 || parsed.created > now + 60) {
      throw new StaleCursorError("Stripe event cursor is outside the safe retention window");
    }
    const upper = parsed.upper ?? now;
    if (upper <= parsed.created) {
      return { records: [], nextCursor: JSON.stringify({ created: parsed.created }), hasMore: false };
    }
    const page = await this.stripe.events.list({
      limit: 100, created: { gte: parsed.created, lt: upper }, starting_after: parsed.startingAfter
    });
    const last = page.data.at(-1)?.id;
    return {
      records: page.data.flatMap((event) => {
        const object = event.data.object;
        return object.object === "charge"
          ? [this.normalizeCharge(object as Stripe.Charge, new Date(event.created * 1000))]
          : [];
      }),
      nextCursor: page.has_more && last
        ? JSON.stringify({ created: parsed.created, upper, startingAfter: last })
        : JSON.stringify({ created: upper }),
      hasMore: page.has_more
    };
  }

  async fetchFull(cursor?: string): Promise<FetchPage> {
    const parsed = cursor ? JSON.parse(cursor) as { upper?: number; startingAfter?: string } : {};
    const upper = parsed.upper ?? Math.floor(Date.now() / 1000);
    return this.fetchFullPage({ created: { lt: upper }, starting_after: parsed.startingAfter }, upper);
  }

  private async fetchFullPage(
    params: { created?: Stripe.RangeQueryParam; starting_after?: string }, upper: number
  ): Promise<FetchPage> {
    const page = await this.stripe.charges.list({ limit: 100, ...params });
    const last = page.data.at(-1)?.id;
    return {
      // The snapshot high-water is the version of a full backfill. This lets a
      // stale-cursor recovery replace an older event-derived row safely.
      records: page.data.map((charge) => this.normalizeCharge(charge, new Date(upper * 1000 - 1))),
      nextCursor: page.has_more && last
        ? JSON.stringify({ upper, startingAfter: last })
        : JSON.stringify({ created: upper }),
      hasMore: page.has_more
    };
  }

  private normalizeCharge(charge: Stripe.Charge, updatedAt: Date) {
    return {
      source: this.name, externalId: charge.id, kind: "transaction" as const,
      occurredAt: new Date(charge.created * 1000), updatedAt,
      amountMinor: Math.max(0, charge.amount_captured - charge.amount_refunded), currency: charge.currency,
      sourceStatus: charge.refunded ? "refunded" : charge.status,
      email: charge.billing_details.email ?? charge.receipt_email ?? undefined,
      metadata: { description: charge.description, livemode: charge.livemode, amountRefunded: charge.amount_refunded }
    };
  }
}
