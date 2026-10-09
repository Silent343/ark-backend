import { fail } from "../../errors.js";

export function checkVersion(request, row) {
  const raw = request.headers["if-match"];
  if (!raw) fail(428, "Reload the resource before editing.");
  if (String(raw).replace(/^"|"$/g, "") !== row.updated_at)
    fail(409, "This item has changed. Reload before saving again.");
}

export function nextRevision(previous) {
  return new Date(Math.max(Date.now(), previous ? Date.parse(previous.updated_at) + 1 : 0)).toISOString();
}
