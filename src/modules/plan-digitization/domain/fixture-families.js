import { fail } from "../../../errors.js";

export const FIXTURE_FAMILY_KINDS = Object.freeze({
  "chair-standard":"chair", "chair-auditorium":"chair", "chair-office":"chair",
  "table-rectangular":"table", "table-round":"table", "sofa-two":"sofa", "sofa-three":"sofa",
  "bed-single":"bed", "bed-double":"bed", "toilet-floor":"toilet", "toilet-wall":"toilet",
  "sink-vanity":"sink", "sink-pedestal":"sink", "sink-wall":"sink",
  "cabinet-base":"cabinet", "cabinet-tall":"cabinet", "bench-timber":"bench",
  "bathtub-inset":"bathtub", "bathtub-free":"bathtub", "fireplace-built-in":"fireplace",
  "chimney-masonry":"chimney", "equipment-generic":"equipment", "plant-potted":"plant", "vehicle-compact":"vehicle",
});

export function validateFixtureFamilies(geometry) {
  const assignments = geometry.fixtureFamilies;
  if (assignments === undefined) return;
  if (!assignments || typeof assignments !== "object" || Array.isArray(assignments) || Object.keys(assignments).length > 10000)
    fail(422, "Invalid fixture family assignments.");
  const fixtures = new Map((Array.isArray(geometry.fixtures) ? geometry.fixtures : []).map(f => [f.id, f]));
  for (const [id, selection] of Object.entries(assignments)) {
    if (!id || id.length > 200 || !selection || typeof selection !== "object" || Array.isArray(selection)
      || Object.keys(selection).some(k => !["familyId", "finish", "elevationM"].includes(k))
      || typeof selection.familyId !== "string" || !Object.hasOwn(FIXTURE_FAMILY_KINDS, selection.familyId)
      || !["natural","light","dark"].includes(selection.finish)
      || typeof selection.elevationM !== "number" || !Number.isFinite(selection.elevationM) || selection.elevationM < 0 || selection.elevationM > 10)
      fail(422, "Invalid fixture family assignment.");
    const fixture = fixtures.get(id);
    if (fixture && fixture.kind !== FIXTURE_FAMILY_KINDS[selection.familyId])
      fail(422, "Fixture family does not match the element category.");
  }
}
