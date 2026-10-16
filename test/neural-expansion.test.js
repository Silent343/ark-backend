import test from "node:test";
import assert from "node:assert/strict";
import {decodeNeuralHeads} from "../src/modules/plan-digitization/infrastructure/neural-postprocessing.js";
import {EXPANDED_NEURAL_CLASSES} from "../src/modules/plan-digitization/domain/neural-contract.js";
import {validateCadNeural} from "../src/modules/plan-digitization/domain/neural-plan.js";
test("multitask heads retain learned icons and never turn railings into walls",()=>{
  const rooms=new Float32Array(12*4).fill(-10),icons=new Float32Array(11*4).fill(-10);
  rooms[2*4]=10;rooms[8*4+1]=10;rooms[2]=10;rooms[3]=10;
  icons[0]=10;icons[1]=10;icons[6*4+2]=10;icons[9*4+3]=10;
  const output={rooms:{data:rooms},icons:{data:icons}};
  const result=decodeNeuralHeads(output,{id:"cubicasa-multitask-v1"},2);
  assert.deepEqual([...result.mask],[1,12,7,10]);
  assert.equal(result.counts.length,13);
  assert.deepEqual([...result.spaces.mask],[2,8,0,0]);
  assert.equal(result.spaces.classes[3],"kitchen");
  icons[2*4]=NaN;
  assert.throws(()=>decodeNeuralHeads(output,{id:"cubicasa-multitask-v1"},2),/Non-finite/);
  assert.throws(()=>decodeNeuralHeads({}, {id:"cubicasa-multitask-v1"},2),/shape/);
});
test("space head survives independently of overlapping symbols",()=>{
  const rooms=new Float32Array(12*4).fill(-10),icons=new Float32Array(11*4).fill(-10);
  [3,4,5,6].forEach((label,i)=>{rooms[label*4+i]=10;icons[(i===0?6:0)*4+i]=10;});
  const result=decodeNeuralHeads({rooms:{data:rooms},icons:{data:icons}},{id:"cubicasa-multitask-v1"},2);
  assert.deepEqual([...result.spaces.mask],[3,4,5,6]);
  assert.equal(result.mask[0],7,"sink must not erase the kitchen classification");
});
const model={id:"cubicasa-multitask-v1",revision:"a".repeat(40),checkpointSha256:"b".repeat(64),artifactSha256:"c".repeat(64),usage:"experimental-research",classes:EXPANDED_NEURAL_CLASSES};
const object={id:"instance-0",kind:"sink",polygon:[[0,0],[1,0],[1,1],[0,1]],score:.9,tileIds:["tile-0"],approved:true,heightM:.85};
const proposal=()=>({regionId:"floor",sourceSignature:"v1-0123456789abcdef",applied:true,model,overlay:"data:image/png;base64,AA==",elapsedMs:200000,counts:Array(13).fill(0),
  tiling:{tileSize:512,overlapRatio:.2,tileCount:3,metersPerPixel:.025,complete:true},
  walls:[{a:[0,0],b:[5,0],thickness:.2}],fixtures:[object],
  openings:[{...object,id:"instance-1",kind:"window",hostStatus:"hosted",hostWallIndex:0,center:[2,0],widthM:1,heightM:1.2,sillM:.9}]});
const cad=a=>({entities:[],regions:[{id:"floor"}],neural:[a]});
test("expanded tiled proposals require explicit dimensions and bounded host references",()=>{
  assert.doesNotThrow(()=>validateCadNeural(cad(proposal())));
  for(const patch of [{heightM:undefined},{kind:"railing"},{polygon:[[0,0],[0,0],[0,0]]},{score:Infinity},{tileIds:["invented"]}]){
    assert.throws(()=>validateCadNeural(cad({...proposal(),fixtures:[{...object,...patch}]})));
  }
  for(const patch of [{hostWallIndex:9},{sillM:undefined},{widthM:NaN},{hostStatus:"ambiguous"},{heightM:-1}]){
    const p=proposal();p.openings=[{...p.openings[0],...patch}];
    assert.throws(()=>validateCadNeural(cad(p)));
  }
  assert.throws(()=>validateCadNeural(cad({...proposal(),tiling:{...proposal().tiling,complete:false}})));
  assert.throws(()=>validateCadNeural(cad({...proposal(),model:{...model,classes:["wall"]}})));
});
