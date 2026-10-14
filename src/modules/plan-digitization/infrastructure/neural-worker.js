import {parentPort,workerData} from "node:worker_threads";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import {decodeNeuralHeads} from "./neural-postprocessing.js";

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
parentPort.postMessage({ready:true});
parentPort.on("message",async({id,image,modelId})=>{
  try {
    const started=performance.now(),{session,manifest}=await loadModel(modelId);
    const bytes=Buffer.from(image.split(",")[1],"base64"),metadata=await sharp(bytes,{limitInputPixels:16_000_000}).metadata();
    if(!metadata.width||!metadata.height||metadata.width>6000||metadata.height>6000)throw new Error("Image dimensions exceed neural inference limits.");
    const scale=Math.min(S/metadata.width,S/metadata.height),w=manifest.preprocessing.letterbox?Math.max(1,Math.round(metadata.width*scale)):S,h=manifest.preprocessing.letterbox?Math.max(1,Math.round(metadata.height*scale)):S;
    const left=Math.floor((S-w)/2),top=Math.floor((S-h)/2);
    const rgb=await sharp(bytes,{limitInputPixels:16_000_000}).flatten({background:"#ffffff"}).toColourspace("srgb").removeAlpha().resize(w,h,{fit:"fill"}).extend({left,top,right:S-w-left,bottom:S-h-top,background:"#ffffff"}).raw().toBuffer();
    const input=new Float32Array(3*N),{mean,std}=manifest.preprocessing;
    for(let i=0;i<N;i++)for(let c=0;c<3;c++)input[c*N+i]=(rgb[3*i+c]/255-mean[c])/std[c];
    const outputs=await session.run({image:new ort.Tensor("float32",input,[1,3,S,S])});
    const {mask,scores,counts}=decodeNeuralHeads(outputs,manifest),overlay=Buffer.from(rgb);
    for(let i=0;i<N;i++){
      const x=i%S,y=Math.floor(i/S);
      if(x<left||x>=left+w||y<top||y>=top+h){counts[mask[i]]--;mask[i]=0;scores[i]=0;continue;}
      if(mask[i])for(let c=0;c<3;c++)overlay[3*i+c]=Math.round(rgb[3*i+c]*.35+colors[mask[i]][c]*.65);
    }
    const png=await sharp(overlay,{raw:{width:S,height:S,channels:3}}).png().toBuffer();
    parentPort.postMessage({id,data:{width:S,height:S,mask:mask.toString("base64"),scores:scores.toString("base64"),scoreKind:"uncalibrated-softmax",content:{x:left,y:top,width:w,height:h},sourceSize:{width:metadata.width,height:metadata.height},overlay:"data:image/png;base64,"+png.toString("base64"),counts,elapsedMs:Math.round(performance.now()-started),model:manifest}});
  }catch(error){parentPort.postMessage({id,error:error.message});}
});
