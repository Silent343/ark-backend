import {parentPort,workerData} from "node:worker_threads";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import {decodeNeuralHeads} from "./neural-postprocessing.js";
import {neuralFocus} from "./neural-focus.js";
import {inferSymbols} from "./symbol-inference.js";
import {architectureTiles} from './architecture-tiles.js';

// One resident session. Switching models releases native memory first.
let cached;
async function loadModel(modelId) {
  if(cached?.manifest.id===modelId)return cached;
  const descriptor=workerData.models.find(m=>m.manifest.id===modelId);
  if(!descriptor)throw new Error("El modelo solicitado no está instalado.");
  if(cached){await cached.session.release();cached=undefined;}
  const artifact=await readFile(descriptor.modelPath);
  if(createHash("sha256").update(artifact).digest("hex")!==descriptor.manifest.artifactSha256)throw new Error("Neural artifact checksum mismatch.");
  const session=await ort.InferenceSession.create(artifact,{executionProviders:["cpu"],intraOpNumThreads:2,interOpNumThreads:1,graphOptimizationLevel:"all"});
  cached={session,manifest:descriptor.manifest};return cached;
}
const S=512,N=S*S;
const colors=[[255,255,255],[43,119,219],[232,146,49],[41,172,148],[151,105,65],[140,115,190],[73,163,187],[75,174,157],[195,148,81],[190,100,85],[75,160,207],[145,145,145],[110,132,150]];
const spaceColors=[[255,255,255],[136,177,111],[255,255,255],[225,193,125],[170,193,210],[196,166,195],[150,209,205],[207,204,186],[255,255,255],[198,184,155],[190,185,178],[218,211,189]];
parentPort.postMessage({ready:true});
parentPort.on("message",async({id,image,modelId,focus=false,symbols=false,details=false,symbolModelId})=>{
  try {
    const started=performance.now(),focusModelId=focus&&modelId==='ark-architecture-pilot-v2'?'cubicasa-multitask-v1':modelId;
    let {session,manifest}=await loadModel(focusModelId);
    const bytes=Buffer.from(image.split(",")[1],"base64"),metadata=await sharp(bytes,{limitInputPixels:16_000_000}).metadata();
    if(!metadata.width||!metadata.height||metadata.width>6000||metadata.height>6000)throw new Error("Image dimensions exceed neural inference limits.");
    const sourceSize={width:metadata.width,height:metadata.height};
    const infer=async region=> {
    const scale=Math.min(S/region.width,S/region.height),w=manifest.preprocessing.letterbox?Math.max(1,Math.round(region.width*scale)):S,h=manifest.preprocessing.letterbox?Math.max(1,Math.round(region.height*scale)):S;
    const left=Math.floor((S-w)/2),top=Math.floor((S-h)/2);
    const rgb=await sharp(bytes,{limitInputPixels:16_000_000}).extract({left:region.x,top:region.y,width:region.width,height:region.height}).flatten({background:"#ffffff"}).toColourspace("srgb").removeAlpha().resize(w,h,{fit:"fill"}).extend({left,top,right:S-w-left,bottom:S-h-top,background:"#ffffff"}).raw().toBuffer();
    const input=new Float32Array(3*N),{mean,std}=manifest.preprocessing;
    for(let i=0;i<N;i++)for(let c=0;c<3;c++)input[c*N+i]=(rgb[3*i+c]/255-mean[c])/std[c];
    const outputs=await session.run({image:new ort.Tensor("float32",input,[1,3,S,S])});
    const decoded=decodeNeuralHeads(outputs,manifest);
    for(let i=0;i<N;i++) {
      const x=i%S,y=Math.floor(i/S);
      if(x<left||x>=left+w||y<top||y>=top+h){decoded.counts[decoded.mask[i]]--;decoded.mask[i]=0;decoded.scores[i]=0;if(decoded.spaces){decoded.spaces.mask[i]=0;decoded.spaces.scores[i]=0;}}
    }
    return {...decoded,rgb,content:{x:left,y:top,width:w,height:h}};
    };
    let sourceRegion={x:0,y:0,...sourceSize},reading=await infer(sourceRegion),passes=1;
    if(focus===true) {
      const region=neuralFocus(reading,reading.content,sourceSize);
      if(region)sourceRegion=region;
      if(focusModelId!==modelId){({session,manifest}=await loadModel(modelId));reading=await infer(sourceRegion);passes=2;}
      else if(region){reading=await infer(region);passes=2;}
    }
    const detailReadings=[];
    if(details)for(const region of architectureTiles(sourceRegion)){
      const tile=await infer(region);passes++;
      detailReadings.push({content:tile.content,sourceRegion:region,mask:tile.mask.toString('base64'),scores:tile.scores.toString('base64')});
    }
    const {mask,scores,counts,spaces,rgb,content}=reading,overlay=Buffer.from(rgb);
    for(let i=0;i<N;i++){
      const x=i%S,y=Math.floor(i/S);
      if(x<content.x||x>=content.x+content.width||y<content.y||y>=content.y+content.height)continue;
      if(spaces && ![0,2,8].includes(spaces.mask[i]) && (spaces.coverageScores?.[i]??spaces.scores[i])>=140 && !mask[i]) {
        for(let c=0;c<3;c++)overlay[3*i+c]=Math.round(rgb[3*i+c]*.65+spaceColors[spaces.mask[i]][c]*.35);
      }
      if(mask[i])for(let c=0;c<3;c++)overlay[3*i+c]=Math.round(rgb[3*i+c]*.35+colors[mask[i]][c]*.65);
    }
    const png=await sharp(overlay,{raw:{width:S,height:S,channels:3}}).png().toBuffer();
    let symbolResult;
    if(symbols){const loaded=await loadModel(symbolModelId??workerData.symbolModelId);symbolResult=await inferSymbols(bytes,sourceSize,loaded.session,loaded.manifest,sourceRegion);}
    parentPort.postMessage({id,data:{width:S,height:S,mask:mask.toString("base64"),scores:scores.toString("base64"),...(focusModelId!==modelId?{focusModelId}:{}),...(detailReadings.length?{details:detailReadings}:{}),...(spaces?{spaces:{classes:spaces.classes,mask:spaces.mask.toString("base64"),scores:spaces.scores.toString("base64"),coverageScores:spaces.coverageScores.toString('base64')}}:{}),...(symbolResult?{symbols:symbolResult}:{}),scoreKind:"uncalibrated-softmax",content,sourceSize,sourceRegion,passes,overlay:"data:image/png;base64,"+png.toString("base64"),counts,elapsedMs:Math.round(performance.now()-started),model:manifest}});
  }catch(error){parentPort.postMessage({id,error:error.message});}
});
