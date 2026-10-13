import test from "node:test";
import assert from "node:assert/strict";
import { validateReconstruction } from "../src/modules/plan-digitization/domain/reconstruction.js";

const plan = () => ({ levels: [{ id: "ground", height: 3.33 }], columns: [], slabs: [{ id: "slab", levelId: "ground", polygon: [[0, 0], [10, 0], [10, 8], [0, 8]], holes: [[[2, 2], [3, 2], [3, 3], [2, 3]]], thickness: .18 }], floorDetails: [{ levelId: "ground", segments: [0, 0, 2, 2] }] });
test("reconstruction accepts metric contours, voids and finite linework", () => assert.doesNotThrow(() => validateReconstruction(plan())));
test("reconstruction rejects malformed and unbounded GPU data", () => {
  for (const mutate of [p => { p.slabs[0].polygon[0][0] = NaN; }, p => { p.slabs[0].levelId = "missing"; }, p => { p.slabs[0].holes = [[]]; }, p => { p.floorDetails[0].segments.push(1); }, p => { p.stairs = [{ stepCount: 100000 }]; }, p => { p.levels[0].height = Infinity; }]) {
    const p = plan(); mutate(p); assert.throws(() => validateReconstruction(p));
  }
});

test("v3 evidence is bounded and versioned", () => {
  const p=plan();p.reconstruction={version:3,pairedWalls:4,sourceEdges:8,alignedPlans:1,namedSpaces:1,fixtureCount:2,unresolvedSymbols:3,inferredLayers:["2"]};
  assert.doesNotThrow(()=>validateReconstruction(p));
  for(const patch of [{version:4},{fixtureCount:-1},{inferredLayers:[null]}]) assert.throws(()=>validateReconstruction({...p,reconstruction:{...p.reconstruction,...patch}}));
});
