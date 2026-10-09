import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "./pool.js";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../migrations");

/** One connection and an advisory lock serialize migrations across Render instances. */
export async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(82402361)");
    await client.query("CREATE SCHEMA IF NOT EXISTS teluria");
    await client.query("CREATE TABLE IF NOT EXISTS teluria.schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const files = (await fs.readdir(migrationsDir)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
    for (const file of files) {
      const version = Number(file.split("_")[0]);
      const existing = await client.query("SELECT 1 FROM teluria.schema_migrations WHERE version=$1", [version]);
      if (existing.rows.length) continue;
      await client.query("BEGIN");
      try {
        const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        if (typeof client.exec === "function") await client.exec(sql);
        else await client.query(sql);
        await client.query("INSERT INTO teluria.schema_migrations(version) VALUES($1)", [version]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(82402361)").catch(() => undefined);
    client.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pool = createPool();
  try {
    await migrate(pool);
    console.log("PostgreSQL migrations applied.");
  } finally {
    await pool.end();
  }
}
