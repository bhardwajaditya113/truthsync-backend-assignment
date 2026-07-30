import { afterEach, describe, expect, it, vi } from "vitest";
import { HubSpotAdapter } from "../src/adapters/hubspot.js";
import { GoogleCalendarAdapter } from "../src/adapters/google-calendar.js";
import { StripeAdapter } from "../src/adapters/stripe.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("adapter cursor safety", () => {
  it("keeps the HubSpot full-sync high-water fixed across pages", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [], paging: { next: { after: "100" } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const adapter = new HubSpotAdapter("test");
    const first = await adapter.fetchFull();
    const firstCursor = JSON.parse(first.nextCursor!);
    vi.setSystemTime(new Date("2025-01-02T00:00:00Z"));
    const contactsLast = await adapter.fetchFull(first.nextCursor!);
    const last = await adapter.fetchFull(contactsLast.nextCursor!);
    expect(JSON.parse(last.nextCursor!)).toEqual({ since: firstCursor.highWater });
    expect(fetchMock.mock.calls[1]?.[0].toString()).toContain("after=100");
    expect(fetchMock.mock.calls[2]?.[0].toString()).toContain("objects/deals");
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
    vi.setSystemTime(new Date("2025-01-02T00:00:00Z"));
    const last = await adapter.fetchFull(first.nextCursor!);
    expect((list.mock.calls[0]?.[0] as { created: { lt: number } }).created.lt).toBe(fixedUpper);
    expect((list.mock.calls[1]?.[0] as { created: { lt: number } }).created.lt).toBe(fixedUpper);
    expect(JSON.parse(last.nextCursor!)).toEqual({ created: fixedUpper });
  });

  it("uses matching Google Calendar parameters for full and incremental sync", async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input.toString();
      if (url.includes("oauth2.googleapis.com")) return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
      urls.push(url);
      return new Response(JSON.stringify({ items: [], nextSyncToken: "sync-1" }), { status: 200 });
    });
    const adapter = new GoogleCalendarAdapter("id", "secret", "refresh", "primary");
    const full = await adapter.fetchFull();
    await adapter.fetchIncremental(full.nextCursor!);
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.includes("singleEvents=true") && url.includes("showDeleted=true"))).toBe(true);
    expect(urls.every((url) => !url.includes("timeMin"))).toBe(true);
    expect(urls[1]).toContain("syncToken=sync-1");
  });
});
