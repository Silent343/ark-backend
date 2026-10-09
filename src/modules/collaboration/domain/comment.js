import { choice, required } from "../../../shared/domain/validation.js";
import { fail } from "../../../errors.js";

export function validateComment(value) {
  for (const field of ["content", "target_type", "target_id", "visibility"])
    if (typeof value[field] !== "string") fail(422, `${field}: expected text.`);
  required(value.content, "content", 2000);
  choice(value.target_type, ["project", "task", "document", "element"], "target_type");
  choice(value.visibility, ["team", "client"], "visibility");
}
