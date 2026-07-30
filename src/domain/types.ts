export const sourceNames = ["hubspot", "stripe", "google_calendar"] as const;
export type SourceName = (typeof sourceNames)[number];
export type RecordKind = "contact" | "transaction" | "event";

export interface NormalizedRecord {
  source: SourceName;
  externalId: string;
  kind: RecordKind;
  occurredAt: Date;
  updatedAt: Date;
  name?: string;
  email?: string;
  amountMinor?: number;
  currency?: string;
  sourceStatus?: string;
  metadata: Record<string, unknown>;
}

export interface FetchPage {
  records: NormalizedRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface SourceAdapter {
  readonly name: SourceName;
  fetchIncremental(cursor: string): Promise<FetchPage>;
  fetchFull(cursor?: string): Promise<FetchPage>;
}

export class StaleCursorError extends Error {
  constructor(message = "Incremental cursor is stale") {
    super(message);
    this.name = "StaleCursorError";
  }
}

export interface SyncState {
  cursor: string | null;
}

export interface SyncRepository {
  getSyncState(source: SourceName): Promise<SyncState>;
  savePage(source: SourceName, records: NormalizedRecord[], completedRunCursor: string | null | undefined): Promise<void>;
  recordRun(input: SyncRunResult): Promise<void>;
}

export interface SyncRunResult {
  source: SourceName;
  status: "succeeded" | "failed";
  mode: "incremental" | "full";
  recordsWritten: number;
  error?: string;
}
