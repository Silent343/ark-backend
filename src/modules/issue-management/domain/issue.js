import { choice, date, required } from "../../../shared/domain/validation.js";

export const issueDefinition = {
  resource: "issues",
  table: "issues",
  fields: ["title", "description", "status", "priority", "assignee", "due_date", "element_id"],
  validate(value) {
    required(value.title, "title"); required(value.assignee, "assignee"); date(value.due_date, "due_date");
    choice(value.status, ["open", "in_progress", "resolved"], "status");
    choice(value.priority, ["low", "medium", "high"], "priority");
  },
};
