/** Frozen, source-disjoint diagnostic. Agent labels are NOT an independent benchmark. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {inferSymbols} from '../src/modules/plan-digitization/infrastructure/symbol-inference.js';
import {validSymbolModel} from '../src/modules/plan-digitization/domain/symbol-contract.js';
import {configuredSymbolModel} from '../src/modules/plan-digitization/infrastructure/symbol-model.js';
export function matchBoxes(predictions,targets,threshold=.5){
 const used=new Set(),matched=[];
 const area=b=>(b[2]-b[0])*(b[3]-b[1]);
 for(const p of [...predictions].sort((a,b)=>b.score-a.score)){
  let best=-1,overlap=0;
  for(let i=0;i<targets.length;i++){const t=targets[i];if(used.has(i)||p.kind!==t.kind)continue;const a=p.box,b=t.box,intersection=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));const iou=intersection/(area(a)+area(b)-intersection);if(iou>=threshold&&iou>overlap){best=i;overlap=iou;}}
  if(best>=0){used.add(best);matched.push({prediction:p.id,target:best,iou:overlap});}
 }
 return {truePositives:matched.length,falsePositives:predictions.length-matched.length,falseNegatives:targets.length-used.size,matched};
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){
 const [labelsFile,output,modelDirectory]=process.argv.slice(2);if(!labelsFile||!output)throw new Error('Usage: node training/evaluate_objects.mjs labels.json .data/evaluation.json [model-directory]');
 const target=path.resolve(output),root=path.resolve('.data');if(!target.startsWith(root+path.sep))throw new Error('Evaluation must stay private');
 const labelBytes=await fs.readFile(labelsFile),labels=JSON.parse(labelBytes);if(labels.schemaVersion!=='ark-object-evaluation-1'||labels.independentValidation!==false)throw new Error('Agent evaluation cannot claim independent validation');
 const configured=configuredSymbolModel(),modelPath=modelDirectory?path.join(modelDirectory,'objects.onnx'):configured?.modelPath;
 const manifest=modelDirectory?JSON.parse(await fs.readFile(path.join(modelDirectory,'manifest.json'),'utf8')):configured?.manifest;
 if(!validSymbolModel(manifest))throw new Error('Unverified model');
 const seen=new Set(manifest.training?.buildingGroups??['vivienda-jardin-reference','larco-local-comercial']);
 if(labels.images.some(i=>seen.has(i.buildingGroup)))throw new Error('Evaluation source was used for training');
 const bytes=await fs.readFile(modelPath);if(createHash('sha256').update(bytes).digest('hex')!==manifest.artifactSha256)throw new Error('Model hash mismatch');
 const session=await ort.InferenceSession.create(bytes,{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1}),results=[];
 try{for(const source of labels.images){const image=await fs.readFile(source.path),meta=await sharp(image).metadata();const prediction=await inferSymbols(image,{width:meta.width,height:meta.height},session,manifest);results.push({id:source.id,buildingGroup:source.buildingGroup,imageSha256:createHash('sha256').update(image).digest('hex'),prediction,metrics:matchBoxes(prediction.items,source.annotations)});}}finally{await session.release();}
 const report={model:manifest.id,artifactSha256:manifest.artifactSha256,labelsSha256:createHash('sha256').update(labelBytes).digest('hex'),annotator:labels.annotator,independentValidation:false,scope:'small source-disjoint diagnostic; not architectural acceptance',iou:.5,results};
 await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify({model:manifest.id,independentValidation:false,results:results.map(r=>({id:r.id,...r.metrics}))}));
}
