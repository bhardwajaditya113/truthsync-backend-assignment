import { afterEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { Config } from "../src/config.js";
import { buildApp } from "../src/app.js";

const config = {
  NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://unused", SYNC_ADMIN_TOKEN: "test-token",
  DEMO_MODE: true, GOOGLE_CALENDAR_ID: "primary", HUBSPOT_CURRENCY: "usd"
} as Config;

describe("metrics API", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("parses and serves the summary range without schema composition errors", async () => {
    const db = { query: async () => ({ rows: [{ currency: "usd", amount_minor: "20000" }] }) } as unknown as Pool;
    app = await buildApp(config, db, []);
    const response = await app.inject({
      method: "GET", url: "/metrics/revenue/summary?from=2025-01-01T00:00:00Z&to=2025-02-01T00:00:00Z"
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().totals).toEqual([{ currency: "usd", amountMinor: "20000" }]);
  });
});
