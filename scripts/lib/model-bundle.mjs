import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {validNeuralModel} from '../../src/modules/plan-digitization/domain/neural-contract.js';
import {validSymbolModel} from '../../src/modules/plan-digitization/domain/symbol-contract.js';

export const PART_BYTES=4*1024*1024;
export const MAX_INDEX_BYTES=128*1024;
export const MODEL_DIRECTORIES={
  'cubicasa-multitask-v1':'cubicasa-multitask-v1',
  'ark-architecture-pilot-v1':'ark-architecture-pilot-v1',
  'ark-architecture-pilot-v2':'ark-architecture-pilot-v2',
  // Directory versions and model contract IDs are intentionally different.
  'ark-objects-pilot-v2':'ark-objects-pilot-v1',
  'ark-objects-pilot-v4':'ark-objects-pilot-v2',
};
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const validSha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
export async function fileSha(file){const digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest('hex');}
export function validObjectKey(key){return typeof key==='string'&&key.length<=240&&/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(key)&&key.split('/').every(p=>p&&p!=='.'&&p!=='..');}
export function validateModelManifest(directory,m){
  if(m?.id!==MODEL_DIRECTORIES[directory]||!(directory.startsWith('ark-objects-')?validSymbolModel(m):validNeuralModel(m)))throw new Error('Invalid model manifest in bundle.');
  if(!directory.startsWith('ark-objects-')&&(m.size!==512||!m.preprocessing||m.preprocessing.letterbox!==true||![m.preprocessing.mean,m.preprocessing.std].every(a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite))||m.preprocessing.std.some(n=>n<=0)))throw new Error('Invalid architecture preprocessing in bundle.');
}
export function validateBundle(b){
  if(b?.schemaVersion!=='ark-model-bundle-1'||b.usage!=='experimental-research'||!/^[a-z0-9][a-z0-9-]{1,60}$/.test(b.release)||!Array.isArray(b.files)||b.files.length<11||b.files.length>32)throw new Error('Invalid model bundle index.');
  const paths=new Set();let total=0;
  for(const f of b.files){
    const allowed=/^(cubicasa-multitask-v1|ark-architecture-pilot-v[12]|ark-objects-pilot-v[24])\/(model\.onnx|manifest\.json|candidate-review\.json)$/.test(f.path)||/^licenses\/(NOTICE\.md|CubiCasa-LICENSE\.txt|Ultralytics-LICENSE\.txt)$/.test(f.path);
    if(!allowed||paths.has(f.path)||!validSha(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>128*1024*1024||!Array.isArray(f.parts)||!f.parts.length||f.parts.length>32)throw new Error('Invalid or duplicate model bundle file.');
    if(!f.path.endsWith('.onnx')&&f.bytes>MAX_INDEX_BYTES)throw new Error('Model metadata exceeds size limit.');
    paths.add(f.path);total+=f.bytes;let size=0;
    for(const part of f.parts){
      if(!validSha(part.sha256)||part.key!==`parts/${part.sha256}.bin`||!Number.isSafeInteger(part.bytes)||part.bytes<1||part.bytes>PART_BYTES)throw new Error('Invalid model chunk.');
      size+=part.bytes;
    }
    if(size!==f.bytes)throw new Error('Model chunk lengths do not match file.');
  }
  if(total>512*1024*1024)throw new Error('Model bundle exceeds total budget.');
  for(const directory of Object.keys(MODEL_DIRECTORIES))for(const file of ['model.onnx','manifest.json'])if(!paths.has(`${directory}/${file}`))throw new Error('Required model dependency absent from bundle.');
  for(const file of ['licenses/NOTICE.md','licenses/CubiCasa-LICENSE.txt','licenses/Ultralytics-LICENSE.txt','ark-objects-pilot-v4/candidate-review.json'])if(!paths.has(file))throw new Error('Required model license or candidate review absent.');
  return b;
}
