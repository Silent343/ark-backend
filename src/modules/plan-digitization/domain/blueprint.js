import { fail } from "../../../errors.js";

export function validateBlueprint(geometry, projectId) {
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry) || geometry.projectId !== projectId)
    fail(422, "Invalid plan.");
  for (const key of ["width", "height"])
    if (typeof geometry[key] !== "number" || !Number.isFinite(geometry[key]) || geometry[key] <= 0 || geometry[key] > 100000)
      fail(422, "Invalid plan dimensions.");
  for (const key of ["levels", "rooms", "walls", "doors", "windows", "columns"])
    if (!Array.isArray(geometry[key]) || geometry[key].length > 10000) fail(422, "Invalid plan elements.");
  for (const wall of geometry.walls) {
    const legacy = Array.isArray(wall?.start) && Array.isArray(wall?.end) && wall.start.length === 2 && wall.end.length === 2 && [...wall.start, ...wall.end].every(Number.isFinite);
    const scalar = [wall?.x1, wall?.y1, wall?.x2, wall?.y2].every(Number.isFinite);
    if (!wall || typeof wall.id !== "string" || (!legacy && !scalar)) fail(422, "Invalid plan elements.");
  }
}
