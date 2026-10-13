import {Worker} from "node:worker_threads";
import {readFileSync,existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {fail} from "../../../errors.js";

const root=fileURLToPath(new URL("../../../../",import.meta.url));
const defaultPath=path.resolve(root,".data/models/openbim-m2-v1/model.onnx");
let worker,active,queue=[],ready=false,sequence=0,initializing;
function configuration() {
  const modelPath=process.env.ARK_NEURAL_MODEL_PATH||defaultPath;
  const allowed=process.env.NODE_ENV!=="production"||process.env.ARK_ENABLE_RESEARCH_MODELS==="1";
  const configured=allowed&&existsSync(modelPath)&&existsSync(path.join(path.dirname(modelPath),"manifest.json"));
  return {modelPath,configured};
}
export function neuralStatus() {
  const {configured,modelPath}=configuration();
  const manifest=configured?JSON.parse(readFileSync(path.join(path.dirname(modelPath),"manifest.json"),"utf8")):undefined;
  return {available:configured,ready,busy:!!active,queued:queue.length,model:manifest};
}
function dispatch() { if(ready&&!active&&queue.length){active=queue.shift();worker.postMessage({id:active.id,image:active.image});} }
function reset(error) {
  ready=false;initializing=undefined;worker=undefined;
  for(const job of [...(active?[active]:[]),...queue]){clearTimeout(job.timer);job.reject(error);}
  active=undefined;queue=[];
}
async function initialize() {
  if(initializing)return initializing;
  const {configured,modelPath}=configuration();
  if(!configured)fail(503,"El detector neuronal no está instalado en este servidor.");
  const manifest=JSON.parse(readFileSync(path.join(path.dirname(modelPath),"manifest.json"),"utf8"));
  initializing=new Promise((resolve,reject)=>{
    const current=new Worker(new URL("./neural-worker.js",import.meta.url),{workerData:{modelPath,manifest},execArgv:process.execArgv.filter(a=>!a.startsWith("--input-type"))});
    worker=current;
    const timer=setTimeout(()=>{const error=new Error("Neural initialization timed out.");reject(error);reset(error);void current.terminate();},60_000);
    worker.unref();
    worker.on("error",error=>{clearTimeout(timer);reject(error);if(worker===current)reset(error);});
    worker.on("exit",()=>{clearTimeout(timer);const error=new Error("Neural worker stopped.");reject(error);if(worker===current)reset(error);});
    worker.on("message",message=>{
      if(worker!==current)return;
      if(message.ready){clearTimeout(timer);ready=true;resolve();dispatch();return;}
      if(!active||active.id!==message.id)return;
      clearTimeout(active.timer);
      if(message.error)active.reject(new Error(message.error));else active.resolve(message.data);
      active=undefined;dispatch();
    });
  });
  return initializing;
}
export async function detectNeuralPlan(image) {
  if(typeof image!=="string"||image.length>4_200_000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image))fail(422,"Imagen no válida para el detector neuronal.");
  if(queue.length+(active?1:0)>=2)fail(429,"El detector está ocupado. Inténtalo de nuevo cuando termine el análisis.");
  await initialize();
  if(queue.length+(active?1:0)>=2)fail(429,"El detector está ocupado. Inténtalo cuando termine el análisis.");
  return new Promise((resolve,reject)=>{
    const job={id:++sequence,image,resolve,reject};
    job.timer=setTimeout(()=>{const current=worker;reset(new Error("Neural inference timed out."));void current?.terminate();},90_000);
    queue.push(job);dispatch();
  });
}
