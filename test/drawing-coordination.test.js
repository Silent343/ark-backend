import test from "node:test";
import assert from "node:assert/strict";
import { validateDrawingCoordination } from "../src/modules/plan-digitization/domain/drawing-coordination.js";

const record = () => ({id:"link", source:{kind:"cad",viewId:"cut-aa",textId:"text-1",signature:"v1-0123456789abcdef"},
  targetId:"wall-1", targetSignature:"v1-0123456789abcdef", property:"height", valueM:3.2, quote:"ALTURA LIBRE = 3.20 m", confirmedAt:"2026-10-13T12:00:00.000Z"});
test("correspondences survive source deletion as reviewable assertions", () => {
  assert.doesNotThrow(() => validateDrawingCoordination({correspondences:[record()]}));
  assert.doesNotThrow(() => validateDrawingCoordination({sheets:[{viewType:"section"}], correspondences:[{...record(), property:"sillHeight", valueM:0}]}));
});
test("reject malformed, duplicate and unbounded correspondence records", () => {
  for (const patch of [{valueM:NaN},{valueM:-2},{valueM:0},{valueM:101},{property:"storeys"},
    {source:{...record().source,kind:"external",signature:"guess"}},{confirmedAt:"invalid"},{quote:"x".repeat(201)}, {targetSignature:null}, {targetSignature:[record().targetSignature]}]) {
    assert.throws(() => validateDrawingCoordination({correspondences:[{...record(),...patch}]}));
  }
  assert.throws(() => validateDrawingCoordination({correspondences:[record(),record()]}));
  assert.throws(() => validateDrawingCoordination({sheets:[{viewType:"perspective"}]}));
  assert.throws(() => validateDrawingCoordination({correspondences:Array(2001).fill(record())}));
});
