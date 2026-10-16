import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {createStorage,storageConfig} from './lib/model-storage.mjs';
import {publishModelBundle} from './lib/publish-model-bundle.mjs';
import {validateBundle,sha} from './lib/model-bundle.mjs';
try{
  const {values}=parseArgs({options:{bundle:{type:'string'},apply:{type:'boolean',default:false}}});
  if(!values.bundle)throw new Error('Use --bundle .data/model-bundles/<prepared-release> [--apply].');
  if(!values.apply){
    const bytes=await fs.readFile(path.join(values.bundle,'bundle.json')),bundle=validateBundle(JSON.parse(bytes));
    console.log(JSON.stringify({dryRun:true,sha256:sha(bytes),files:bundle.files.map(f=>({path:f.path,bytes:f.bytes})),message:'Only listed inference artifacts will be uploaded; use --apply to publish to your private bucket.'},null,2));
  }else console.log(JSON.stringify(await publishModelBundle(values.bundle,createStorage(storageConfig())),null,2));
}catch(error){console.error('Private model publication failed:',error.message);process.exitCode=1;}
