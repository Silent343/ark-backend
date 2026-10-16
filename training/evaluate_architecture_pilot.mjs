/** Frozen partial-mask diagnostic. Agent annotations never claim architectural independence. */
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import sharp from 'sharp';import * as ort from 'onnxruntime-node';
import {validNeuralModel} from '../src/modules/plan-digitization/domain/neural-contract.js';
import {decodeNeuralHeads} from '../src/modules/plan-digitization/infrastructure/neural-postprocessing.js';
import {neuralFocus} from '../src/modules/plan-digitization/infrastructure/neural-focus.js';
const [dataset,output,directory='.data/models/cubicasa-multitask-v1']=process.argv.slice(2);
if(!dataset||!output||!path.resolve(output).startsWith(path.resolve('.data')+path.sep))throw new Error('Usage: evaluate_architecture_pilot.mjs .data/package .data/unique-report.json [model-folder]');
const configBytes=await fs.readFile(path.join(dataset,'manifest.json')),data=JSON.parse(configBytes),manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8')),artifact=await fs.readFile(path.join(directory,'model.onnx'));
const hash=b=>createHash('sha256').update(b).digest('hex');
if(data.schemaVersion!=='ark-architecture-pilot-1'||data.independentValidation!==false||!validNeuralModel(manifest)||hash(artifact)!==manifest.artifactSha256)throw new Error('Unverified partial-mask diagnostic');
const session=await ort.InferenceSession.create(artifact,{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1}),results=[],S=512,N=S*S;
const parentManifest=JSON.parse(await fs.readFile('.data/models/cubicasa-multitask-v1/manifest.json','utf8'));
const parentArtifact=await fs.readFile('.data/models/cubicasa-multitask-v1/model.onnx');
if(hash(parentArtifact)!==parentManifest.artifactSha256)throw new Error('Changed reference model');
const parentSession=manifest.artifactSha256===parentManifest.artifactSha256?session:await ort.InferenceSession.create(parentArtifact,{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1});
let openingSession,openingManifest;
if(manifest.training?.openingArtifactSha256){
 openingManifest=JSON.parse(await fs.readFile('.data/models/ark-architecture-pilot-v1/manifest.json','utf8'));
 const bytes=await fs.readFile('.data/models/ark-architecture-pilot-v1/model.onnx');
 if(hash(bytes)!==manifest.training.openingArtifactSha256||hash(bytes)!==openingManifest.artifactSha256)throw new Error('Changed preserved opening branch reference');
 openingSession=await ort.InferenceSession.create(bytes,{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1});
}
const metric=m=>({...m,iou:m.tp/(m.tp+m.fp+m.fn||1),recall:m.tp/(m.tp+m.fn||1),precision:m.tp/(m.tp+m.fp||1)});
try{for(const row of data.records.filter(r=>r.id.endsWith('-0-0'))){
 for(const key of ['image','rooms','icons'])if(hash(await fs.readFile(path.join(dataset,row[key])))!==row[key+'Sha256'])throw new Error('Changed architecture diagnostic asset');
 if(row.split==='diagnostic'&&manifest.training?.buildingGroups.includes(row.buildingGroup))throw new Error('Architecture diagnostic source leaked into training');
 const image=await fs.readFile(path.join(dataset,row.image)),meta=await sharp(image).metadata(),size={width:meta.width,height:meta.height};
 const infer=async (region,reference=false)=>{
  const k=Math.min(S/region.width,S/region.height),w=Math.round(region.width*k),h=Math.round(region.height*k),x=Math.floor((S-w)/2),y=Math.floor((S-h)/2);
  const rgb=await sharp(image).extract({left:region.x,top:region.y,width:region.width,height:region.height}).removeAlpha().resize(w,h).extend({left:x,top:y,right:S-w-x,bottom:S-h-y,background:'#fff'}).raw().toBuffer(),input=new Float32Array(3*N);
  for(let i=0;i<N;i++)for(let c=0;c<3;c++)input[c*N+i]=rgb[3*i+c]/127.5-1;
  const outputs=await (reference==='opening'?openingSession:reference?parentSession:session).run({image:new ort.Tensor('float32',input,[1,3,S,S])});
  return {...decodeNeuralHeads(outputs,reference==='opening'?openingManifest:reference?parentManifest:manifest),roomLogits:outputs.rooms.data,iconLogits:outputs.icons.data,content:{x,y,width:w,height:h}};
 };
 // Freeze the parent-derived focus for both models: a candidate cannot change
 // the sampling region and thereby change which reference pixels are scored.
 let region={x:0,y:0,...size},parent=await infer(region,true);
 const focus=neuralFocus(parent,parent.content,size);if(focus){region=focus;parent=await infer(region,true);}
 const reading=parentSession===session?parent:await infer(region);
 let roomHeadMaxAbsoluteDifference=0;
 if(manifest.training?.preserveRooms){
  for(let i=0;i<parent.roomLogits.length;i++)roomHeadMaxAbsoluteDifference=Math.max(roomHeadMaxAbsoluteDifference,Math.abs(parent.roomLogits[i]-reading.roomLogits[i]));
  if(roomHeadMaxAbsoluteDifference>1e-4)throw new Error('Original room branch changed during opening-only training');
 }
 let openingHeadMaxAbsoluteDifference=0;
 if(openingSession){
  const retained=await infer(region,'opening');
  for(let i=0;i<retained.iconLogits.length;i++)openingHeadMaxAbsoluteDifference=Math.max(openingHeadMaxAbsoluteDifference,Math.abs(retained.iconLogits[i]-reading.iconLogits[i]));
  if(openingHeadMaxAbsoluteDifference>1e-4)throw new Error('Opening branch changed during room-only training');
 }
 const [rooms,icons]=await Promise.all(['rooms','icons'].map(async k=>sharp(await fs.readFile(path.join(dataset,row[k]))).removeAlpha().greyscale().raw().toBuffer()));
 const floor={tp:0,fp:0,fn:0},window={tp:0,fp:0,fn:0},c=reading.content,overlay=Buffer.alloc(N*4);
 for(let y=c.y;y<c.y+c.height;y++)for(let x=c.x;x<c.x+c.width;x++){
  const i=y*S+x,sx=Math.min(size.width-1,Math.floor(region.x+(x+.5-c.x)*region.width/c.width)),sy=Math.min(size.height-1,Math.floor(region.y+(y+.5-c.y)*region.height/c.height)),at=sy*size.width+sx;
  const label=reading.spaces.mask[i],coverage=reading.spaces.coverageScores[i],floorPred=![0,2,8].includes(label)&&coverage>=140&&!(reading.mask[i]===1&&reading.scores[i]>=140),windowPred=reading.mask[i]===3&&reading.scores[i]>=153;
  if(rooms[at]!==255){const truth=![0,2,8].includes(rooms[at]);if(truth&&floorPred)floor.tp++;else if(truth)floor.fn++;else if(floorPred)floor.fp++;}
  if(icons[at]!==255){const truth=icons[at]===1;if(truth&&windowPred)window.tp++;else if(truth)window.fn++;else if(windowPred)window.fp++;}
  const color=windowPred?[15,130,220,210]:reading.mask[i]===2&&reading.scores[i]>=153?[210,90,30,150]:floorPred?[67,147,102,90]:[0,0,0,0];for(let k=0;k<4;k++)overlay[i*4+k]=color[k];
 }
 const proof=output.replace(/\.json$/,'')+'-'+row.sourceId+'.png';
 const layer=await sharp(overlay,{raw:{width:S,height:S,channels:4}}).extract({left:c.x,top:c.y,width:c.width,height:c.height}).resize(region.width,region.height).png().toBuffer();
 await fs.writeFile(proof,await sharp(image).composite([{input:layer,left:region.x,top:region.y}]).png().toBuffer(),{flag:'wx'});
 results.push({source:row.sourceId,buildingGroup:row.buildingGroup,split:row.split,scope:row.split==='train'?'training-source demonstration':'source-disjoint partial-mask diagnostic',region,...(manifest.training?.preserveRooms?{roomHeadMaxAbsoluteDifference}:{}),...(openingSession?{openingHeadMaxAbsoluteDifference}:{}),floor:metric(floor),window:metric(window),overlay:path.basename(proof)});
}}finally{await session.release();if(parentSession!==session)await parentSession.release();if(openingSession)await openingSession.release();}
const report={model:manifest.id,artifactSha256:manifest.artifactSha256,labelsSha256:hash(configBytes),regionPolicy:'frozen pinned-parent focus; identical sampling for every candidate',independentValidation:false,annotationQuality:'agent-provisional',results};
await fs.writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));
