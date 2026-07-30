import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = await readFile(fileURLToPath(new URL("../migrations/001_initial.sql", import.meta.url)), "utf8");
const pool = new pg.Pool({ connectionString: databaseUrl });
try { await pool.query(sql); console.log("Migration complete"); } finally { await pool.end(); }
