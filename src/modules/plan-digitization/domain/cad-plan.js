import { fail } from "../../../errors.js";
import {validateCadNeural} from "./neural-plan.js";

/** Bound CAD payloads before persisting JSONB or handing entities to a renderer/exporter. */
export function validateCadPlan(plan) {
  const invalid = () => fail(422, "Invalid CAD drawing.");
  const number = (value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e9;
  const bounds = (b) => b && [b.minX,b.minY,b.maxX,b.maxY].every(number) && b.maxX > b.minX && b.maxY > b.minY;
  const roles = new Set(["reference","wall","door","window","column","stair","furniture","roof","electrical","plumbing"]);
  if (!plan || typeof plan !== "object" || typeof plan.sourceName !== "string" || plan.sourceName.length > 300 ||
    !Array.isArray(plan.entities) || plan.entities.length > 220000 ||
    !Array.isArray(plan.layers) || plan.layers.length > 512 || !bounds(plan.bounds) ||
    !number(plan.metersPerCadUnit) || plan.metersPerCadUnit <= 0 || plan.metersPerCadUnit > 1000 ||
    typeof plan.unitConfirmed !== "boolean" || !Array.isArray(plan.regions) || plan.regions.length > 100) invalid();
  const layers = new Set();
  for (const layer of plan.layers) {
    if (!layer || typeof layer.name !== "string" || layer.name.length > 300 || layers.has(layer.name) ||
      typeof layer.visible !== "boolean" || !roles.has(layer.role)) invalid();
    layers.add(layer.name);
  }
  const ids = new Set();
  for (const entity of plan.entities) {
    if (!entity || typeof entity.id !== "string" || entity.id.length > 150 || ids.has(entity.id) || !layers.has(entity.layer) ||
      typeof entity.color !== "string" || !/^(#[\da-f]{6}|rgb\(\d{1,3},\d{1,3},\d{1,3}\))$/i.test(entity.color) ||
      (entity.group !== undefined && (typeof entity.group !== "string" || entity.group.length > 150))) invalid();
    ids.add(entity.id);
    if (entity.blockName !== undefined && (typeof entity.blockName !== "string" || entity.blockName.length > 300)) invalid();
    if (entity.role !== undefined && !roles.has(entity.role)) invalid();
    if (entity.kind === "path") {
      if (!Array.isArray(entity.points) || entity.points.length < 4 || entity.points.length > 512 || entity.points.length % 2 || !entity.points.every(number) || typeof entity.closed !== "boolean") invalid();
    } else if (entity.kind === "circle") {
      if (![entity.x,entity.y,entity.radius].every(number) || entity.radius <= 0) invalid();
    } else if (entity.kind === "text") {
      if (![entity.x,entity.y,entity.height,entity.rotation].every(number) || entity.height <= 0 || typeof entity.value !== "string" || entity.value.length > 200) invalid();
    } else invalid();
  }
  const regionIds = new Set();
  for (const region of plan.regions) {
    if (region?.viewType !== undefined && !["plan", "section", "elevation", "schedule", "detail"].includes(region.viewType)) invalid();
    if (!region || !bounds(region) || typeof region.id !== "string" || regionIds.has(region.id) || typeof region.name !== "string" || region.name.length > 200 ||
      !number(region.elevation) || Math.abs(region.elevation) > 1000 || typeof region.enabled !== "boolean" || !Number.isInteger(region.repeat) || region.repeat < 1 || region.repeat > 20) invalid();
    regionIds.add(region.id);
    if (region.elevationSource !== undefined && !["annotation", "manual"].includes(region.elevationSource)) invalid();
    if (region.wallHeight !== undefined && (!number(region.wallHeight) || region.wallHeight <= 0 || region.wallHeight > 100)) invalid();
    if (region.alignment !== undefined && (!region.alignment || ![region.alignment.x, region.alignment.y].every(v => number(v) && Math.abs(v) <= 100000))) invalid();
    if (region.elevations !== undefined && (!Array.isArray(region.elevations) || region.elevations.length > 20 || !region.elevations.every(e => number(e) && Math.abs(e) <= 1000))) invalid();
  }
  validateCadNeural(plan);
}
