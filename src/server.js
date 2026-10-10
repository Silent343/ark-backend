import http from "node:http";
import { config } from "./config.js";
import { HttpError, fail } from "./errors.js";
import { createPool } from "./shared/infrastructure/postgres/pool.js";
import { migrate } from "./shared/infrastructure/postgres/migrate.js";
import { transaction } from "./shared/infrastructure/postgres/repository.js";
import { handleIdentity } from "./modules/identity-access/application/identity-service.js";
import { createLoginThrottle } from "./modules/identity-access/infrastructure/login-throttle.js";
import { requireUser, projectRole } from "./modules/identity-access/application/session-service.js";
import { handleWorkspace } from "./composition/application/workspace-service.js";
import { buildProjectReport } from "./modules/reporting/application/build-project-report.js";
import { renderProjectReport } from "./modules/reporting/infrastructure/pdf-report.js";

const writeMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const bodyMethods = new Set(["POST", "PATCH", "PUT"]);

async function parseBody(request) {
  if (!bodyMethods.has(request.method)) return {};
  if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers["content-type"] || "")))
    fail(415, "Content-Type must be application/json.");
  let size = 0;
  // Vector plans contain many small CAD entities; other resources keep their existing upload limit.
  const limit = /^\/api\/v1\/projects\/[^/]+\/blueprints(?:\/[^/?]+)?(?:\?|$)/.test(request.url || "") ? 32 * 1024 * 1024 : 4_300_000;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) fail(413, "Request is too large.");
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "Expected a JSON object.");
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    fail(400, "Invalid JSON.");
  }
}

function requestOrigin(request) {
  return `${request.socket.encrypted ? "https" : "http"}://${request.headers.host}`;
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  return origin && config.allowedOrigins.has(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", Vary: "Origin" }
    : { Vary: "Origin" };
}

function checkOrigin(request) {
  if (!writeMethods.has(request.method)) return;
  const origin = request.headers.origin;
  if (request.headers["sec-fetch-site"] === "cross-site" && !origin)
    fail(403, "Origin is required for cross-site writes.");
  if (origin && origin !== requestOrigin(request) && !config.allowedOrigins.has(origin))
    fail(403, "Cross-origin writes are not allowed.");
  if (!origin && config.production && request.headers.cookie)
    fail(403, "Origin is required for authenticated writes.");
}

function send(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    ...headers,
  });
  response.end(payload);
}

function json(response, status, payload, headers = {}) {
  send(response, status, JSON.stringify(payload), { "Content-Type": "application/json; charset=utf-8", ...headers });
}

function parseRoute(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "v1") return null;
  if (["users", "sessions"].includes(parts[2]) && parts.length === 3)
    return { kind: "identity", resource: parts[2] };
  if (parts[2] === "invitations" && parts[3] && parts.length === 4)
    return { kind: "identity", resource: "invitations", token: parts[3] };
  if (parts[2] !== "projects" || parts.length > 6) return null;
  if (parts.length === 3) return { kind: "workspace" };
  if (parts.length === 4) return { kind: "workspace", projectId: parts[3] };
  return {
    kind: "workspace",
    projectId: parts[3],
    resource: parts[4] === "change-log" ? "audit-entries" : parts[4],
    resourceId: parts[5],
  };
}

function errorStatus(error) {
  if (error instanceof HttpError) return error.status;
  if (error?.code === "23505" || error?.code === "23503") return 409;
  if (error?.code === "23514" || error?.code === "22P02") return 422;
  if (error?.code === "40001" || error?.code === "40P01") return 409;
  return 500;
}

export function createServer(pool) {
  const throttle = createLoginThrottle(pool);
  const application = async (request, response) => {
    const url = new URL(request.url, requestOrigin(request));
    const common = { ...corsHeaders(request), ...(config.testMode ? { "X-Ark-Test-Mode": "1", "X-Teluria-Test-Mode": "1" } : {}) };
    if (request.method === "OPTIONS") {
      if (request.headers.origin && !config.allowedOrigins.has(request.headers.origin)) fail(403, "Origin is not allowed.");
      send(response, 204, null, {
        ...common,
        "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,If-Match",
        "Access-Control-Max-Age": "86400",
      });
      return;
    }
    if (url.pathname === "/api/health" && request.method === "GET") {
      await pool.query("SELECT 1");
      json(response, 200, { status: "ok", service: "teluria-backend" }, common);
      return;
    }
    const route = parseRoute(url.pathname);
    if (!route) fail(404, "Resource not found.");
    checkOrigin(request);
    request.body = await parseBody(request);
    if (route.kind === "identity") {
      const result = await handleIdentity(
        (action) => transaction(pool, action), request, route.resource, route.token,
        { testMode: config.testMode, ownerEmail: process.env.TELURIA_OWNER_EMAIL?.trim().toLowerCase(), throttle },
      );
      const cookie = result.sessionToken
        ? `ark_session=${result.sessionToken}; Path=/; HttpOnly; SameSite=Lax${result.sessionMaxAge ? `; Max-Age=${result.sessionMaxAge}` : ""}${config.production ? "; Secure" : ""}`
        : result.clearCookie
          ? [
              `ark_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.production ? "; Secure" : ""}`,
              `teluria_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.production ? "; Secure" : ""}`,
            ]
          : undefined;
      json(response, result.status || 200, { data: result.data }, { ...common, ...(cookie ? { "Set-Cookie": cookie } : {}) });
      return;
    }
    if (route.resource === "reports" && request.method === "GET" && !route.resourceId) {
      const report = await transaction(pool, async (repo) => {
        const user = await requireUser(repo, request);
        if (await projectRole(repo, route.projectId, user.id) === "client") fail(403, "Internal project report.");
        const project = await repo.find("projects", route.projectId);
        if (!project) fail(404, "Project not found.");
        return buildProjectReport(repo, project, url.searchParams.get("locale"));
      });
      send(response, 200, await renderProjectReport(report), { ...common, "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=teluria-project-report.pdf" });
      return;
    }
    const result = await handleWorkspace(pool, request, route);
    if (result.status === 204) return send(response, 204, null, common);
    const headers = { ...common };
    if (result.data && !Array.isArray(result.data) && result.data.updated_at)
      headers.ETag = JSON.stringify(result.data.updated_at);
    if ((result.status || 200) === 201 && result.data?.id)
      headers.Location = `${url.pathname}/${result.data.id}`;
    json(response, result.status || 200, { data: result.data }, headers);
  };
  return http.createServer((request, response) => {
    application(request, response).catch((error) => {
      const status = errorStatus(error);
      if (status === 500) console.error("API error", error);
      json(response, status, { error: { code: status, message: status === 500 ? "Unexpected server error." : error instanceof HttpError ? error.message : status === 409 ? "Resource is still referenced or already exists." : "Invalid resource." } }, corsHeaders(request));
    });
  });
}

if (process.env.NODE_ENV !== "test") {
  const pool = createPool();
  await migrate(pool);
  const server = createServer(pool);
  server.listen(config.port, config.host, () => console.log(`Teluria API listening on ${config.host}:${config.port}`));
  const shutdown = () => server.close(() => pool.end());
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
