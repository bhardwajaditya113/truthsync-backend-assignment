import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../migrations/001_initial.sql", import.meta.url), "utf8");
describe("revenue SQL contract", () => {
  it("uses a positive allow-list join, not a negative status predicate", () => {
    const functionBody = sql.slice(sql.indexOf("create or replace function revenue_by_period"));
    expect(functionBody).toContain("join collected_statuses");
    expect(functionBody).not.toMatch(/status\s+(not\s+in|<>|!=)/i);
  });
});
