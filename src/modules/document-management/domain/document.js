import { amount, choice, required } from "../../../shared/domain/validation.js";
import { fail } from "../../../errors.js";

export const documentDefinition = {
  resource: "documents",
  table: "documents",
  fields: ["title", "discipline", "version", "status", "file_name", "file_data", "mime_type", "notes", "previous_version_id"],
  numeric: ["version"],
  validate(value) {
    required(value.title, "title"); required(value.discipline, "discipline");
    amount(value.version, "version", 1);
    if (!Number.isInteger(value.version)) fail(422, "version: use an integer.");
    choice(value.status, ["draft", "in_review", "approved", "changes_requested"], "status");
    required(value.file_name, "file_name"); required(value.mime_type, "mime_type");
    if (typeof value.file_data !== "string" || value.file_data.length > 4_200_000 || (value.file_data && !/^data:(application\/pdf|image\/(png|jpeg|webp));base64,[A-Za-z0-9+/=]+$/.test(value.file_data)))
      fail(422, "file_data: PDF, PNG, JPEG or WebP, maximum 3 MB.");
    if (value.file_data && !value.file_data.startsWith(`data:${value.mime_type};base64,`))
      fail(422, "file_data: MIME type does not match the file.");
  },
};
