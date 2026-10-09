import { choice, required } from "../../../shared/domain/validation.js";

export const approvalDefinition = {
  resource: "approvals",
  table: "approvals",
  fields: ["reviewer_id", "title", "description", "document_id", "status", "reviewer", "feedback", "decided_at"],
  validate(value) {
    required(value.title, "title"); required(value.reviewer, "reviewer");
    choice(value.status, ["pending", "approved", "changes_requested"], "status");
    if (value.status !== "pending") required(value.feedback, "feedback", 2000);
  },
};
