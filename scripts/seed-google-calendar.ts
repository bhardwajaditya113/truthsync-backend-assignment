import "dotenv/config";
import { config } from "../src/config.js";
import { getGoogleCredentials } from "../src/adapters/factory.js";
import { getGoogleAccessToken } from "../src/adapters/google-auth.js";

const credentials = getGoogleCredentials(config);
if (!credentials) throw new Error("Google credentials are required");
if (!config.GOOGLE_CALENDAR_ID || config.GOOGLE_CALENDAR_ID === "primary") {
  throw new Error("Set GOOGLE_CALENDAR_ID to the dedicated calendar ID shared with the service account");
}
const token = await getGoogleAccessToken(credentials, "https://www.googleapis.com/auth/calendar.events");
const root = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.GOOGLE_CALENDAR_ID)}/events`;
const definitions = [
  { key: "discovery", summary: "TruthSync customer discovery", start: "2026-07-28T10:00:00+05:30", end: "2026-07-28T10:30:00+05:30" },
  { key: "invoice-review", summary: "TruthSync invoice review", start: "2026-07-29T15:00:00+05:30", end: "2026-07-29T15:45:00+05:30" },
  { key: "pipeline-demo", summary: "TruthSync sync demo", start: "2026-07-30T18:00:00+05:30", end: "2026-07-30T18:30:00+05:30" }
];
const createdOrFound = [];
for (const definition of definitions) {
  const query = new URLSearchParams({ privateExtendedProperty: `truthsyncSeedKey=${definition.key}`, maxResults: "1" });
  const list = await fetch(`${root}?${query}`, { headers: { authorization: `Bearer ${token}` } });
  if (!list.ok) throw new Error(`Google Calendar list failed (${list.status})`);
  const existing = await list.json() as { items?: Array<{ id: string }> };
  let id = existing.items?.[0]?.id;
  if (!id) {
    const create = await fetch(root, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ summary: definition.summary,
        start: { dateTime: definition.start, timeZone: "Asia/Kolkata" },
        end: { dateTime: definition.end, timeZone: "Asia/Kolkata" },
        extendedProperties: { private: { truthsyncSeedKey: definition.key } } }) });
    if (!create.ok) throw new Error(`Google Calendar create failed (${create.status}): ${await create.text()}`);
    id = ((await create.json()) as { id: string }).id;
  }
  createdOrFound.push(id);
}
console.log(JSON.stringify({ events: createdOrFound, note: "Seed is idempotent by private extended property" }, null, 2));
