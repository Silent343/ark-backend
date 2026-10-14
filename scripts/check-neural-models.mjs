import assert from "node:assert/strict";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {detectNeuralPlan,neuralStatus} from "../src/modules/plan-digitization/infrastructure/neural-detector.js";
// Explicit local smoke test. Not run in CI; needs installed research weights and a provided image.
const input=process.argv[2];if(!input)throw new Error("Usage: node scripts/check-neural-models.mjs path/to/plan.png");
const output=path.resolve(".data/qa/neural-model-smoke");await mkdir(output,{recursive:true});
const bytes=await readFile(input),image="data:image/png;base64,"+(await sharp(bytes).png().toBuffer()).toString("base64");
const keep=setInterval(()=>{},1000),report=[];
try{
  for(const model of neuralStatus().models.filter(m=>m.available)){
    const result=await detectNeuralPlan(image,model.id);
    assert.equal(result.counts.length,result.model.classes.length);
    assert(result.counts.every(n=>Number.isInteger(n)&&n>=0));
    const mask=Buffer.from(result.mask,"base64");assert.equal(mask.length,512*512);
    assert(mask.every(label=>label<result.model.classes.length));
    await writeFile(path.join(output,model.id+".png"),Buffer.from(result.overlay.split(",")[1],"base64"));
    report.push({id:model.id,artifactSha256:result.model.artifactSha256,elapsedMs:result.elapsedMs,
      pixels:Object.fromEntries(result.model.classes.map((c,i)=>[c,result.counts[i]])),rssMiB:Math.round(process.memoryUsage().rss/1024**2)});
  }
  const controller=new AbortController(),modelId=report.at(-1)?.id;
  const cancelled=detectNeuralPlan(image,modelId,controller.signal);
  const rejected=assert.rejects(cancelled,/cancelado/);
  await new Promise(resolve=>setTimeout(resolve,20));
  controller.abort();await rejected;
  assert(neuralStatus().busy,"an aborted native inference must retain its exclusive slot");
  const queued=detectNeuralPlan(image,modelId);
  await assert.rejects(detectNeuralPlan(image,modelId),error=>error.status===429);
  await queued;assert(!neuralStatus().busy);
  await writeFile(path.join(output,"report.json"),JSON.stringify({input:path.basename(input),purpose:"runtime smoke, not an accuracy benchmark",models:report,cancellation:"active slot retained, queue bounded, subsequent inference passed"},null,2));
  console.log(JSON.stringify({models:report,output}));
}finally{clearInterval(keep);}
