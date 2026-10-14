import {existsSync, readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {NEURAL_MODELS,validNeuralModel} from "../domain/neural-contract.js";
const root=fileURLToPath(new URL("../../../../",import.meta.url));
export function configuredNeuralModels() {
  if(process.env.NODE_ENV==="production" && process.env.ARK_ENABLE_RESEARCH_MODELS!=="1") return [];
  const paths=Object.values(NEURAL_MODELS).filter(m=>m.directory).map(m=>path.resolve(root,".data/models",m.directory,"model.onnx"));
  if(process.env.ARK_NEURAL_MODEL_PATH) paths.unshift(process.env.ARK_NEURAL_MODEL_PATH);
  const found=new Set(),models=[];
  for(const modelPath of paths) {
    if(!existsSync(modelPath))continue;
    try {
      const manifest=JSON.parse(readFileSync(path.join(path.dirname(modelPath),"manifest.json"),"utf8"));
      if(!validNeuralModel(manifest)||manifest.size!==512||found.has(manifest.id))continue;
      const p=manifest.preprocessing;
      if(!p||![p.mean,p.std].every(a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite))||p.std.some(n=>n<=0)||typeof p.letterbox!=="boolean")continue;
      found.add(manifest.id);models.push({modelPath,manifest});
    }catch { /* Invalid or unfinished artifacts stay unavailable. */ }
  }
  return models;
}
export function neuralModelCapabilities() {
  const installed=configuredNeuralModels();
  return Object.entries(NEURAL_MODELS).filter(([id])=>id!=="yytsi-resnet34-unet"||installed.some(m=>m.manifest.id===id)).map(([id,m])=>({id,label:m.label,classes:m.classes,available:installed.some(a=>a.manifest.id===id)}));
}
