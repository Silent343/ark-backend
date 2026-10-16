import {Worker} from "node:worker_threads";
import {fail} from "../../../errors.js";
import {configuredNeuralModels,neuralModelCapabilities} from "./neural-models.js";
import {NEURAL_MODELS} from "../domain/neural-contract.js";
import {configuredSymbolModel,configuredSymbolModels,symbolCandidateStatus} from "./symbol-model.js";
import {modelDeployment} from '../../../shared/infrastructure/models/root.js';

let worker,active,queue=[],ready=false,sequence=0,initializing;
export function neuralStatus() {
  const installed=configuredNeuralModels(), preferred=installed.find(m=>m.manifest.id==="openbim-m2-unet")??installed[0];
  const symbols=configuredSymbolModel();
  const kinds=['chair','table','sofa','bed','plant','stair','vehicle'];
  return {available:installed.length>0,ready,busy:!!active,queued:queue.length,model:preferred?.manifest,models:neuralModelCapabilities(),...(modelDeployment()?{bundle:modelDeployment()}:{}),symbols:{available:!!symbols,id:symbols?.manifest.id,label:symbols?.manifest.label,candidate:symbolCandidateStatus(),models:configuredSymbolModels().map(m=>({id:m.manifest.id,label:m.manifest.label,candidate:m.candidate,classes:m.manifest.classes})),classes:symbols?.manifest.classes.filter(c=>kinds.includes(c))??[],unsupported:kinds.filter(c=>!symbols?.manifest.classes.includes(c))}};
}
function dispatch() {
  if(ready&&!active&&queue.length){active=queue.shift();worker.postMessage({id:active.id,image:active.image,modelId:active.modelId,focus:active.focus,symbols:active.symbols,details:active.details,symbolModelId:active.symbolModelId});}
}
function finish(job,error,data) {
  clearTimeout(job.timer);job.signal?.removeEventListener("abort",job.abort);
  if(error)job.reject(error);else if(!job.cancelled)job.resolve(data);
}
function reset(error) {
  ready=false;initializing=undefined;worker=undefined;
  for(const job of [...(active?[active]:[]),...queue])finish(job,error);
  active=undefined;queue=[];
}
async function initialize() {
  if(initializing)return initializing;
  const models=configuredNeuralModels();
  if(!models.length)fail(503,"El detector neuronal no está instalado en este servidor.");
  const symbols=configuredSymbolModel();
  models.push(...configuredSymbolModels());
  initializing=new Promise((resolve,reject)=>{
    const current=new Worker(new URL("./neural-worker.js",import.meta.url),{workerData:{models,symbolModelId:symbols?.manifest.id},execArgv:process.execArgv.filter(a=>!a.startsWith("--input-type"))});
    worker=current;
    const timer=setTimeout(()=>{const error=new Error("Neural initialization timed out.");reject(error);reset(error);void current.terminate();},60_000);
    worker.on("error",error=>{clearTimeout(timer);reject(error);if(worker===current)reset(error);});
    worker.on("exit",()=>{clearTimeout(timer);const error=new Error("Neural worker stopped.");reject(error);if(worker===current)reset(error);});
    worker.on("message",message=>{
      if(worker!==current)return;
      if(message.ready){clearTimeout(timer);ready=true;resolve();dispatch();return;}
      if(!active||active.id!==message.id)return;
      finish(active,message.error?new Error(message.error):undefined,message.data);
      active=undefined;dispatch();
    });
    worker.unref();
  });
  return initializing;
}
export async function detectNeuralPlan(image,modelId,signal,focus=false,symbols=false,details=false,symbolModelId) {
  if(typeof focus!=="boolean")fail(422,"Invalid focus option.");
  if(typeof symbols!=="boolean")fail(422,"Invalid symbols option.");
  if(typeof details!=="boolean")fail(422,"Invalid architecture details option.");
  if(symbolModelId!==undefined&&(typeof symbolModelId!=='string'||!['floorcad-symbols-v1','ark-objects-pilot-v1','ark-objects-pilot-v2'].includes(symbolModelId)))fail(422,'Invalid object model.');
  if(symbols&&symbolModelId!==undefined&&!configuredSymbolModel(symbolModelId))fail(503,'El modelo de objetos solicitado no está instalado.');
  if(symbols&&!configuredSymbolModel())fail(503,"El detector de mobiliario no está instalado en este servidor.");
  if(typeof image!=="string"||image.length>4_200_000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))fail(422,"Imagen no válida para el detector neuronal.");
  const installed=configuredNeuralModels();
  modelId=modelId??installed.find(m=>m.manifest.id==="openbim-m2-unet")?.manifest.id??installed[0]?.manifest.id;
  if(modelId!==undefined && (typeof modelId!=="string"||!Object.hasOwn(NEURAL_MODELS,modelId)))fail(422,"Modelo neuronal no válido.");
  if(!installed.some(m=>m.manifest.id===modelId))fail(503,"El modelo solicitado no está instalado en este servidor.");
  if(signal?.aborted)throw new Error("Análisis cancelado.");
  if(queue.length+(active?1:0)>=2)fail(429,"El detector está ocupado. Inténtalo cuando termine el análisis.");
  await initialize();
  if(signal?.aborted)throw new Error("Análisis cancelado.");
  if(queue.length+(active?1:0)>=2)fail(429,"El detector está ocupado. Inténtalo cuando termine el análisis.");
  return new Promise((resolve,reject)=>{
    const job={id:++sequence,image,modelId,focus,symbols,details,symbolModelId,resolve,reject,signal,cancelled:false};
    job.abort=()=>{
      job.cancelled=true;
      if(active!==job)queue=queue.filter(item=>item!==job);
      if(active===job){job.reject(new Error("Análisis cancelado."));signal?.removeEventListener("abort",job.abort);}
      else finish(job,new Error("Análisis cancelado."));
      // An active ORT call finishes in place; never dispatch a concurrent inference.
    };
    job.timer=setTimeout(()=>{const current=worker;reset(new Error("Neural inference timed out."));void current?.terminate();},90_000);
    signal?.addEventListener("abort",job.abort,{once:true});
    queue.push(job);dispatch();
  });
}
