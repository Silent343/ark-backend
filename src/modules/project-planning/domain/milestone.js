import { choice, date, required } from "../../../shared/domain/validation.js";
import { fail } from "../../../errors.js";

export const milestoneDefinition = {
  resource: "milestones",
  table: "milestones",
  fields: ["title", "start_date", "due_date", "status", "owner"],
  validate(value) {
    required(value.title, "title"); required(value.owner, "owner");
    date(value.start_date, "start_date"); date(value.due_date, "due_date");
    if (value.due_date < value.start_date) fail(422, "due_date: must follow start_date.");
    choice(value.status, ["planned", "in_progress", "completed"], "status");
  },
};
