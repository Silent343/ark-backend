import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {modelRoot} from '../../../shared/infrastructure/models/root.js';
import {validSymbolModel} from '../domain/symbol-contract.js';
export function symbolCandidateStatus(){
  if(process.env.NODE_ENV==='production'&&process.env.ARK_ENABLE_RESEARCH_MODELS!=='1')return undefined;
  try{const review=['ark-objects-pilot-v4/candidate-review.json','ark-objects-pilot-v3/candidate-review.json','object-candidate-review.json'].map(p=>path.join(modelRoot(),p)).find(p=>existsSync(p));
    if(!review)return undefined;
    const r=JSON.parse(readFileSync(review,'utf8'));
    if(r.status!=='candidate-not-promoted'||r.independentValidation!==false||!Number.isInteger(r.images)||!Number.isInteger(r.epochs)||!r.totals?.after)return undefined;
    return {status:r.status,images:r.images,epochs:r.epochs,matched:r.totals.after.tp,total:r.totals.after.tp+r.totals.after.fn,falsePositives:r.totals.after.fp};
  }catch{return undefined;}
}
export function configuredSymbolModels() {
  // Prototype only. An explicit production opt-in does not grant commercial rights.
  if(process.env.NODE_ENV==='production' && process.env.ARK_ENABLE_RESEARCH_MODELS!=='1')return [];
  const models=[];
  // Keep the candidate opt-in. Presence on disk never promotes failed weights.
  for(const directory of ['ark-objects-pilot-v2','ark-objects-pilot-v1','floorcad-symbols-v1','ark-objects-pilot-v4','ark-objects-pilot-v3']){
    const modelPath=path.join(modelRoot(),directory,'model.onnx');
    try {
      const manifest=JSON.parse(readFileSync(path.join(modelRoot(),directory,'manifest.json'),'utf8'));
      if(existsSync(modelPath)&&validSymbolModel(manifest)&&!models.some(m=>m.manifest.id===manifest.id))models.push({modelPath,manifest,candidate:['ark-objects-pilot-v3','ark-objects-pilot-v4'].includes(directory)});
    }catch { /* Incomplete installations remain unavailable. */ }
  }
  return models;
}
export function configuredSymbolModel(id) {
  const models=configuredSymbolModels();
  return id===undefined?models.find(m=>!m.candidate):models.find(m=>m.manifest.id===id);
}
