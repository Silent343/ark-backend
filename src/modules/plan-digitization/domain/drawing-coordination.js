import { fail } from "../../../errors.js";

/** Retain stale links for explicit review; a saved assertion is never authority to apply it to changed geometry. */
export function validateDrawingCoordination(plan) {
  const invalid = () => fail(422, "Invalid drawing correspondence.");
  const views = ["plan", "section", "elevation", "schedule", "detail"];
  if (plan.sheets !== undefined && (!Array.isArray(plan.sheets) || plan.sheets.length > 24)) invalid();
  for (const item of [...(plan.cad?.regions ?? []), ...(plan.sheets ?? [])]) {
    if (!item || item.viewType !== undefined && !views.includes(item.viewType)) invalid();
  }
  const records = plan.correspondences;
  if (records === undefined) return;
  if (!Array.isArray(records) || records.length > 2000) invalid();
  const ids = new Set();
  const string = (s, max) => typeof s === "string" && s.length > 0 && s.length <= max;
  for (const r of records) {
    if (!r || typeof r !== "object" || !string(r.id, 150) || ids.has(r.id) ||
      !r.source || !["cad", "sheet"].includes(r.source.kind) ||
      !string(r.source.viewId, 150) || !string(r.source.textId, 150) ||
      typeof r.source.signature !== "string" || !/^v1-[\da-f]{16}$/.test(r.source.signature) || typeof r.targetSignature !== "string" || !/^v1-[\da-f]{16}$/.test(r.targetSignature) ||
      !string(r.targetId, 150) || !string(r.quote, 200) || !["height", "sillHeight"].includes(r.property) ||
      !Number.isFinite(r.valueM) || r.valueM > 100 || !(r.valueM > 0 || r.property === "sillHeight" && r.valueM === 0) ||
      !string(r.confirmedAt, 40) || !Number.isFinite(Date.parse(r.confirmedAt))) invalid();
    ids.add(r.id);
  }
}
