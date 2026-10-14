import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

process.env.NODE_ENV = "test";
process.env.TELURIA_TEST_MODE = "1";
const { createServer } = await import("../src/server.js");
const { importSource, inspectSource } = await import("../src/shared/infrastructure/postgres/import-data.js");
const { migrate } = await import("../src/shared/infrastructure/postgres/migrate.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let database, server, base;
let queue = Promise.resolve();
const pool = {
  query: (...args) => database.query(...args),
  async connect() {
    let release;
    const previous = queue;
    queue = new Promise((resolve) => { release = resolve; });
    await previous;
    return { query: (...args) => database.query(...args), exec: (sql) => database.exec(sql), release };
  },
};

before(async () => {
  database = await PGlite.create();
  await migrate(pool);
  await migrate(pool);
  server = createServer(pool);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (database) await database.close();
});

async function api(pathname, { method = "GET", body, cookie, version, origin } = {}) {
  const response = await fetch(`${base}/api/v1${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(version ? { "If-Match": JSON.stringify(version) } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    body: response.status === 204 ? {} : await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    headers: response.headers,
  };
}

function expectStatus(result, status) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  return result.body.data;
}

test("PostgreSQL relations and API workflow", async () => {
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  const preflight = await fetch(`${base}/api/v1/projects`, { method: "OPTIONS", headers: { Origin: "http://localhost:3000" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:3000");
  expectStatus(await api("/users", { method: "POST", origin: "https://evil.example", body: {} }), 403);
  const unauthenticated = await api("/projects");
  expectStatus(unauthenticated, 401);
  expectStatus(await api("/users", { method: "POST", body: { name: "Owner", email: "owner@example.test", password: "test-password-2026" } }), 422);
  const owner = await api("/users", { method: "POST", body: { name: "Owner", email: "owner@example.test", password: "test-password-2026", terms_accepted: true, privacy_accepted: true } });
  const ownerId = expectStatus(owner, 201).user.id;
  assert.match(owner.headers.get("set-cookie"), /ark_session=.*HttpOnly/);
  assert.doesNotMatch(owner.headers.get("set-cookie"), /Max-Age/);
  const remembered = await api("/sessions", { method: "POST", body: { email: "owner@example.test", password: "test-password-2026", remember_me: true } });
  expectStatus(remembered, 200);
  assert.match(remembered.headers.get("set-cookie"), /Max-Age=2592000/);
  const cookie = remembered.cookie;
  const project = expectStatus(await api("/projects", { method: "POST", cookie, body: { name: "Project", location: "Lima", floors: 1, floor_height: 2.8, structure_type: "Concrete", soil_type: "Dense sand" } }), 201);
  const rootPath = `/projects/${project.id}`;
  const familyGeometry = {projectId:project.id,width:600,height:600,levels:[{id:"ground",elevation:0}],rooms:[],walls:[],doors:[],windows:[],columns:[],fixtures:[{id:"chair",levelId:"ground",kind:"chair",x:60,y:60,width:30,depth:30,height:.9}],fixtureFamilies:{chair:{familyId:"chair-auditorium",finish:"dark",elevationM:.1}}};
  const familyPlan=expectStatus(await api(`${rootPath}/blueprints`,{cookie,method:"POST",body:{geometry:familyGeometry}}),201);
  const familyUpdate=expectStatus(await api(`${rootPath}/blueprints/${familyPlan.id}`,{cookie,method:"PATCH",version:familyPlan.updated_at,body:{geometry:{...familyGeometry,fixtureFamilies:{chair:{familyId:"chair-office",finish:"light",elevationM:0}}}}}),200);
  const familyReload=expectStatus(await api(`${rootPath}/blueprints/${familyPlan.id}`,{cookie}),200);
  assert.equal(familyReload.geometry.fixtureFamilies.chair.familyId,"chair-office");
  expectStatus(await api(`${rootPath}/blueprints/${familyPlan.id}`,{cookie,method:"PATCH",version:familyUpdate.updated_at,body:{geometry:{...familyGeometry,fixtureFamilies:{chair:{familyId:"sink-wall",finish:"natural",elevationM:0}}}}}),422);
  expectStatus(await api(`${rootPath}/plan-detection`),401);
  const detector=expectStatus(await api(`${rootPath}/plan-detection`,{cookie}),200);
  assert.equal(typeof detector.available,"boolean");
  expectStatus(await api(`${rootPath}/plan-detection`,{cookie,method:"POST",body:{image:"not-an-image"}}),422);
  expectStatus(await api("/projects/missing/plan-detection",{cookie}),404);
  const taskInput = { title: "Review", description: "", status: "todo", priority: "high", assignee: "Owner", due_date: "2026-12-01", discipline: "architecture" };
  const task = expectStatus(await api(`${rootPath}/tasks`, { method: "POST", cookie, body: taskInput }), 201);
  const updated = expectStatus(await api(`${rootPath}/tasks/${task.id}`, { method: "PATCH", cookie, version: task.updated_at, body: { status: "done" } }), 200);
  assert.equal(updated.status, "done");
  expectStatus(await api(`${rootPath}/tasks/${task.id}`, { method: "PATCH", cookie, version: task.updated_at, body: { status: "review" } }), 409);
  expectStatus(await api(`${rootPath}/tasks`, { method: "POST", cookie, body: { ...taskInput, project_id: "other" } }), 400);
  const document = expectStatus(await api(`${rootPath}/documents`, { method: "POST", cookie, body: { title: "Plan", discipline: "architecture", version: 1, status: "draft", file_name: "plan.pdf", file_data: "", mime_type: "application/pdf", notes: "", previous_version_id: "" } }), 201);
  const approval = expectStatus(await api(`${rootPath}/approvals`, { method: "POST", cookie, body: { title: "Review plan", description: "", document_id: document.id, reviewer_id: ownerId, reviewer: "Owner", status: "pending", feedback: "", decided_at: "" } }), 201);
  expectStatus(await api(`${rootPath}/documents/${document.id}`, { method: "DELETE", cookie, version: document.updated_at }), 409);
  const decision = expectStatus(await api(`${rootPath}/approvals/${approval.id}`, { method: "PATCH", cookie, version: approval.updated_at, body: { status: "approved", feedback: "Looks good" } }), 200);
  assert.equal(decision.decided_by, ownerId);
  assert.equal(expectStatus(await api(`${rootPath}/documents/${document.id}`, { cookie }), 200).status, "approved");
  const audit = expectStatus(await api(`${rootPath}/audit-entries`, { cookie }), 200);
  assert(audit.some((entry) => entry.resource === "approvals"));
  const invitation = expectStatus(await api(`${rootPath}/invitations`, { method: "POST", cookie, body: { email: "teammate@example.test", role: "collaborator" } }), 201);
  const teammateRegistration = await api("/users", { method: "POST", body: { name: "Teammate", email: "teammate@example.test", password: "test-password-2026", terms_accepted: true, privacy_accepted: true } });
  const teammate = expectStatus(teammateRegistration, 201);
  const token = new URL(invitation.invitation_url).pathname.split("/").pop();
  expectStatus(await api(`/invitations/${token}`, { method: "POST", cookie: teammateRegistration.cookie, body: {} }), 200);
  const members = expectStatus(await api(`${rootPath}/members`, { cookie }), 200);
  const teammateMember = members.find((member) => member.user_id === teammate.user.id);
  assert(teammateMember);
  expectStatus(await api(`${rootPath}/tasks`, { method: "POST", cookie, body: { ...taskInput, title: "Notify teammate" } }), 201);
  assert((await database.query("SELECT count(*)::integer AS count FROM teluria.notifications WHERE user_id=$1", [teammate.user.id])).rows[0].count > 0);
  expectStatus(await api(`${rootPath}/members/${teammateMember.id}`, { method: "DELETE", cookie, version: teammateMember.updated_at }), 204);
  assert.equal((await database.query("SELECT count(*)::integer AS count FROM teluria.notifications WHERE user_id=$1", [teammate.user.id])).rows[0].count, 0);
  await assert.rejects(() => database.query("DELETE FROM teluria.activities"), /append-only/);
  assert.equal((await database.query("SELECT count(*)::integer AS count FROM teluria.tasks WHERE project_id=$1", [project.id])).rows[0].count, 2);
  await assert.rejects(() => database.query("INSERT INTO teluria.task_dependencies(id,project_id,predecessor_id,successor_id,created_at,updated_at,data) VALUES('bad',$1,'missing',$2,now(),now(),$3::jsonb)", [project.id, task.id, JSON.stringify({ id: "bad", project_id: project.id, predecessor_id: "missing", successor_id: task.id })]), /foreign key/i);
});

const existingSqlite = path.resolve(root, "../teluria-frontend/.data/ark.sqlite");
test("existing SQLite source imports with its relationships and audit history", { skip: !existsSync(existingSqlite) }, async () => {
  const source = existingSqlite;
  const report = inspectSource(source);
  assert.deepEqual(report.errors, []);
  const imported = await PGlite.create();
  let chain = Promise.resolve();
  const target = {
    query: (...args) => imported.query(...args),
    async connect() {
      let release;
      const previous = chain;
      chain = new Promise((resolve) => { release = resolve; });
      await previous;
      return { query: (...args) => imported.query(...args), exec: (sql) => imported.exec(sql), release };
    },
  };
  try {
    await migrate(target);
    await importSource(target, source);
    const projects = await imported.query("SELECT count(*)::integer AS count FROM teluria.projects");
    const users = await imported.query("SELECT count(*)::integer AS count FROM teluria.users");
    const activities = await imported.query("SELECT count(*)::integer AS count FROM teluria.activities");
    assert.equal(projects.rows[0].count, report.counts.projects);
    assert.equal(users.rows[0].count, report.counts.users);
    assert.equal(activities.rows[0].count, report.counts.activities);
    await assert.rejects(() => importSource(target, source), /not empty/);
  } finally {
    await imported.close();
  }
});
