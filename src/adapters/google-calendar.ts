import { z } from "zod";
import type { FetchPage, SourceAdapter } from "../domain/types.js";
import { StaleCursorError } from "../domain/types.js";
import { getGoogleAccessToken, type GoogleCredentials } from "./google-auth.js";
import { fetchProvider } from "./http.js";

const eventSchema = z.object({
  id: z.string(), summary: z.string().nullish(), status: z.string().nullish(),
  created: z.string().nullish(), updated: z.string().nullish(), htmlLink: z.string().nullish(),
  start: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
  end: z.unknown().optional()
});
const eventsSchema = z.object({
  items: z.array(eventSchema).default([]), nextPageToken: z.string().optional(), nextSyncToken: z.string().optional()
});

export class GoogleCalendarAdapter implements SourceAdapter {
  readonly name = "google_calendar" as const;
  constructor(private readonly credentials: GoogleCredentials, private readonly calendarId: string) {}

  async fetchIncremental(cursor: string): Promise<FetchPage> {
    let parsed: { syncToken: string; pageToken?: string };
    try { parsed = JSON.parse(cursor); } catch { throw new StaleCursorError("Invalid Google Calendar cursor"); }
    if (!parsed.syncToken) throw new StaleCursorError("Invalid Google Calendar sync token");
    const params = new URLSearchParams({ syncToken: parsed.syncToken, showDeleted: "true", singleEvents: "true" });
    if (parsed.pageToken) params.set("pageToken", parsed.pageToken);
    return this.request(params, parsed.syncToken);
  }

  async fetchFull(cursor?: string): Promise<FetchPage> {
    const parsed = cursor ? JSON.parse(cursor) as { pageToken?: string } : {};
    const params = new URLSearchParams({ showDeleted: "true", singleEvents: "true" });
    if (parsed.pageToken) params.set("pageToken", parsed.pageToken);
    return this.request(params);
  }

  private async request(params: URLSearchParams, syncToken?: string): Promise<FetchPage> {
    const accessToken = await getGoogleAccessToken(this.credentials);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events?${params}`;
    const response = await fetchProvider(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (response.status === 410) throw new StaleCursorError("Google Calendar sync token expired");
    if (!response.ok) throw new Error(`Google Calendar request failed (${response.status})`);
    return this.toPage(await response.json(), syncToken);
  }

  private toPage(raw: unknown, syncToken?: string): FetchPage {
    const data = eventsSchema.parse(raw);
    const token = data.nextSyncToken ?? syncToken;
    if (!token && !data.nextPageToken) throw new Error("Google Calendar omitted next sync token");
    return {
      records: data.items.map((e) => {
        const sourceUpdatedAt = new Date(e.updated ?? e.created ?? Date.now());
        return {
        source: this.name, externalId: e.id, kind: "event", name: e.summary ?? undefined,
        occurredAt: e.start?.dateTime ? new Date(e.start.dateTime)
          : e.start?.date ? new Date(`${e.start.date}T00:00:00Z`) : sourceUpdatedAt,
        updatedAt: sourceUpdatedAt, sourceStatus: e.status ?? undefined,
        metadata: { htmlLink: e.htmlLink, end: e.end, deleted: e.status === "cancelled" }
      }}),
      nextCursor: data.nextPageToken
        ? JSON.stringify({ ...(token ? { syncToken: token } : {}), pageToken: data.nextPageToken })
        : JSON.stringify({ syncToken: token }),
      hasMore: Boolean(data.nextPageToken)
    };
  }
}
