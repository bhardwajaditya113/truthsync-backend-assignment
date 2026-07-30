import { z } from "zod";
import type { FetchPage, NormalizedRecord, SourceAdapter } from "../domain/types.js";
import { StaleCursorError } from "../domain/types.js";

const contactSchema = z.object({
  id: z.string(), properties: z.object({
    email: z.string().nullish(), firstname: z.string().nullish(), lastname: z.string().nullish(),
    createdate: z.string(), lastmodifieddate: z.string()
  })
});
const dealSchema = z.object({
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
type WorkingCursor = { since?: string; highWater?: string; object?: ObjectName; after?: string };

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
    const definition = definitions[object];
    const response = await fetch(`https://api.hubapi.com/crm/v3/objects/${object}/search`, {
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
    return this.toPage(await response.json(), object, { since: parsed.since, highWater });
  }

  async fetchFull(cursor?: string): Promise<FetchPage> {
    let parsed: WorkingCursor = {};
    try { if (cursor) parsed = JSON.parse(cursor); } catch { throw new Error("Invalid HubSpot full-sync page cursor"); }
    const object = parsed.object ?? "contacts";
    const highWater = parsed.highWater ?? new Date().toISOString();
    const url = new URL(`https://api.hubapi.com/crm/v3/objects/${object}`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("properties", definitions[object].properties.join(","));
    if (parsed.after) url.searchParams.set("after", parsed.after);
    const response = await fetch(url, { headers: { authorization: `Bearer ${this.token}` } });
    if (!response.ok) throw new Error(`HubSpot request failed (${response.status})`);
    return this.toPage(await response.json(), object, { highWater });
  }

  private toPage(raw: unknown, object: ObjectName, bounds: { since?: string; highWater: string }): FetchPage {
    const page = pageSchema.parse(raw);
    const records = object === "contacts"
      ? page.results.map((value) => this.normalizeContact(contactSchema.parse(value)))
      : page.results.map((value) => this.normalizeDeal(dealSchema.parse(value)));
    const after = page.paging?.next.after;
    if (after) {
      return { records, nextCursor: JSON.stringify({ ...bounds, object, after }), hasMore: true };
    }
    if (object === "contacts") {
      return { records, nextCursor: JSON.stringify({ ...bounds, object: "deals" }), hasMore: true };
    }
    return { records, nextCursor: JSON.stringify({ since: bounds.highWater }), hasMore: false };
  }

  private normalizeContact(contact: z.infer<typeof contactSchema>): NormalizedRecord {
    return {
      source: this.name, externalId: `contact:${contact.id}`, kind: "contact",
      name: [contact.properties.firstname, contact.properties.lastname].filter(Boolean).join(" ") || undefined,
      email: contact.properties.email ?? undefined, occurredAt: new Date(contact.properties.createdate),
      updatedAt: new Date(contact.properties.lastmodifieddate), metadata: { objectType: "contact" }
    };
  }

  private normalizeDeal(deal: z.infer<typeof dealSchema>): NormalizedRecord {
    const amountMajor = deal.properties.amount == null ? undefined : Number(deal.properties.amount);
    if (amountMajor !== undefined && (!Number.isFinite(amountMajor) || amountMajor < 0)) {
      throw new Error(`HubSpot deal ${deal.id} has invalid amount`);
    }
    return {
      source: this.name, externalId: `deal:${deal.id}`, kind: "transaction", name: deal.properties.dealname ?? undefined,
      occurredAt: new Date(deal.properties.closedate ?? deal.properties.createdate),
      updatedAt: new Date(deal.properties.hs_lastmodifieddate),
      amountMinor: amountMajor === undefined ? undefined : Math.round(amountMajor * 100),
      currency: (deal.properties.deal_currency_code ?? this.defaultCurrency).toLowerCase(),
      sourceStatus: deal.properties.dealstage ?? undefined, metadata: { objectType: "deal" }
    };
  }
}
