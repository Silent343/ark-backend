import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}
const resolveFromRoot = (value) =>
  path.isAbsolute(value) ? value : path.resolve(root, value);

const production = process.env.NODE_ENV === "production";
if (production && process.env.TELURIA_TEST_MODE === "1")
  throw new Error("TELURIA_TEST_MODE cannot be enabled in production.");
if (production && (!process.env.TELURIA_ALLOWED_ORIGINS || !process.env.TELURIA_FRONTEND_URL || !process.env.TELURIA_OWNER_EMAIL))
  throw new Error("Production requires TELURIA_ALLOWED_ORIGINS, TELURIA_FRONTEND_URL and TELURIA_OWNER_EMAIL.");
const origins = (process.env.TELURIA_ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((value) => value.trim().replace(/\/$/, ""))
  .filter(Boolean);
for (const origin of origins) {
  const parsed = new URL(origin);
  if (parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol) || (production && parsed.protocol !== "https:"))
    throw new Error(`Invalid TELURIA_ALLOWED_ORIGINS entry: ${origin}`);
}
const frontendUrl = process.env.TELURIA_FRONTEND_URL?.replace(/\/$/, "") || origins[0];
if (production && !origins.includes(frontendUrl))
  throw new Error("TELURIA_FRONTEND_URL must be an allowed HTTPS origin.");

export const config = Object.freeze({
  root,
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 8000),
  databaseUrl: process.env.DATABASE_URL || "",
  databaseCaPath: process.env.DATABASE_CA_PATH || "",
  poolSize: Number(process.env.DATABASE_POOL_SIZE || 5),
  testMode: process.env.TELURIA_TEST_MODE === "1",
  production,
  allowedOrigins: new Set(origins),
  frontendUrl,
  seedPath: resolveFromRoot(process.env.TELURIA_SEED_PATH || "../teluria-frontend/data/workspace-db.json"),
});
