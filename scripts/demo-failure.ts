import type { NormalizedRecord, SourceName, SyncRepository, SyncRunResult } from "../src/domain/types.js";
import { DemoAdapter } from "../src/adapters/demo.js";
import { SyncOrchestrator } from "../src/sync/orchestrator.js";

class DemoRepository implements SyncRepository {
  cursors = new Map<SourceName, string | null>([["google_calendar", "expired-token"]]);
  records = new Map<string, NormalizedRecord>();
  async getSyncState(source: SourceName) { return { cursor: this.cursors.get(source) ?? null }; }
  async savePage(source: SourceName, records: NormalizedRecord[], cursor: string | null | undefined) {
    records.forEach((r) => this.records.set(`${r.source}:${r.externalId}`, r));
    if (cursor !== undefined) this.cursors.set(source, cursor);
  }
  async recordRun(_run: SyncRunResult) {}
}

const repo = new DemoRepository();
const sync = new SyncOrchestrator(repo);
const results = await sync.syncAll([
  new DemoAdapter("hubspot"), new DemoAdapter("stripe", "down"), new DemoAdapter("google_calendar", "stale-once")
]);
console.table(results);
console.log(`Rows landed: ${repo.records.size} (expected 2; Stripe fails independently, Calendar backfills)`);
