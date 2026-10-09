import { fail } from "../../../errors.js";
import { nextRevision } from "../../../shared/domain/revision.js";

export async function prepareApprovalInput(repo, input, current, role, user, projectId) {
  if (role === "client" && (current?.reviewer_id !== user.id || Object.keys(input).some((key) => !["status", "feedback", "reviewer"].includes(key))))
    fail(403, "Only your assigned review can be answered.");
  input.reviewer_id ??= current?.reviewer_id ?? "";
  if (input.reviewer_id && !(await repo.list("members", projectId)).some((row) => row.user_id === input.reviewer_id))
    fail(422, "Reviewer must be a project member.");
  if (input.status && input.status !== "pending") {
    if ((input.reviewer_id || current?.reviewer_id) !== user.id) fail(403, "Only the assigned reviewer can decide.");
    input.reviewer = user.name;
    input.decided_by = user.id;
  }
}

export async function beforeSaveApproval(repo, candidate) {
  const document = candidate.document_id
    ? await repo.find("documents", candidate.document_id, candidate.project_id, true)
    : null;
  if (candidate.document_id && !document) fail(422, "Document does not belong to this project.");
  if (candidate.status !== "pending") {
    candidate.decided_at = nextRevision();
    if (document) {
      const next = { ...document, status: candidate.status, updated_at: nextRevision(document) };
      await repo.update("documents", next, document.updated_at);
    }
  } else candidate.decided_at = "";
}
