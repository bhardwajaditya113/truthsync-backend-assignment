import type { FetchPage, NormalizedRecord, SourceAdapter, SourceName } from "../domain/types.js";
import { StaleCursorError } from "../domain/types.js";

const now = new Date("2025-01-15T12:00:00Z");
const record = (source: SourceName, id: string): NormalizedRecord => ({
  source, externalId: id, kind: source === "stripe" ? "transaction" : source === "hubspot" ? "contact" : "event",
  occurredAt: now, updatedAt: now, name: `${source} sample`,
  amountMinor: source === "stripe" ? 12500 : undefined, currency: source === "stripe" ? "usd" : undefined,
  sourceStatus: source === "stripe" ? "succeeded" : undefined, metadata: { demo: true }
});

export class DemoAdapter implements SourceAdapter {
  private incrementalCalls = 0;
  constructor(readonly name: SourceName, private readonly behavior: "ok" | "stale-once" | "down" = "ok") {}
  async fetchIncremental(_cursor: string): Promise<FetchPage> {
    this.incrementalCalls++;
    if (this.behavior === "stale-once" && this.incrementalCalls === 1) throw new StaleCursorError("Simulated 410 expired cursor");
    if (this.behavior === "down") throw new Error("Simulated upstream outage");
    return this.page();
  }
  async fetchFull(): Promise<FetchPage> {
    if (this.behavior === "down") throw new Error("Simulated upstream outage");
    return this.page();
  }
  private page(): FetchPage { return { records: [record(this.name, `${this.name}-001`)], nextCursor: JSON.stringify({ at: now.toISOString() }), hasMore: false }; }
}
