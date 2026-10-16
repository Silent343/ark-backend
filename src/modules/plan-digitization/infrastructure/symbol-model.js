import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validSymbolModel} from '../domain/symbol-contract.js';
export function symbolCandidateStatus(){
  if(process.env.NODE_ENV==='production'&&process.env.ARK_ENABLE_RESEARCH_MODELS!=='1')return undefined;
  try{const r=JSON.parse(readFileSync(new URL('../../../../.data/models/object-candidate-review.json',import.meta.url),'utf8'));
    if(r.status!=='candidate-not-promoted'||r.independentValidation!==false||!Number.isInteger(r.images)||!Number.isInteger(r.epochs)||!r.totals?.after)return undefined;
    return {status:r.status,images:r.images,epochs:r.epochs,matched:r.totals.after.tp,total:r.totals.after.tp+r.totals.after.fn,falsePositives:r.totals.after.fp};
  }catch{return undefined;}
}
export function configuredSymbolModel() {
  // Prototype only. An explicit production opt-in does not grant commercial rights.
  if(process.env.NODE_ENV==='production' && process.env.ARK_ENABLE_RESEARCH_MODELS!=='1')return undefined;
  for(const directory of ['ark-objects-pilot-v2','ark-objects-pilot-v1','floorcad-symbols-v1']){
    const modelPath=fileURLToPath(new URL(`../../../../.data/models/${directory}/model.onnx`,import.meta.url));
    try {
      const manifest=JSON.parse(readFileSync(new URL(`../../../../.data/models/${directory}/manifest.json`,import.meta.url),'utf8'));
      if(existsSync(modelPath)&&validSymbolModel(manifest))return {modelPath,manifest};
    }catch { /* Incomplete installations remain unavailable. */ }
  }
}
