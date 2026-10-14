import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_FAMILY_KINDS, validateFixtureFamilies } from "../src/modules/plan-digitization/domain/fixture-families.js";

test("family assignments accept compatible types and retain absent source IDs across rebuilding", () => {
  for (const [familyId, kind] of Object.entries(FIXTURE_FAMILY_KINDS)) {
    validateFixtureFamilies({ fixtures:[{id:"f",kind}], fixtureFamilies:{f:{familyId,finish:"dark",elevationM:.35}} });
  }
  validateFixtureFamilies({ fixtureFamilies:{source:{familyId:"sink-wall",finish:"natural",elevationM:0}} });
});
test("family assignment input rejects incompatible or unbounded properties", () => {
  const valid={familyId:"chair-standard",finish:"natural",elevationM:0};
  for(const bad of [null, [], {...valid,familyId:"external-url"}, {...valid,finish:"red"}, {...valid,elevationM:Infinity}, {...valid,elevationM:-1}, {...valid,elevationM:11}, {...valid,modelUrl:"https://example.test/model"}])
    assert.throws(()=>validateFixtureFamilies({fixtureFamilies:{f:bad}}));
  assert.throws(()=>validateFixtureFamilies({fixtures:[{id:"f",kind:"sink"}],fixtureFamilies:{f:valid}}));
});
