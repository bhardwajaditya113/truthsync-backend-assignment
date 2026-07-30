import { config } from "./config.js";
import { pool } from "./db/postgres.js";
import { createAdapters } from "./adapters/factory.js";
import { buildApp } from "./app.js";

const app = await buildApp(config, pool, createAdapters(config));
const shutdown = async () => { await app.close(); await pool.end(); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await app.listen({ port: config.PORT, host: "0.0.0.0" });
