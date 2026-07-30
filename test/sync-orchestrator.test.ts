import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedRecord, SourceName, SyncRepository, SyncRunResult } from "../src/domain/types.js";
import { DemoAdapter } from "../src/adapters/demo.js";
import { SyncOrchestrator } from "../src/sync/orchestrator.js";
import type { FetchPage, SourceAdapter } from "../src/domain/types.js";

class MemoryRepository implements SyncRepository {
  cursors = new Map<SourceName, string | null>();
  records = new Map<string, NormalizedRecord>();
  runs: SyncRunResult[] = [];
  async getSyncState(source: SourceName) { return { cursor: this.cursors.get(source) ?? null }; }
  async savePage(source: SourceName, records: NormalizedRecord[], cursor: string | null | undefined) {
    for (const record of records) this.records.set(`${record.source}:${record.externalId}`, record);
    if (cursor !== undefined) this.cursors.set(source, cursor);
  }
  async recordRun(run: SyncRunResult) { this.runs.push(run); }
}

afterEach(() => vi.useRealTimers());

describe("SyncOrchestrator", () => {
  it("is idempotent across repeated runs", async () => {
    const repo = new MemoryRepository();
    const orchestrator = new SyncOrchestrator(repo);
    await orchestrator.syncOne(new DemoAdapter("stripe"));
    await orchestrator.syncOne(new DemoAdapter("stripe"));
    expect(repo.records.size).toBe(1);
  });

  it("falls back to a full sync after a stale cursor", async () => {
    const repo = new MemoryRepository();
    repo.cursors.set("google_calendar", "expired");
    const result = await new SyncOrchestrator(repo).syncOne(new DemoAdapter("google_calendar", "stale-once"));
    expect(result).toMatchObject({ status: "succeeded", mode: "full", recordsWritten: 1 });
  });

  it("isolates source failures", async () => {
    const repo = new MemoryRepository();
    const results = await new SyncOrchestrator(repo).syncAll([
      new DemoAdapter("hubspot"), new DemoAdapter("stripe", "down"), new DemoAdapter("google_calendar")
    ]);
    expect(results.map((r) => r.status)).toEqual(["succeeded", "failed", "succeeded"]);
    expect(repo.records.size).toBe(2);
  });

  it("does not publish an intermediate page token as a completed cursor", async () => {
    const repo = new MemoryRepository();
    const seenAtSave: Array<string | null> = [];
    const original = repo.savePage.bind(repo);
    repo.savePage = async (source, records, cursor) => {
      await original(source, records, cursor);
      seenAtSave.push(repo.cursors.get(source) ?? null);
    };
    let call = 0;
    const adapter: SourceAdapter = {
      name: "stripe",
      fetchIncremental: async () => { throw new Error("not used"); },
      fetchFull: async (): Promise<FetchPage> => {
        call++;
        return call === 1
          ? { records: [], nextCursor: "page-token", hasMore: true }
          : { records: [], nextCursor: "durable-sync-cursor", hasMore: false };
      }
    };
    await new SyncOrchestrator(repo).syncOne(adapter);
    expect(seenAtSave).toEqual([null, "durable-sync-cursor"]);
  });

  it("bounds a hanging source so the run returns a failure", async () => {
    vi.useFakeTimers();
    const repo = new MemoryRepository();
    const adapter: SourceAdapter = {
      name: "stripe",
      fetchIncremental: async () => new Promise<FetchPage>(() => undefined),
      fetchFull: async () => new Promise<FetchPage>(() => undefined)
    };
    const pending = new SyncOrchestrator(repo, 100).syncOne(adapter);
    await vi.advanceTimersByTimeAsync(101);
    await expect(pending).resolves.toMatchObject({
      source: "stripe", status: "failed", error: "stripe request timed out after 100ms"
    });
  });
});
