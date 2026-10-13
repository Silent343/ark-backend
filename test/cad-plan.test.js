import assert from "node:assert/strict";
import {test} from "node:test";
import {validateCadPlan} from "../src/modules/plan-digitization/domain/cad-plan.js";

const plan=()=>({sourceName:"plan.dwg",entities:[{id:"a",kind:"path",layer:"walls",color:"#374151",points:[0,0,10,10],closed:false}],layers:[{name:"walls",role:"wall",visible:true,count:1}],bounds:{minX:0,minY:0,maxX:10,maxY:10},metersPerCadUnit:1,unitConfirmed:true,regions:[]});
test("CAD trust boundary accepts vector geometry and rejects malformed edits",()=>{
  assert.doesNotThrow(()=>validateCadPlan(plan()));
  for(const mutate of [p=>p.entities[0].points.push(NaN),p=>p.entities.push({...p.entities[0]}),p=>p.entities[0].layer="missing",p=>p.metersPerCadUnit=0,p=>p.layers[0].role="script",p=>p.regions.push({id:"bad",name:"bad",minX:10,minY:0,maxX:0,maxY:10,elevation:0,repeat:1,enabled:true})]){
    const value=plan();mutate(value);assert.throws(()=>validateCadPlan(value));
  }
});

test("CAD block evidence cannot bypass role and size validation",()=>{
  const p=plan();p.entities[0].blockName="cama doble";p.entities[0].role="furniture";
  assert.doesNotThrow(()=>validateCadPlan(p));
  p.entities[0].role="unknown";assert.throws(()=>validateCadPlan(p));
  p.entities[0].role="furniture";p.entities[0].blockName="x".repeat(301);assert.throws(()=>validateCadPlan(p));
});

test("per-view heights and registration corrections are bounded",()=>{
  const p=plan();
  p.regions=[{id:"view",name:"Auditorio",minX:0,minY:0,maxX:10,maxY:10,elevation:-3,elevationSource:"manual",repeat:1,enabled:true,wallHeight:9.6,alignment:{x:1.5,y:-.5}}];
  assert.doesNotThrow(()=>validateCadPlan(p));
  for(const patch of [{wallHeight:0},{wallHeight:Infinity},{wallHeight:101},{alignment:{x:NaN,y:0}},{alignment:{x:0}},{elevationSource:"AI"}]) assert.throws(()=>validateCadPlan({...p,regions:[{...p.regions[0],...patch}]}));
});
