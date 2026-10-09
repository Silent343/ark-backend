import { randomUUID } from "node:crypto";
import { fail } from "../../errors.js";
import { checkVersion, nextRevision } from "../domain/revision.js";
import { validateCandidate, validateInput } from "../domain/validation.js";
import { visibleRows } from "../../modules/identity-access/application/authorization.js";
import { recordChange } from "../../modules/change-control/application/record-change.js";
import { beforeDeleteTask, beforeSaveTask } from "../../modules/task-management/application/task-policy.js";
import { beforeDeleteDocument, beforeSaveDocument } from "../../modules/document-management/application/version-policy.js";
import { beforeSaveApproval, prepareApprovalInput } from "../../modules/client-approvals/application/review-policy.js";

export async function handleResource(repo, request, context) {
  const { projectId, resourceId, definition, user, role } = context;
  const method = request.method;
  const input = request.body || {};
  const rows = await repo.list(definition.table, projectId);
  const readable = await visibleRows(repo, projectId, definition.resource, rows, role, user.id);
  const current = resourceId ? readable.find((row) => row.id === resourceId) : undefined;
  if (resourceId && !current) fail(404, "Resource not found.");
  if (method === "GET") return { data: current || readable };

  if (method === "DELETE") {
    if (!current) fail(405, "Item id required.");
    checkVersion(request, current);
    if (definition.resource === "tasks") await beforeDeleteTask(repo, current);
    if (definition.resource === "documents") await beforeDeleteDocument(repo, current);
    await repo.remove(definition.table, current.id, current.updated_at);
    await recordChange(repo, user, definition.resource, "deleted", current);
    return { status: 204 };
  }

  if (!((method === "POST" && !resourceId) || (method === "PATCH" && current))) fail(405, "Method not allowed.");
  if (current) checkVersion(request, current);
  validateInput(input, definition);
  if (definition.resource === "budget-items") { input.supplier ??= current?.supplier ?? ""; input.stage ??= current?.stage ?? "design"; }
  if (definition.resource === "tasks") { input.start_date ??= current?.start_date ?? input.due_date; input.assignee_id ??= current?.assignee_id ?? ""; }
  if (definition.resource === "approvals") await prepareApprovalInput(repo, input, current, role, user, projectId);
  const now = nextRevision(current);
  const candidate = {
    ...current, ...input, id: current?.id || randomUUID(), project_id: projectId,
    created_at: current?.created_at || now, updated_at: now,
  };
  validateCandidate(candidate, definition);
  if (definition.resource === "tasks") await beforeSaveTask(repo, candidate);
  if (definition.resource === "documents") await beforeSaveDocument(repo, candidate, current);
  if (definition.resource === "approvals") await beforeSaveApproval(repo, candidate);
  if (current) await repo.update(definition.table, candidate, current.updated_at);
  else await repo.insert(definition.table, candidate);
  await recordChange(repo, user, definition.resource, current ? "updated" : "created", candidate, current);
  return { status: current ? 200 : 201, data: candidate };
}
