import type { FetchPage, SourceAdapter, SyncRepository, SyncRunResult } from "../domain/types.js";
import { StaleCursorError } from "../domain/types.js";

export class SyncOrchestrator {
  constructor(private readonly repository: SyncRepository, private readonly requestTimeoutMs = 30_000) {}

  async syncAll(adapters: SourceAdapter[]): Promise<SyncRunResult[]> {
    return Promise.all(adapters.map((adapter) => this.syncOne(adapter)));
  }

  async syncOne(adapter: SourceAdapter): Promise<SyncRunResult> {
    let mode: "incremental" | "full" = "full";
    let written = 0;
    try {
      const state = await this.repository.getSyncState(adapter.name);
      mode = state.cursor ? "incremental" : "full";
      let cursor = state.cursor;

      while (true) {
        let page;
        try {
          page = await this.withTimeout(() => mode === "incremental" && cursor
            ? adapter.fetchIncremental(cursor)
            : adapter.fetchFull(cursor ?? undefined), adapter.name);
        } catch (error) {
          if (mode !== "incremental" || !(error instanceof StaleCursorError)) throw error;
          mode = "full";
          cursor = null;
          written = 0;
          continue;
        }

        // Intermediate provider page tokens are not durable sync cursors. If the
        // process dies mid-run, preserve the prior completed cursor and replay.
        await this.repository.savePage(adapter.name, page.records, page.hasMore ? undefined : page.nextCursor);
        written += page.records.length;
        cursor = page.nextCursor;
        if (!page.hasMore) break;
        if (!cursor) throw new Error(`${adapter.name} returned hasMore without a cursor`);
      }

      const result: SyncRunResult = { source: adapter.name, status: "succeeded", mode, recordsWritten: written };
      await this.recordRunSafely(result);
      return result;
    } catch (error) {
      const result: SyncRunResult = {
        source: adapter.name,
        status: "failed",
        mode,
        recordsWritten: written,
        error: error instanceof Error ? error.message : "Unknown error"
      };
      await this.recordRunSafely(result);
      return result;
    }
  }

  private async recordRunSafely(result: SyncRunResult): Promise<void> {
    try {
      await this.repository.recordRun(result);
    } catch {
      // Observability must never turn one source result into a rejected syncAll.
    }
  }

  private async withTimeout(operation: () => Promise<FetchPage>, source: string): Promise<FetchPage> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(
            `${source} request timed out after ${this.requestTimeoutMs}ms`
          )), this.requestTimeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
