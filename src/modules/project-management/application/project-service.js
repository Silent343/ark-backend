import { randomUUID } from "node:crypto";
import { fail } from "../../../errors.js";
import { makeRecord } from "../../../shared/domain/record.js";
import { checkVersion, nextRevision } from "../../../shared/domain/revision.js";
import { validateCandidate, validateInput } from "../../../shared/domain/validation.js";
import { recordChange } from "../../change-control/application/record-change.js";
import { projectDefinition } from "../domain/project.js";
import { projectRole } from "../../identity-access/application/session-service.js";

const publicProject = (row, role) => {
  const visible = { ...row };
  if (role === "client") delete visible.budget_total;
  return visible;
};

export async function requireProject(repo, id) {
  return (await repo.find("projects", id)) || fail(404, "Project not found.");
}

export async function listProjects(repo, user) {
  const memberships = (await repo.list("members")).filter((row) => row.user_id === user.id);
  const projects = await Promise.all(memberships.map((member) => repo.find("projects", member.project_id)));
  return { data: await Promise.all(projects.filter(Boolean).map(async (project) => {
    const role = memberships.find((member) => member.project_id === project.id).role;
    const [tasks, milestones, issues, approvals, costs] = await Promise.all([
      repo.list("tasks", project.id), repo.list("milestones", project.id),
      repo.list("issues", project.id), repo.list("approvals", project.id),
      role === "client" ? Promise.resolve([]) : repo.list("budget_items", project.id),
    ]);
    return {
      ...publicProject(project, role), role, current_user_id: user.id,
      management: {
        progress: tasks.length ? Math.round(tasks.filter((row) => row.status === "done").length / tasks.length * 100) : 0,
        task_count: tasks.length,
        open_issues: issues.filter((row) => row.status !== "resolved").length,
        pending_approvals: approvals.filter((row) => row.status === "pending").length,
        budget_actual: costs.reduce((sum, row) => sum + Number(row.actual_cost), 0),
        next_milestone: milestones.filter((row) => row.status !== "completed").sort((a, b) => a.due_date.localeCompare(b.due_date))[0]?.title || "",
      },
    };
  })) };
}

export async function getProject(repo, id, user, role) {
  return { data: { ...publicProject(await requireProject(repo, id), role), role, current_user_id: user.id } };
}

export async function createProject(repo, input, user) {
  validateInput(input, projectDefinition, true);
  const id = typeof input.id === "string" ? input.id : randomUUID();
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) fail(400, "Invalid project id.");
  if (await repo.find("projects", id)) fail(409, "Project already exists.");
  const now = new Date().toISOString();
  const row = {
    status: "Ready", thumbnail_variant: "blueprint", cover_image: "", progress: 0,
    phase: "proposal", client_name: "", owner_name: user.name, target_date: "",
    budget_total: 0, currency: "PEN", ...input,
    id, project_id: id, created_at: now, updated_at: now,
  };
  validateCandidate(row, projectDefinition);
  await repo.insert("projects", row);
  await repo.insert("members", makeRecord(id, { user_id: user.id, name: user.name, email: user.email, role: "owner" }));
  await recordChange(repo, user, "projects", "created", row);
  return { status: 201, data: row };
}

export async function updateProject(repo, id, request, input, user) {
  const current = (await repo.find("projects", id, undefined, true)) || fail(404, "Project not found.");
  checkVersion(request, current);
  validateInput(input, projectDefinition);
  const next = { ...current, ...input, updated_at: nextRevision(current) };
  validateCandidate(next, projectDefinition);
  await repo.update("projects", next, current.updated_at);
  await recordChange(repo, user, "projects", "updated", next, current);
  return { data: next };
}
