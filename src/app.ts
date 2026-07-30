import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { z } from "zod";
import type { Config } from "./config.js";
import type { SourceAdapter } from "./domain/types.js";
import type { Pool } from "pg";
import { PostgresRepository } from "./db/postgres.js";
import { SyncOrchestrator } from "./sync/orchestrator.js";
import { RevenueService } from "./metrics/service.js";

const dateRangeShape = { from: z.coerce.date(), to: z.coerce.date() };
const summaryRangeSchema = z.object(dateRangeShape).refine((v) => v.from < v.to, { message: "from must be before to" });
const breakdownRangeSchema = z.object({
  ...dateRangeShape, bucket: z.enum(["day", "week"]).default("day")
}).refine((v) => v.from < v.to, { message: "from must be before to" });

export async function buildApp(config: Config, db: Pool, adapters: SourceAdapter[]) {
  const app = Fastify({ logger: true });
  await app.register(sensible);
  const sync = new SyncOrchestrator(new PostgresRepository(db));
  const metrics = new RevenueService(db);

  app.get("/", async () => ({
    name: "TruthSync API",
    status: "ok",
    mode: config.DEMO_MODE ? "demo" : "live",
    endpoints: {
      health: "GET /health",
      sync: "POST /sync (Bearer token required)",
      syncRuns: "GET /sync/runs (Bearer token required)",
      revenueSummary: "GET /metrics/revenue/summary?from=<ISO>&to=<ISO>",
      revenueBreakdown: "GET /metrics/revenue/breakdown?from=<ISO>&to=<ISO>&bucket=day|week"
    }
  }));

  app.get("/health", async () => {
    await db.query("select 1");
    return { status: "ok", mode: config.DEMO_MODE ? "demo" : "live" };
  });

  app.post("/sync", async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${config.SYNC_ADMIN_TOKEN}`) return reply.unauthorized();
    const results = await sync.syncAll(adapters);
    const allFailed = results.every((r) => r.status === "failed");
    return reply.code(allFailed ? 503 : 207).send({ results });
  });

  app.get("/metrics/revenue/summary", async (request, reply) => {
    const parsed = summaryRangeSchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest(parsed.error.issues.map((i) => i.message).join(", "));
    return { from: parsed.data.from, to: parsed.data.to, totals: await metrics.summary(parsed.data.from, parsed.data.to) };
  });

  app.get("/metrics/revenue/breakdown", async (request, reply) => {
    const parsed = breakdownRangeSchema.safeParse(request.query);
    if (!parsed.success) return reply.badRequest(parsed.error.issues.map((i) => i.message).join(", "));
    const rows = await metrics.breakdown(parsed.data.from, parsed.data.to, parsed.data.bucket);
    return { from: parsed.data.from, to: parsed.data.to, bucket: parsed.data.bucket,
      periods: rows.map((r) => ({ period: r.period, currency: r.currency, amountMinor: r.amount_minor })) };
  });

  app.get("/sync/runs", async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${config.SYNC_ADMIN_TOKEN}`) return reply.unauthorized();
    const result = await db.query("select * from sync_runs order by finished_at desc limit 50");
    return { runs: result.rows };
  });
  return app;
}
