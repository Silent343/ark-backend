import { fail } from "../../../errors.js";

export const canManage = (role) => role === "owner" || role === "architect";

export function authorize(role, resource, method) {
  if (role === "client") {
    if (method === "GET" && ["projects", "documents", "approvals", "comments", "deliverable-packages", "blueprints", "notifications"].includes(resource)) return;
    if (resource === "comments" && method === "POST") return;
    if (resource === "approvals" && method === "PATCH") return;
    if (resource === "notifications" && method === "PATCH") return;
    fail(403, "Your role cannot perform this action.");
  }
  if (resource === "invitations" && !canManage(role)) fail(403, "Project management permission is required.");
  if (method === "GET") return;
  if (["members", "invitations", "projects", "deliverable-packages", "budget-items", "calendar-events", "task-dependencies", "approvals"].includes(resource) && !canManage(role))
    fail(403, "Project management permission is required.");
  if (method === "DELETE" && resource !== "comments" && !canManage(role))
    fail(403, "Only project managers can delete this resource.");
}

export async function canReadDocument(repo, projectId, id, userId) {
  const approvals = await repo.list("approvals", projectId);
  if (approvals.some((row) => row.document_id === id && row.reviewer_id === userId)) return true;
  return (await repo.list("deliverable_packages", projectId)).some(
    (row) => row.status !== "draft" && Array.isArray(row.document_ids) && row.document_ids.includes(id),
  );
}

export async function visibleRows(repo, projectId, resource, rows, role, userId) {
  if (resource === "notifications") return rows.filter((row) => row.user_id === userId);
  if (role !== "client") return rows;
  if (resource === "approvals") return rows.filter((row) => row.reviewer_id === userId);
  if (resource === "deliverable-packages") return rows.filter((row) => row.status !== "draft");
  if (resource === "documents") {
    const visible = await Promise.all(rows.map((row) => canReadDocument(repo, projectId, row.id, userId)));
    return rows.filter((_, index) => visible[index]);
  }
  if (resource === "comments") {
    const visible = await Promise.all(rows.map(async (row) =>
      row.visibility === "client" && (row.target_type !== "document" || await canReadDocument(repo, projectId, row.target_id, userId))));
    return rows.filter((_, index) => visible[index]);
  }
  return rows;
}
