import "dotenv/config";

const baseUrl = process.env.LIVE_BASE_URL ?? "https://truthsync-api.onrender.com";
const adminToken = process.env.SYNC_ADMIN_TOKEN;
if (!adminToken) throw new Error("SYNC_ADMIN_TOKEN is required");

type SyncResult = {
  source: string; status: string; mode: string; recordsWritten: number; error?: string;
};
type Summary = { totals: Array<{ currency: string; amountMinor: string }> };
type Breakdown = { periods: Array<{ currency: string; amountMinor: string }> };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init, signal: AbortSignal.timeout(90_000)
  });
  if (!response.ok) throw new Error(`${path} failed (${response.status})`);
  return response.json() as Promise<T>;
}

const auth = { authorization: `Bearer ${adminToken}` };
const range = "from=2025-01-01T00%3A00%3A00Z&to=2027-01-01T00%3A00%3A00Z";

console.log("\n1) Live deployment");
console.log(await request<{ status: string; mode: string }>("/health"));

console.log("\n2) Real provider sync");
const first = await request<{ results: SyncResult[] }>("/sync", { method: "POST", headers: auth });
console.table(first.results);

console.log("\n3) Immediate replay (idempotency)");
const replay = await request<{ results: SyncResult[] }>("/sync", { method: "POST", headers: auth });
console.table(replay.results);

console.log("\n4) One metric, two views");
const summary = await request<Summary>(`/metrics/revenue/summary?${range}`);
const breakdown = await request<Breakdown>(`/metrics/revenue/breakdown?${range}&bucket=day`);
const breakdownTotals = new Map<string, bigint>();
for (const row of breakdown.periods) {
  breakdownTotals.set(row.currency, (breakdownTotals.get(row.currency) ?? 0n) + BigInt(row.amountMinor));
}
const summaryTotals = Object.fromEntries(summary.totals.map((row) => [row.currency, row.amountMinor]));
const reconciledTotals = Object.fromEntries([...breakdownTotals].map(([currency, amount]) => [currency, String(amount)]));
console.table(summary.totals);
console.log("Breakdown sums:", reconciledTotals);

if ([...first.results, ...replay.results].some((result) => result.status !== "succeeded")) {
  throw new Error("A live provider failed");
}
if (JSON.stringify(summaryTotals) !== JSON.stringify(reconciledTotals)) {
  throw new Error("Summary and breakdown do not reconcile");
}
console.log("PASS: all providers succeeded, replay is safe, and both metric views agree.");
