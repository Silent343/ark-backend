import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

process.env.NODE_ENV = "test";
process.env.TELURIA_TEST_MODE = "1";
const { createServer } = await import("../src/server.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.resolve(root, "../teluria-frontend");
const database = await PGlite.create();
for (const migration of ["001_initial.sql", "002_audit_immutable.sql", "003_auth_throttle.sql"])
  await database.exec(await fs.readFile(path.join(root, "migrations", migration), "utf8"));
await database.query("INSERT INTO teluria.schema_migrations(version) VALUES(1),(2),(3)");

let queue = Promise.resolve();
const pool = {
  query: (...args) => database.query(...args),
  async connect() {
    let release;
    const previous = queue;
    queue = new Promise((resolve) => { release = resolve; });
    await previous;
    return { query: (...args) => database.query(...args), release };
  },
};
const server = createServer(pool);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function run(script) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(frontend, "scripts", script)], {
      cwd: frontend,
      env: { ...process.env, ARK_TEST_URL: base },
      stdio: "inherit",
    });
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${script} failed: ${code}`)));
    child.on("error", reject);
  });
}

try {
  await run("test-workspace-api.mjs");
  await run("test-collaboration-api.mjs");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await database.close();
}
