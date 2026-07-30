import { z } from "zod";
import type { FetchPage, NormalizedRecord, SourceAdapter } from "../domain/types.js";
import { StaleCursorError } from "../domain/types.js";
import { fetchProvider } from "./http.js";

const contactSchema = z.object({
  archived: z.boolean().optional(), archivedAt: z.string().nullish(),
  id: z.string(), properties: z.object({
    email: z.string().nullish(), firstname: z.string().nullish(), lastname: z.string().nullish(),
    createdate: z.string(), lastmodifieddate: z.string()
  })
});
const dealSchema = z.object({
  archived: z.boolean().optional(), archivedAt: z.string().nullish(),
  id: z.string(), properties: z.object({
    dealname: z.string().nullish(), amount: z.string().nullish(), dealstage: z.string().nullish(),
    deal_currency_code: z.string().nullish(), closedate: z.string().nullish(), createdate: z.string(),
    hs_lastmodifieddate: z.string()
  })
});
const pageSchema = z.object({
  results: z.array(z.unknown()), paging: z.object({ next: z.object({ after: z.string() }) }).optional()
});
type ObjectName = "contacts" | "deals";
type WorkingCursor = { since?: string; highWater?: string; object?: ObjectName; after?: string; archived?: boolean };

const definitions = {
  contacts: {
    properties: ["email", "firstname", "lastname", "createdate", "lastmodifieddate"],
    modifiedProperty: "lastmodifieddate"
  },
  deals: {
    properties: ["dealname", "amount", "dealstage", "deal_currency_code", "closedate", "createdate", "hs_lastmodifieddate"],
    modifiedProperty: "hs_lastmodifieddate"
  }
} as const;

export function currencyAmountToMinor(value: string, currency: string): number {
  const code = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error(`Invalid currency code: ${currency}`);
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error(`Invalid non-negative currency amount: ${value}`);
  const whole = match[1];
  if (!whole) throw new Error(`Invalid non-negative currency amount: ${value}`);
  const exponent = new Intl.NumberFormat("en-US", { style: "currency", currency: code })
    .resolvedOptions().maximumFractionDigits;
  if (exponent === undefined) throw new Error(`Currency exponent is unavailable for ${code}`);
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (fraction.length > exponent) throw new Error(`${code} amount has more than ${exponent} fractional digits`);
  const scale = 10n ** BigInt(exponent);
  const minor = BigInt(whole) * scale + BigInt(fraction.padEnd(exponent, "0") || "0");
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Currency amount exceeds safe integer range");
  return Number(minor);
}

export class HubSpotAdapter implements SourceAdapter {
  readonly name = "hubspot" as const;
  constructor(private readonly token: string, private readonly defaultCurrency = "usd",
    private readonly overlapMs = 120_000) {}

  async fetchIncremental(cursor: string): Promise<FetchPage> {
    let parsed: WorkingCursor;
    try { parsed = JSON.parse(cursor); } catch { throw new StaleCursorError("Invalid HubSpot cursor"); }
    if (!parsed.since) throw new StaleCursorError("Invalid HubSpot high-water cursor");
    const sinceMs = Date.parse(parsed.since);
    if (!Number.isFinite(sinceMs)) throw new StaleCursorError("Invalid HubSpot high-water timestamp");
    const overlapSince = new Date(Math.max(0, sinceMs - this.overlapMs)).toISOString();
    const object = parsed.object ?? "contacts";
    const highWater = parsed.highWater ?? new Date().toISOString();
    if (parsed.archived) return this.fetchList(object, parsed, { since: parsed.since, highWater }, true);
    const definition = definitions[object];
    const response = await fetchProvider(`https://api.hubapi.com/crm/v3/objects/${object}/search`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        filterGroups: [{ filters: [
          { propertyName: definition.modifiedProperty, operator: "GTE", value: overlapSince },
          { propertyName: definition.modifiedProperty, operator: "LT", value: highWater }
        ] }],
        sorts: [definition.modifiedProperty], after: parsed.after, limit: 100,
        properties: definition.properties
      })
    });
    if (response.status === 400 || response.status === 410) throw new StaleCursorError(`HubSpot rejected cursor (${response.status})`);
    if (!response.ok) throw new Error(`HubSpot request failed (${response.status})`);
    return this.toPage(await response.json(), object, { since: parsed.since, highWater }, false);
  }

  async fetchFull(cursor?: string): Promise<FetchPage> {
    let parsed: WorkingCursor = {};
    try { if (cursor) parsed = JSON.parse(cursor); } catch { throw new Error("Invalid HubSpot full-sync page cursor"); }
    const object = parsed.object ?? "contacts";
    const highWater = parsed.highWater ?? new Date().toISOString();
    return this.fetchList(object, parsed, { highWater }, Boolean(parsed.archived));
  }

  private async fetchList(object: ObjectName, parsed: WorkingCursor,
    bounds: { since?: string; highWater: string }, archived: boolean): Promise<FetchPage> {
    const url = new URL(`https://api.hubapi.com/crm/v3/objects/${object}`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("properties", definitions[object].properties.join(","));
    if (archived) url.searchParams.set("archived", "true");
    if (parsed.after) url.searchParams.set("after", parsed.after);
    const response = await fetchProvider(url, { headers: { authorization: `Bearer ${this.token}` } });
    if (!response.ok) throw new Error(`HubSpot request failed (${response.status})`);
    return this.toPage(await response.json(), object, bounds, archived);
  }

  private toPage(raw: unknown, object: ObjectName, bounds: { since?: string; highWater: string }, archived: boolean): FetchPage {
    const page = pageSchema.parse(raw);
    const records = object === "contacts"
      ? page.results.map((value) => this.normalizeContact(contactSchema.parse(value)))
      : page.results.map((value) => this.normalizeDeal(dealSchema.parse(value)));
    const after = page.paging?.next.after;
    if (after) {
      return { records, nextCursor: JSON.stringify({ ...bounds, object, after, ...(archived ? { archived: true } : {}) }), hasMore: true };
    }
    if (object === "contacts") {
      return { records, nextCursor: JSON.stringify({ ...bounds, object: "deals", ...(archived ? { archived: true } : {}) }), hasMore: true };
    }
    if (!archived) {
      return { records, nextCursor: JSON.stringify({ ...bounds, object: "contacts", archived: true }), hasMore: true };
    }
    return { records, nextCursor: JSON.stringify({ since: bounds.highWater }), hasMore: false };
  }

  private normalizeContact(contact: z.infer<typeof contactSchema>): NormalizedRecord {
    return {
      source: this.name, externalId: `contact:${contact.id}`, kind: "contact",
      name: [contact.properties.firstname, contact.properties.lastname].filter(Boolean).join(" ") || undefined,
      email: contact.properties.email ?? undefined, occurredAt: new Date(contact.properties.createdate),
      updatedAt: new Date(contact.archivedAt ?? contact.properties.lastmodifieddate),
      sourceStatus: contact.archived ? "archived" : undefined,
      metadata: { objectType: "contact", archived: Boolean(contact.archived) }
    };
  }

  private normalizeDeal(deal: z.infer<typeof dealSchema>): NormalizedRecord {
    const currency = (deal.properties.deal_currency_code?.trim() || this.defaultCurrency).toLowerCase();
    let amountMinor: number | undefined;
    try { amountMinor = deal.properties.amount == null ? undefined : currencyAmountToMinor(deal.properties.amount, currency); }
    catch (error) { throw new Error(`HubSpot deal ${deal.id} has invalid amount: ${error instanceof Error ? error.message : "unknown error"}`); }
    return {
      source: this.name, externalId: `deal:${deal.id}`, kind: "transaction", name: deal.properties.dealname ?? undefined,
      occurredAt: new Date(deal.properties.closedate ?? deal.properties.createdate),
      updatedAt: new Date(deal.archivedAt ?? deal.properties.hs_lastmodifieddate), amountMinor, currency,
      sourceStatus: deal.archived ? "archived" : deal.properties.dealstage ?? undefined,
      metadata: { objectType: "deal", archived: Boolean(deal.archived) }
    };
  }
}
