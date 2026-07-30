import { afterEach, describe, expect, it, vi } from "vitest";
import { currencyAmountToMinor, HubSpotAdapter } from "../src/adapters/hubspot.js";
import { GoogleCalendarAdapter } from "../src/adapters/google-calendar.js";
import { StripeAdapter } from "../src/adapters/stripe.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("adapter cursor safety", () => {
  it("keeps the HubSpot full-sync high-water fixed across pages", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [], paging: { next: { after: "100" } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const adapter = new HubSpotAdapter("test");
    const first = await adapter.fetchFull();
    const firstCursor = JSON.parse(first.nextCursor!);
    vi.setSystemTime(new Date("2025-01-02T00:00:00Z"));
    const contactsLast = await adapter.fetchFull(first.nextCursor!);
    const dealsLast = await adapter.fetchFull(contactsLast.nextCursor!);
    const archivedContacts = await adapter.fetchFull(dealsLast.nextCursor!);
    const last = await adapter.fetchFull(archivedContacts.nextCursor!);
    expect(JSON.parse(last.nextCursor!)).toEqual({ since: firstCursor.highWater });
    expect(fetchMock.mock.calls[1]?.[0].toString()).toContain("after=100");
    expect(fetchMock.mock.calls[2]?.[0].toString()).toContain("objects/deals");
    expect(fetchMock.mock.calls[3]?.[0].toString()).toContain("archived=true");
    expect(fetchMock.mock.calls[4]?.[0].toString()).toContain("archived=true");
  });

  it("converts HubSpot currency strings without floating-point drift", () => {
    expect(currencyAmountToMinor("149.99", "usd")).toBe(14_999);
    expect(currencyAmountToMinor("123", "jpy")).toBe(123);
    expect(currencyAmountToMinor("1.234", "kwd")).toBe(1_234);
    expect(() => currencyAmountToMinor("1.001", "usd")).toThrow(/fractional digits/);
  });

  it("maps an archived HubSpot deal to a non-collected tombstone", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ results: [{
      id: "deal-1", archived: true, archivedAt: "2025-01-03T00:00:00Z", properties: {
        dealname: "Archived collected deal", amount: "10.00", dealstage: "closedwon",
        deal_currency_code: "USD", closedate: "2025-01-02T00:00:00Z",
        createdate: "2025-01-01T00:00:00Z", hs_lastmodifieddate: "2025-01-02T00:00:00Z"
      }
    }] }), { status: 200 }));
    const adapter = new HubSpotAdapter("test");
    const page = await adapter.fetchIncremental(JSON.stringify({ since: "2025-01-01T00:00:00Z",
      highWater: "2025-01-04T00:00:00Z", object: "deals", archived: true }));
    expect(page.records[0]).toMatchObject({ externalId: "deal:deal-1", sourceStatus: "archived",
      amountMinor: 1_000, metadata: { objectType: "deal", archived: true } });
    expect(page.hasMore).toBe(false);
  });

  it("keeps the Stripe upper bound fixed across full-sync pages", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    const list = vi.fn()
      .mockResolvedValueOnce({ data: [{ id: "ch_1", created: 1, amount_captured: 100, amount_refunded: 0,
        currency: "usd", refunded: false, status: "succeeded", billing_details: {}, receipt_email: null,
        description: null, livemode: false }], has_more: true })
      .mockResolvedValueOnce({ data: [], has_more: false });
    const adapter = new StripeAdapter("sk_test_x", { charges: { list } } as never);
    const first = await adapter.fetchFull();
    const fixedUpper = JSON.parse(first.nextCursor!).upper;
    expect(first.records[0]?.updatedAt.getTime()).toBe(fixedUpper * 1000 - 1);
    vi.setSystemTime(new Date("2025-01-02T00:00:00Z"));
    const last = await adapter.fetchFull(first.nextCursor!);
    expect((list.mock.calls[0]?.[0] as { created: { lt: number } }).created.lt).toBe(fixedUpper);
    expect((list.mock.calls[1]?.[0] as { created: { lt: number } }).created.lt).toBe(fixedUpper);
    expect(JSON.parse(last.nextCursor!)).toEqual({ created: fixedUpper });
  });

  it("uses Stripe events for incremental charge updates", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2025-01-02T00:00:00Z"));
    const events = { list: vi.fn().mockResolvedValue({
      data: [{ id: "evt_1", created: 1735775990, data: { object: {
        object: "charge", id: "ch_1", created: 1735689600, amount_captured: 100,
        amount_refunded: 100, currency: "usd", refunded: true, status: "succeeded",
        billing_details: {}, receipt_email: null, description: null, livemode: false
      } } }], has_more: false
    }) };
    const adapter = new StripeAdapter("sk_test_x", { events, charges: { list: vi.fn() } } as never);
    const page = await adapter.fetchIncremental(JSON.stringify({ created: 1735689600 }));
    expect(events.list).toHaveBeenCalledOnce();
    expect(page.records[0]).toMatchObject({ externalId: "ch_1", sourceStatus: "refunded", amountMinor: 0 });
    expect(page.records[0]?.updatedAt.toISOString()).toBe("2025-01-01T23:59:50.000Z");
  });

  it("rejects a Stripe event cursor older than the safe retention window", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2025-02-15T00:00:00Z"));
    const adapter = new StripeAdapter("sk_test_x", { events: { list: vi.fn() }, charges: { list: vi.fn() } } as never);
    await expect(adapter.fetchIncremental(JSON.stringify({ created: 1735689600 })))
      .rejects.toMatchObject({ name: "StaleCursorError" });
  });

  it("uses matching Google Calendar parameters for full and incremental sync", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      urls.push(url);
      return new Response(JSON.stringify({ items: [], nextSyncToken: "sync-1" }), { status: 200 });
    });
    const adapter = new GoogleCalendarAdapter(
      { kind: "oauth", clientId: "id", clientSecret: "secret", refreshToken: "refresh" }, "primary"
    );
    const full = await adapter.fetchFull();
    await adapter.fetchIncremental(full.nextCursor!);
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.includes("singleEvents=true") && url.includes("showDeleted=true"))).toBe(true);
    expect(urls.every((url) => !url.includes("timeMin"))).toBe(true);
    expect(urls[1]).toContain("syncToken=sync-1");
  });
});
