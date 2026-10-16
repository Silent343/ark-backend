import { fail } from "../../../errors.js";
import { validateDrawingCoordination } from "./drawing-coordination.js";

/** Bound generated geometry before JSONB persistence and WebGL allocation. Legacy plans need none of these fields. */
export function validateReconstruction(plan) {
  validateDrawingCoordination(plan);
  const invalid = () => fail(422, "Invalid reconstructed geometry.");
  const finite = n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 100000;
  const positive = n => finite(n) && n > 0;
  const levels = new Set(plan.levels.map(l => l.id));
  const polygon = p => Array.isArray(p) && p.length >= 3 && p.length <= 10000 && p.every(v => Array.isArray(v) && v.length === 2 && v.every(finite));
  for(const room of plan.rooms ?? []) if(room.polygon!==undefined || room.holes!==undefined) {
    if(!polygon(room.polygon)||room.polygon.length>256||!Array.isArray(room.holes)||room.holes.length>32||!room.holes.every(h=>polygon(h)&&h.length<=256)) invalid();
  }
  for (const key of ["stairs", "roofs"]) if (plan[key] !== undefined && (!Array.isArray(plan[key]) || plan[key].length > 10000 || plan[key].some(item => !item || typeof item !== "object"))) invalid();
  for (const level of plan.levels) {
    if (level.height !== undefined && (!positive(level.height) || level.height > 100)) invalid();
    if (level.heightSource !== undefined && !["manual", "levels", "assumed"].includes(level.heightSource)) invalid();
  }
  if (plan.intent !== undefined && !["visualization", "coordination", "bim-preparation"].includes(plan.intent)) invalid();
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
    if (!info || !Number.isInteger(info.version) || info.version < 1 || info.version > 6) invalid();
    for (const key of ["pairedWalls", "sourceEdges", "alignedPlans", "namedSpaces"]) if (!Number.isInteger(info[key]) || info[key] < 0 || info[key] > 1_000_000) invalid();
    for (const key of ["fixtureCount", "unresolvedSymbols", "unmatchedOpenings"]) if (info[key] !== undefined && (!Number.isInteger(info[key]) || info[key] < 0 || info[key] > 1_000_000)) invalid();
    if (info.inferredLayers !== undefined && (!Array.isArray(info.inferredLayers) || info.inferredLayers.length > 512 || info.inferredLayers.some(s => typeof s !== "string" || s.length > 300))) invalid();
    if (info.unregisteredRegions !== undefined && (!Array.isArray(info.unregisteredRegions) || info.unregisteredRegions.length > 100 || info.unregisteredRegions.some(id => !plan.cad?.regions.some(r => r.id === id)))) invalid();
  }
  if (plan.elementEvidence !== undefined) {
    const evidence = plan.elementEvidence;
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || Object.keys(evidence).length > 80000 || !plan.cad) invalid();
    const elementIds = new Set(["walls", "doors", "windows", "columns", "stairs", "slabs", "roofs", "fixtures"].flatMap(key => (plan[key] ?? []).map(e => e.id)));
    const sourceIds = new Set(plan.cad.entities.map(e => e.id));
    const regionIds = new Set(plan.cad.regions.map(r => r.id));
    const properties = new Set(["height", "thickness", "material", "sillHeight", "type", "elevation", "slope", "rise"]);
    for (const [id, item] of Object.entries(evidence)) {
      if (!elementIds.has(id) || !item || typeof item !== "object" || Array.isArray(item) || item.sourceName !== plan.cad.sourceName || !regionIds.has(item.regionId) ||
        !["paired-faces", "cad-symbol", "closed-contour", "treads", "cad-text", "neural-mask"].includes(item.method) ||
        !Array.isArray(item.sourceIds) || item.sourceIds.length > 500 || !item.sourceIds.every(id => sourceIds.has(id)) ||
        !Array.isArray(item.assumed) || item.assumed.length > properties.size || !item.assumed.every(key => properties.has(key))) invalid();
    }
  }
}
