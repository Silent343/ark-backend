import fs from "node:fs";
import pg from "pg";
import { config } from "../../../config.js";

export function createPool() {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required.");
  const connection = new URL(config.databaseUrl);
  const sslMode = connection.searchParams.get("sslmode");
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    connection.searchParams.delete(key);
  const ssl = config.production || sslMode === "require" || sslMode === "verify-full" || config.databaseCaPath
    ? { rejectUnauthorized: true, ...(config.databaseCaPath ? { ca: fs.readFileSync(config.databaseCaPath, "utf8") } : {}) }
    : undefined;
  return new pg.Pool({
    connectionString: connection.toString(),
    ...(ssl ? { ssl } : {}),
    max: config.poolSize,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    application_name: "teluria-backend",
  });
}
