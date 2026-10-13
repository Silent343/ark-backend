import {parentPort, workerData} from "node:worker_threads";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import * as ort from "onnxruntime-node";
import sharp from "sharp";

const artifact=await readFile(workerData.modelPath);
if(createHash("sha256").update(artifact).digest("hex")!==workerData.manifest.artifactSha256)throw new Error("Neural artifact checksum mismatch.");
const session=await ort.InferenceSession.create(artifact,{executionProviders:["cpu"],intraOpNumThreads:2,interOpNumThreads:1,graphOptimizationLevel:"all"});
const S=512, N=S*S, mean=[.485,.456,.406], std=[.229,.224,.225];
parentPort.postMessage({ready:true});
parentPort.on("message",async ({id,image})=>{
  try {
    const started=performance.now();
    const bytes=Buffer.from(image.split(",")[1],"base64");
    const metadata=await sharp(bytes,{limitInputPixels:16_000_000}).metadata();
    if(!metadata.width||!metadata.height||metadata.width>6000||metadata.height>6000)throw new Error("Image dimensions exceed neural inference limits.");
    const scale=Math.min(S/metadata.width,S/metadata.height), w=workerData.manifest.preprocessing.letterbox?Math.max(1,Math.round(metadata.width*scale)):S, h=workerData.manifest.preprocessing.letterbox?Math.max(1,Math.round(metadata.height*scale)):S;
    const left=Math.floor((S-w)/2), top=Math.floor((S-h)/2);
    const rgb=await sharp(bytes,{limitInputPixels:16_000_000}).flatten({background:"#ffffff"}).toColourspace("srgb").removeAlpha()
      .resize(w,h,{fit:"fill"}).extend({left,top,right:S-w-left,bottom:S-h-top,background:{r:124,g:116,b:104}}).raw().toBuffer();
    const input=new Float32Array(3*N);
    for(let i=0;i<N;i++)for(let c=0;c<3;c++)input[c*N+i]=(rgb[3*i+c]/255-mean[c])/std[c];
    const result=await session.run({image:new ort.Tensor("float32",input,[1,3,S,S])});
    const logits=result.logits.data;
    if(logits.length!==4*N)throw new Error("Unexpected neural output.");
    const mask=Buffer.alloc(N), score=Buffer.alloc(N), overlay=Buffer.from(rgb), counts=[0,0,0,0];
    const colors=[[255,255,255],[43,119,219],[232,146,49],[41,172,148]];
    for(let i=0;i<N;i++) {
      const x=i%S,y=Math.floor(i/S);
      if(x<left||x>=left+w||y<top||y>=top+h)continue;
      let best=0,max=logits[i];
      for(let c=1;c<4;c++)if(logits[c*N+i]>max){max=logits[c*N+i];best=c;}
      let denominator=0;for(let c=0;c<4;c++)denominator+=Math.exp(logits[c*N+i]-max);
      mask[i]=best;score[i]=Math.round(255/denominator);counts[best]++;
      if(best)for(let c=0;c<3;c++)overlay[3*i+c]=Math.round(rgb[3*i+c]*.35+colors[best][c]*.65);
    }
    const png=await sharp(overlay,{raw:{width:S,height:S,channels:3}}).png().toBuffer();
    parentPort.postMessage({id,data:{width:S,height:S,mask:mask.toString("base64"),scores:score.toString("base64"),
      content:{x:left,y:top,width:w,height:h},sourceSize:{width:metadata.width,height:metadata.height},
      overlay:`data:image/png;base64,${png.toString("base64")}`,counts,elapsedMs:Math.round(performance.now()-started),model:workerData.manifest}});
  }catch(error){parentPort.postMessage({id,error:error.message});}
});
