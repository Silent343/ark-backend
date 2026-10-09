import { choice, date, required } from "../../../shared/domain/validation.js";
import { fail } from "../../../errors.js";

export function validatePackage(value, documents) {
  for (const field of ["title", "stage", "due_date", "status"])
    if (typeof value[field] !== "string") fail(422, `${field}: expected text.`);
  required(value.title, "title"); date(value.due_date, "due_date");
  choice(value.stage, ["proposal", "design", "review", "construction", "delivered"], "stage");
  choice(value.status, ["draft", "in_review", "approved"], "status");
  if (!Array.isArray(value.document_ids) || !value.document_ids.every((id) => typeof id === "string")) fail(422, "Select document versions.");
  if (!value.document_ids.every((id) => documents.some((row) => row.id === id))) fail(422, "Document versions must belong to this project.");
  if (value.status !== "draft" && !value.document_ids.length) fail(422, "Add a document version before sharing.");
  if (value.status === "approved" && value.document_ids.some((id) => documents.find((row) => row.id === id)?.status !== "approved"))
    fail(422, "All document versions must be approved first.");
}
