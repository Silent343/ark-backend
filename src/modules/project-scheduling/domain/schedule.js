import { choice, required } from "../../../shared/domain/validation.js";
import { fail } from "../../../errors.js";

export function validateCalendarEvent(value) {
  for (const field of ["title", "start_at", "end_at", "owner", "category", "location", "notes"])
    if (typeof value[field] !== "string") fail(422, `${field}: expected text.`);
  required(value.title, "title");
  choice(value.category, ["meeting", "deadline", "site_visit"], "category");
  if (Number.isNaN(Date.parse(value.start_at)) || Number.isNaN(Date.parse(value.end_at)) || value.end_at < value.start_at)
    fail(422, "Invalid event date range.");
}

export function validateDependency(value, tasks, edges) {
  if (value.predecessor_id === value.successor_id || !Number.isInteger(value.lag_days) || value.lag_days < 0 || value.lag_days > 365)
    fail(422, "Invalid dependency or lag.");
  if (![value.predecessor_id, value.successor_id].every((id) => tasks.some((task) => task.id === id)))
    fail(422, "Tasks must belong to this project.");
  if (edges.some((edge) => edge.predecessor_id === value.predecessor_id && edge.successor_id === value.successor_id))
    fail(409, "Dependency already exists.");
  const outbound = new Map(tasks.map((task) => [task.id, []]));
  for (const edge of [...edges, value]) outbound.get(edge.predecessor_id).push(edge.successor_id);
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if (outbound.get(id).some(visit)) return true;
    visiting.delete(id); visited.add(id); return false;
  }
  if (tasks.some((task) => visit(task.id))) fail(422, "Task dependencies cannot contain a cycle.");
}
