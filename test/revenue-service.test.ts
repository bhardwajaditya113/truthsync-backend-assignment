import { describe, expect, it } from "vitest";
import { RevenueService } from "../src/metrics/service.js";

describe("RevenueService", () => {
  it("routes both views through the one canonical database function", async () => {
    const queries: string[] = [];
    const db = { query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("group by currency")) return { rows: [{ currency: "usd", amount_minor: "20000" }] };
      return { rows: [{ period: new Date("2025-01-15"), currency: "usd", amount_minor: "12500" },
        { period: new Date("2025-01-16"), currency: "usd", amount_minor: "7500" }] };
    }};
    const service = new RevenueService(db as never);
    const from = new Date("2025-01-01"); const to = new Date("2025-02-01");
    const [summary, breakdown] = await Promise.all([service.summary(from, to), service.breakdown(from, to, "day")]);
    expect(summary[0]?.amountMinor).toBe(String(breakdown.reduce((sum, r) => sum + Number(r.amount_minor), 0)));
    expect(queries).toHaveLength(2);
    expect(queries.every((q) => q.includes("revenue_by_period"))).toBe(true);
  });
});
