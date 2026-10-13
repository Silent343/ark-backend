import { fail } from "../../../errors.js";

/** Bound generated geometry before JSONB persistence and WebGL allocation. Legacy plans need none of these fields. */
export function validateReconstruction(plan) {
  const invalid = () => fail(422, "Invalid reconstructed geometry.");
  const finite = n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 100000;
  const positive = n => finite(n) && n > 0;
  const levels = new Set(plan.levels.map(l => l.id));
  const polygon = p => Array.isArray(p) && p.length >= 3 && p.length <= 10000 && p.every(v => Array.isArray(v) && v.length === 2 && v.every(finite));
  for (const key of ["stairs", "roofs"]) if (plan[key] !== undefined && (!Array.isArray(plan[key]) || plan[key].length > 10000 || plan[key].some(item => !item || typeof item !== "object"))) invalid();
  for (const level of plan.levels) if (level.height !== undefined && (!positive(level.height) || level.height > 100)) invalid();
  for (const column of plan.columns) {
    for (const key of ["height", "depth"]) if (column[key] !== undefined && !positive(column[key])) invalid();
    if (column.rotation !== undefined && !finite(column.rotation)) invalid();
  }
  for (const stair of plan.stairs ?? []) {
    if (stair.rise !== undefined && (!positive(stair.rise) || stair.rise > 100)) invalid();
    if (stair.baseElevation !== undefined && (!finite(stair.baseElevation) || stair.baseElevation < 0)) invalid();
    if (stair.stepCount !== undefined && (!Number.isInteger(stair.stepCount) || stair.stepCount < 1 || stair.stepCount > 200)) invalid();
  }
  for (const roof of plan.roofs ?? []) if (roof.polygon !== undefined && !polygon(roof.polygon)) invalid();
  if (plan.slabs !== undefined) {
    if (!Array.isArray(plan.slabs) || plan.slabs.length > 10000) invalid();
    const ids = new Set();
    for (const slab of plan.slabs) {
      if (!slab || typeof slab.id !== "string" || ids.has(slab.id) || !levels.has(slab.levelId) || !polygon(slab.polygon) ||
        !Array.isArray(slab.holes) || slab.holes.length > 200 || !slab.holes.every(polygon) || !positive(slab.thickness) || slab.thickness > 2) invalid();
      ids.add(slab.id);
    }
  }
  if (plan.floorDetails !== undefined) {
    if (!Array.isArray(plan.floorDetails) || plan.floorDetails.length > 2000) invalid();
    let coordinates = 0;
    for (const detail of plan.floorDetails) {
      if (!detail || !levels.has(detail.levelId) || !Array.isArray(detail.segments) || detail.segments.length % 4 || !detail.segments.every(finite)) invalid();
      coordinates += detail.segments.length;
    }
    if (coordinates > 4_000_000) invalid();
  }
  if (plan.reconstruction !== undefined) {
    const info = plan.reconstruction;
    if (!info || !Number.isInteger(info.version) || info.version < 1 || info.version > 3) invalid();
    for (const key of ["pairedWalls", "sourceEdges", "alignedPlans", "namedSpaces"]) if (!Number.isInteger(info[key]) || info[key] < 0 || info[key] > 1_000_000) invalid();
    for (const key of ["fixtureCount", "unresolvedSymbols"]) if (info[key] !== undefined && (!Number.isInteger(info[key]) || info[key] < 0 || info[key] > 1_000_000)) invalid();
    if (info.inferredLayers !== undefined && (!Array.isArray(info.inferredLayers) || info.inferredLayers.length > 512 || info.inferredLayers.some(s => typeof s !== "string" || s.length > 300))) invalid();
  }
}
