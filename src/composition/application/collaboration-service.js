import { config } from "../../config.js";
import { fail } from "../../errors.js";
import { makeRecord } from "../../shared/domain/record.js";
import { checkVersion, nextRevision } from "../../shared/domain/revision.js";
import { canManage, canReadDocument, visibleRows } from "../../modules/identity-access/application/authorization.js";
import { recordChange } from "../../modules/change-control/application/record-change.js";
import { token, digest } from "../../modules/identity-access/domain/credentials.js";
import { validateCalendarEvent, validateDependency } from "../../modules/project-scheduling/domain/schedule.js";
import { validateComment } from "../../modules/collaboration/domain/comment.js";
import { validatePackage } from "../../modules/delivery-management/domain/package.js";
import { validateBlueprint } from "../../modules/plan-digitization/domain/blueprint.js";

const tables = Object.freeze({
  "calendar-events": "calendar_events",
  "task-dependencies": "task_dependencies",
  "deliverable-packages": "deliverable_packages",
  members: "members",
  invitations: "invitations",
  comments: "comments",
  notifications: "notifications",
  "audit-entries": "activities",
  blueprints: "blueprints",
});
export const isCollaborationResource = (resource) => resource in tables;

const editable = Object.freeze({
  members: ["role"],
  notifications: ["read_at"],
  "task-dependencies": ["predecessor_id", "successor_id", "lag_days"],
  blueprints: ["geometry"],
  comments: ["content", "target_type", "target_id", "visibility"],
  "calendar-events": ["title", "start_at", "end_at", "owner", "category", "location", "notes"],
  "deliverable-packages": ["title", "stage", "due_date", "status", "document_ids"],
});

export async function handleCollaboration(repo, request, context) {
  const { projectId, resource, resourceId, user, role } = context;
  const method = request.method;
  const input = request.body || {};
  const table = tables[resource];
  const rows = await repo.list(table, projectId);
  const visible = await visibleRows(repo, projectId, resource, rows, role, user.id);
  const current = resourceId ? visible.find((row) => row.id === resourceId) : undefined;
  if (resourceId && !current) fail(404, "Resource not found.");

  if (method === "GET") {
    if (resource === "invitations") return { data: rows.map(({ token_hash, ...safe }) => safe) };
    if (resource === "audit-entries") return { data: [...rows].reverse() };
    return { data: current || visible };
  }
  if (resource === "audit-entries") fail(405, "Audit entries are immutable.");

  if (method === "DELETE") {
    if (!current) fail(405, "Item id required.");
    checkVersion(request, current);
    if (resource === "members" && (current.role === "owner" || current.user_id === user.id))
      fail(409, "The owner cannot be removed.");
    if (resource === "members") {
      const tasks = await repo.list("tasks", projectId);
      const approvals = await repo.list("approvals", projectId);
      if (tasks.some((task) => task.assignee_id === current.user_id) || approvals.some((approval) => approval.reviewer_id === current.user_id))
        fail(409, "Reassign this member's tasks and reviews before removal.");
    }
    if (resource === "comments" && current.author_id !== user.id && !canManage(role))
      fail(403, "Only the author or project manager can delete this comment.");
    if (["notifications", "blueprints", "invitations"].includes(resource)) fail(405, "Deletion is not supported.");
    await repo.remove(table, current.id, current.updated_at);
    await recordChange(repo, user, resource, "deleted", current);
    return { status: 204 };
  }

  if (!["POST", "PATCH"].includes(method) || (method === "POST" && resourceId) || (method === "PATCH" && !current))
    fail(405, "Method not allowed.");
  if (current) checkVersion(request, current);

  if (resource === "invitations") {
    if (current) {
      if (Object.keys(input).some((key) => key !== "status") || input.status !== "revoked") fail(422, "Only revocation is supported.");
      const next = { ...current, status: "revoked", updated_at: nextRevision(current) };
      await repo.update("invitations", next, current.updated_at);
      return { data: { id: next.id, status: next.status } };
    }
    const email = String(input.email || "").trim().toLowerCase();
    const inviteRole = String(input.role || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["architect", "collaborator", "client"].includes(inviteRole)) fail(422, "Choose an email and role.");
    if (rows.some((row) => row.email === email && row.status === "pending" && row.expires_at > new Date().toISOString())) fail(409, "A pending invitation already exists.");
    const secret = token();
    const invite = makeRecord(projectId, { email, role: inviteRole, token_hash: digest(secret), expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), status: "pending" });
    await repo.insert("invitations", invite);
    await recordChange(repo, user, resource, "created", invite);
    return { status: 201, data: { id: invite.id, email, role: inviteRole, expires_at: invite.expires_at, invitation_url: `${config.frontendUrl}/invitations/${secret}` } };
  }

  if (resource === "members") {
    if (!current) fail(405, "Add members using an invitation.");
    if (current.role === "owner" || current.user_id === user.id) fail(409, "The owner role cannot be changed here.");
    if (Object.keys(input).some((key) => key !== "role") || !["architect", "collaborator", "client"].includes(String(input.role))) fail(422, "Choose a valid role.");
    if (input.role === "client") {
      const tasks = await repo.list("tasks", projectId);
      if (tasks.some((task) => task.assignee_id === current.user_id)) fail(409, "Reassign member tasks before changing to client.");
    }
  }
  if (resource === "notifications") {
    if (!current || Object.keys(input).some((key) => key !== "read_at")) fail(422, "Only read state can be changed.");
    input.read_at = nextRevision(current);
  }
  if (Object.keys(input).some((key) => !editable[resource]?.includes(key))) fail(400, "Unknown or read-only field.");

  const next = { ...(current || makeRecord(projectId)), ...input, updated_at: nextRevision(current) };
  if (resource === "calendar-events") validateCalendarEvent(next);
  if (resource === "comments") {
    if (current) fail(405, "Comments are immutable. Add a follow-up reply.");
    validateComment(next);
    if (role === "client" && (next.visibility !== "client" || next.target_type === "task")) fail(403, "Choose a shared discussion.");
    if (next.target_type === "project" && next.target_id && next.target_id !== projectId) fail(422, "Project reference must match this workspace.");
    if (next.target_type === "task" && !(await repo.find("tasks", next.target_id, projectId))) fail(422, "Task not found.");
    if (next.target_type === "document" && (!(await repo.find("documents", next.target_id, projectId)) || (role === "client" && !(await canReadDocument(repo, projectId, next.target_id, user.id))))) fail(422, "Document unavailable.");
    if (next.target_type === "element") {
      const plan = (await repo.list("blueprints", projectId))[0];
      if (plan) {
        const geometry = plan.geometry;
        const elements = ["walls", "rooms", "doors", "windows", "columns", "stairs"].flatMap((key) => geometry[key] || []);
        if (!elements.some((element) => element.id === next.target_id)) fail(422, "Element not found in the shared plan.");
      }
    }
    next.author_id = user.id; next.author_name = user.name;
  }
  if (resource === "task-dependencies") {
    const tasks = await repo.list("tasks", projectId);
    validateDependency(next, tasks, rows.filter((row) => row.id !== current?.id));
  }
  if (resource === "deliverable-packages") validatePackage(next, await repo.list("documents", projectId));
  if (resource === "blueprints") {
    if (!current && rows.length) fail(409, "A shared plan already exists. Reload it.");
    validateBlueprint(next.geometry, projectId);
  }

  if (current) await repo.update(table, next, current.updated_at);
  else await repo.insert(table, next);
  await recordChange(repo, user, resource, current ? "updated" : "created", next, current);
  return { status: current ? 200 : 201, data: next };
}
