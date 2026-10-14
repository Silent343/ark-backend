import test from "node:test";
import assert from "node:assert/strict";
import { validateCadPlan } from "../src/modules/plan-digitization/domain/cad-plan.js";

const drawing = () => ({ sourceName:"test.dwg", metersPerCadUnit:1, unitConfirmed:true, bounds:{minX:0,minY:0,maxX:10,maxY:10}, layers:[{name:"geometry",visible:true,role:"reference"}], regions:[], entities:[{id:"edge",kind:"path",points:[0,0,10,0],closed:false,color:"#000000",layer:"geometry",role:"wall"}] });
test("CAD classifications preserve explicit origin without breaking legacy drawings", () => {
  for (const roleSource of [undefined,"geometry","name","manual"]) {
    const plan=drawing();plan.entities[0].roleSource=roleSource;
    assert.doesNotThrow(()=>validateCadPlan(plan));
  }
});
test("CAD classification origins reject unsupported metadata and absent roles", () => {
  const invalid=drawing();invalid.entities[0].roleSource="architecturally-certified";
  assert.throws(()=>validateCadPlan(invalid));
  invalid.entities[0].roleSource="manual";delete invalid.entities[0].role;
  assert.throws(()=>validateCadPlan(invalid));
});
