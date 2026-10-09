import { choice, date, required } from "../../../shared/domain/validation.js";
import { fail } from "../../../errors.js";

export const taskDefinition = {
  resource: "tasks",
  table: "tasks",
  fields: ["title", "description", "status", "priority", "assignee", "due_date", "discipline", "start_date", "assignee_id"],
  validate(value) {
    required(value.title, "title"); required(value.assignee, "assignee"); required(value.discipline, "discipline");
    date(value.due_date, "due_date");
    if (value.start_date) { date(value.start_date, "start_date"); if (value.start_date > value.due_date) fail(422, "Start date must be before the due date."); }
    choice(value.status, ["todo", "in_progress", "review", "done"], "status");
    choice(value.priority, ["low", "medium", "high"], "priority");
  },
};
