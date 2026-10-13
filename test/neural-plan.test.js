import test from "node:test";
import assert from "node:assert/strict";
import {validateCadNeural} from "../src/modules/plan-digitization/domain/neural-plan.js";
const proposal=()=>({regionId:"ground",sourceSignature:"v1-0123456789abcdef",applied:false,
  model:{id:"openbim-m2-unet",revision:"v1.0.0",checkpointSha256:"a".repeat(64),artifactSha256:"b".repeat(64),usage:"experimental-research",classes:["background","wall","door","window"]},
  overlay:"data:image/png;base64,AA==",elapsedMs:100,counts:[262000,100,24,20],
  walls:[{a:[0,0],b:[5,0],thickness:.2,sourceIds:["edge"]}]});
const cad=a=>({regions:[{id:"ground"}],entities:[{id:"edge"}],neural:a});
test("neural proposals retain bounded geometry and model provenance",()=>{
  assert.doesNotThrow(()=>validateCadNeural(cad(undefined)));
  assert.doesNotThrow(()=>validateCadNeural(cad([proposal()])));
});
test("reject malformed, oversized and untraceable neural proposals",()=>{
  for(const patch of [{regionId:"missing"},{sourceSignature:[proposal().sourceSignature]},{applied:"true"},{elapsedMs:NaN},{elapsedMs:180000},
    {counts:[262145,0,0,0]},{walls:[{a:[0,0],b:[Infinity,1],thickness:.2}]},
    {walls:[{a:[0,0],b:[1,1],thickness:2}]},{walls:[{a:[0,0],b:[1,1],thickness:.2,sourceIds:["invented"]}]},
    {model:{...proposal().model,artifactSha256:null}},{model:{...proposal().model,usage:"production-validated"}},
    {model:{...proposal().model,classes:["wall","background","door","window"]}}]) {
    assert.throws(()=>validateCadNeural(cad([{...proposal(),...patch}])));
  }
  assert.throws(()=>validateCadNeural(cad([proposal(),proposal()])));
  assert.throws(()=>validateCadNeural(cad(Array(13).fill(proposal()))));
});
