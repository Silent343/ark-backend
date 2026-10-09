import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { config } from "../../../config.js";
import { createPool } from "./pool.js";
import { migrate } from "./migrate.js";
import { transaction } from "./repository.js";

const order = [
  "projects", "users", "members", "invitations", "tasks", "milestones",
  "documents", "issues", "budget_items", "approvals", "calendar_events",
  "task_dependencies", "deliverable_packages", "comments", "blueprints",
  "activities", "notifications",
];

function readSource(filename) {
  if (filename.toLowerCase().endsWith(".json")) {
    const data = JSON.parse(fs.readFileSync(filename, "utf8"));
    return Object.fromEntries(order.map((name) => [name, Array.isArray(data[name]) ? data[name] : []]));
  }
  const sqlite = new DatabaseSync(filename, { readOnly: true });
  try {
    return Object.fromEntries(order.map((name) => {
      const rows = sqlite.prepare(`SELECT data FROM ${name}`).all();
      return [name, rows.map((row) => JSON.parse(row.data))];
    }));
  } finally {
    sqlite.close();
  }
}

export function inspectSource(filename) {
  const data = readSource(filename);
  const ids = (name) => new Set(data[name].map((row) => row.id));
  const projectIds = ids("projects"), userIds = ids("users"), taskIds = ids("tasks"), documentIds = ids("documents");
  const errors = [];
  for (const name of order.filter((item) => !["projects", "users"].includes(item)))
    for (const row of data[name])
      if (!projectIds.has(row.project_id)) errors.push(`${name}/${row.id}: project not found`);
  for (const member of data.members)
    if (!userIds.has(member.user_id)) errors.push(`members/${member.id}: user not found`);
  for (const task of data.tasks)
    if (task.assignee_id && !data.members.some((member) => member.project_id === task.project_id && member.user_id === task.assignee_id))
      errors.push(`tasks/${task.id}: assignee is not a project member`);
  for (const document of data.documents)
    if (document.previous_version_id && !data.documents.some((previous) => previous.id === document.previous_version_id && previous.project_id === document.project_id))
      errors.push(`documents/${document.id}: predecessor not found in project`);
  for (const approval of data.approvals)
    if (!documentIds.has(approval.document_id)) errors.push(`approvals/${approval.id}: document not found`);
  for (const edge of data.task_dependencies)
    if (!taskIds.has(edge.predecessor_id) || !taskIds.has(edge.successor_id)) errors.push(`task_dependencies/${edge.id}: task not found`);
  for (const activity of data.activities)
    if (activity.actor_id && !userIds.has(activity.actor_id)) errors.push(`activities/${activity.id}: actor not found`);
  return { data, counts: Object.fromEntries(order.map((name) => [name, data[name].length])), errors };
}

export async function importSource(pool, source) {
  const { data, errors } = inspectSource(source);
  if (errors.length) throw new Error(`Source contains broken relationships:\n${errors.join("\n")}`);
  await transaction(pool, async (repo) => {
    for (const name of order)
      if ((await repo.list(name)).length) throw new Error(`Target ${name} is not empty; import stopped without changes.`);
    for (const name of order)
      for (const original of data[name]) {
        const row = structuredClone(original);
        if (name === "tasks") { row.start_date ??= row.due_date; row.assignee_id ??= ""; }
        if (name === "budget_items") { row.supplier ??= ""; row.stage ??= "design"; }
        if (name === "approvals") row.reviewer_id ??= "";
        await repo.insert(name, row);
      }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const apply = process.argv.includes("--apply");
  const sourceIndex = process.argv.indexOf("--source");
  const defaultSource = fs.existsSync(path.resolve(config.root, "../teluria-frontend/.data/ark.sqlite"))
    ? path.resolve(config.root, "../teluria-frontend/.data/ark.sqlite")
    : config.seedPath;
  const source = path.resolve(sourceIndex >= 0 ? process.argv[sourceIndex + 1] : defaultSource);
  const report = inspectSource(source);
  console.log(`Source: ${source}`);
  console.log(JSON.stringify(report.counts, null, 2));
  if (report.errors.length) throw new Error(report.errors.join("\n"));
  if (!apply) console.log("Dry run only. Add --apply to import into an empty PostgreSQL database.");
  else {
    const pool = createPool();
    try {
      await migrate(pool);
      await importSource(pool, source);
      console.log("Import committed. Existing SQLite/JSON source was not changed. Sign in again to create a new session cookie.");
    } finally {
      await pool.end();
    }
  }
}
