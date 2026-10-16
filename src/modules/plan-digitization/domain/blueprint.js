import { fail } from "../../../errors.js";
import { validateCadPlan } from "./cad-plan.js";
import { validateReconstruction } from "./reconstruction.js";
import { validateFixtureFamilies } from "./fixture-families.js";
import { validateRasterNeural } from "./raster-neural.js";
import { validSourceCalibration } from "./source-calibration.js";

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
  if (geometry.cad !== undefined) validateCadPlan(geometry.cad);
  validateReconstruction(geometry);
  for (const sheet of geometry.sheets ?? []) {
    if(sheet.sourceCalibration!==undefined&&!validSourceCalibration(sheet.sourceCalibration,sheet.metersPerUnit))fail(422,'Invalid source calibration.');
    if(sheet.neural !== undefined) validateRasterNeural(sheet.neural);
    if(sheet.analysisImage!==undefined && (typeof sheet.analysisImage!=='string'||sheet.analysisImage.length>4_200_000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(sheet.analysisImage)))fail(422,'Invalid analysis image.');
  }
  if (geometry.fixtures !== undefined) {
    if (!Array.isArray(geometry.fixtures) || geometry.fixtures.length > 10000) fail(422, "Invalid CAD fixtures.");
    for (const item of geometry.fixtures) {
      if (!item || typeof item.id !== "string" || !geometry.levels.some(l=>l.id===item.levelId) ||
        ![item.x,item.y,item.width,item.depth,item.height].every(Number.isFinite) || item.width <= 0 || item.depth <= 0 || item.height <= 0)
        fail(422, "Invalid CAD fixtures.");
      if (item.rotation !== undefined && (!Number.isFinite(item.rotation) || Math.abs(item.rotation) > 36000)) fail(422, "Invalid fixture rotation.");
      if (item.kind !== undefined && !["chair","table","bed","sofa","toilet","sink","cabinet","equipment","plant","vehicle","bench","bathtub","fireplace","chimney"].includes(item.kind)) fail(422, "Invalid fixture kind.");
      if (item.evidence !== undefined && !["block","repeated-symbol","neural-mask","neural-box"].includes(item.evidence)) fail(422, "Invalid fixture evidence.");
      if (item.sourceIds !== undefined && (!Array.isArray(item.sourceIds) || item.sourceIds.length > 500 || item.sourceIds.some(s => typeof s !== "string" || s.length > 150))) fail(422, "Invalid fixture sources.");
    }
  }
  validateFixtureFamilies(geometry);
}
