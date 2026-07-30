import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrations = fileURLToPath(new URL("../migrations", import.meta.url));
const sql = readdirSync(migrations, { encoding: "utf8" }).filter((path) => path.endsWith(".sql"))
  .sort().map((path) => readFileSync(join(migrations, path), "utf8")).join("\n");
describe("revenue SQL contract", () => {
  it("uses a positive allow-list join, not a negative status predicate", () => {
    const functionBody = sql.slice(sql.indexOf("create or replace function revenue_by_period"));
    expect(functionBody).toContain("join collected_statuses");
    expect(functionBody).not.toMatch(/status\s+(not\s+in|<>|!=)/i);
  });

  it("prevents application code from bypassing the canonical revenue function", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const directReaders = readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter((path) => path.endsWith(".ts"))
      .filter((path) => /\b(from|join)\s+(normalized_records|collected_statuses)\b/i
        .test(readFileSync(join(src, path), "utf8")));
    expect(directReaders).toEqual([]);
    expect(sql.match(/\bfrom\s+normalized_records\b/gi)).toHaveLength(1);
    expect(sql.match(/\bjoin\s+collected_statuses\b/gi)).toHaveLength(1);
  });
});
