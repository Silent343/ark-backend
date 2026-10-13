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
  for(const patch of [{version:7},{fixtureCount:-1},{inferredLayers:[null]}]) assert.throws(()=>validateReconstruction({...p,reconstruction:{...p.reconstruction,...patch}}));
});

test("v4 traces geometry to existing CAD evidence and explicit assumptions", () => {
  const p = plan();
  p.intent = "coordination";
  p.levels[0].heightSource = "manual";
  p.cad = {sourceName:"test.dwg", entities:[{id:"edge"}], regions:[{id:"view"}]};
  p.elementEvidence = {slab:{sourceName:"test.dwg",regionId:"view",sourceIds:["edge"],method:"closed-contour",assumed:["thickness","material"]}};
  p.reconstruction = {version:4,pairedWalls:0,sourceEdges:1,alignedPlans:1,namedSpaces:0,unmatchedOpenings:0,unregisteredRegions:["view"]};
  assert.doesNotThrow(()=>validateReconstruction(p));
  for (const patch of [{sourceIds:["invented"]},{regionId:"missing"},{sourceName:"other.dwg"},{method:"AI-verified"},{assumed:["anything"]}]) {
    assert.throws(()=>validateReconstruction({...p,elementEvidence:{slab:{...p.elementEvidence.slab,...patch}}}));
  }
  assert.throws(()=>validateReconstruction({...p,elementEvidence:{missing:p.elementEvidence.slab}}));
  assert.throws(()=>validateReconstruction({...p,levels:[{id:"ground",height:3,heightSource:"detected"}]}));
  assert.throws(()=>validateReconstruction({...p,reconstruction:{...p.reconstruction,unregisteredRegions:["missing"]}}));
});
