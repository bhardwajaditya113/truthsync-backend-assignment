import "dotenv/config";
import { createAdapters } from "../src/adapters/factory.js";
import { config } from "../src/config.js";
import { pool, PostgresRepository } from "../src/db/postgres.js";
import { SyncOrchestrator } from "../src/sync/orchestrator.js";

try {
  const results = await new SyncOrchestrator(new PostgresRepository(pool)).syncAll(createAdapters(config));
  console.log(JSON.stringify({ mode: config.DEMO_MODE ? "demo" : "live", results }, null, 2));
  if (results.some((result) => result.status === "failed")) process.exitCode = 1;
} finally {
  await pool.end();
}
