import { fail } from "../../../errors.js";

export async function beforeSaveDocument(repo, candidate, current) {
  if (current && ["file_data", "version", "previous_version_id", "file_name", "mime_type"].some((key) => candidate[key] !== current[key]))
    fail(409, "Upload a new version to replace a file.");
  if (current) return;
  if (!candidate.previous_version_id) {
    if (candidate.version !== 1) fail(422, "First document version must be 1.");
    return;
  }
  const documents = await repo.list("documents", candidate.project_id);
  const previous = documents.find((row) => row.id === candidate.previous_version_id);
  if (!previous) fail(422, "Previous document version not found.");
  if (candidate.version !== Number(previous.version) + 1 || documents.some((row) => row.previous_version_id === previous.id))
    fail(409, "A newer version already exists.");
}

export async function beforeDeleteDocument(repo, current) {
  const [packages, approvals, documents] = await Promise.all([
    repo.list("deliverable_packages", current.project_id),
    repo.list("approvals", current.project_id),
    repo.list("documents", current.project_id),
  ]);
  if (packages.some((row) => row.document_ids?.includes(current.id))) fail(409, "This version belongs to a deliverable package.");
  if (approvals.some((row) => row.document_id === current.id) || documents.some((row) => row.previous_version_id === current.id))
    fail(409, "This document is referenced by an approval or a newer version.");
}
