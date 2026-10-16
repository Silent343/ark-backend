import {test} from "node:test";
import assert from "node:assert/strict";
import {validateRasterNeural} from "../src/modules/plan-digitization/domain/raster-neural.js";
import {trainingEligible,prepareTraining,TRAINING_CLASSES} from "../scripts/prepare-plan-training.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
const model={id:"openbim-m2-unet",revision:"v1.0.0",checkpointSha256:"a".repeat(64),artifactSha256:"b".repeat(64),usage:"experimental-research",classes:["background","wall","door","window"]};
test("image evidence bounds before persistence",()=>{
  const p={version:1,model,sourceSize:{width:600,height:800},overlay:"data:image/png;base64,AA==",elapsedMs:10,counts:[0,20,0,0],walls:[{start:[1,1],end:[50,1],thickness:5}],instances:[]};
  assert.doesNotThrow(()=>validateRasterNeural(p));
  assert.throws(()=>validateRasterNeural({...p,walls:[{...p.walls[0],end:[601,0]}]}));
  assert.throws(()=>validateRasterNeural({...p,instances:[{id:"x",kind:"bed",score:.9,polygon:[[1,1],[2,1],[2,2]]}]}));
  assert.throws(()=>validateRasterNeural({...p,counts:[-1,0,0,0]}));
  assert.throws(()=>validateRasterNeural({...p,sourceRegion:null}));
  assert.throws(()=>validateRasterNeural({...p,sourceRegion:{x:500,y:0,width:200,height:800}}));
  assert.throws(()=>validateRasterNeural({...p,spaces:[]}),"the core wall model has no semantic room head");
});
test("training excludes proposals and group review is explicit",async()=>{
  const task={sourceHash:"a".repeat(64),sourceName:"synthetic-test.dwg",sourceGroup:"test-building",crop:[0,0,10,10],
    shapes:[],annotations:[{id:"one",class:"wall",reviewed:true,geometry:"polygon",points:[[1,1],[9,1],[9,2],[1,2]]}],
    reviewed:true,cropConfirmed:true,viewType:"plan",annotator:"annotator",reviewer:"reviewer",exhaustiveClasses:TRAINING_CLASSES.filter(c=>c!=="background")};
  assert(trainingEligible(task));assert(!trainingEligible({...task,reviewed:false}));
  assert(!trainingEligible({...task,reviewer:"annotator"}));assert(!trainingEligible({...task,exhaustiveClasses:["wall"]}));
  await fs.mkdir(".data/qa",{recursive:true});const folder=await fs.mkdtemp(path.resolve(".data/qa/raster-training-"));
  const source=path.join(folder,"batch.json");await fs.writeFile(source,JSON.stringify({schemaVersion:"ark-review-draft-1",tasks:[task,{...task,reviewed:false}]}));
  const output=path.join(folder,"out");const report=await prepareTraining(source,output);
  assert.equal(report.trainingReady,1);assert.equal(report.pendingReview,1);
  const manifest=JSON.parse(await fs.readFile(path.join(output,"manifest.json"),"utf8"));
  assert.equal(manifest.records[1].mask,null,"unreviewed crops must never become background-only negative samples");
  const {data,info}=await sharp(path.join(output,manifest.records[0].mask)).removeAlpha().raw().toBuffer({resolveWithObject:true});
  for(let i=0;i<data.length;i+=info.channels){const id=data[i]+256*data[i+1]+65536*data[i+2];assert([0,1].includes(id),"panoptic IDs must not be corrupted by antialiasing");}
});
