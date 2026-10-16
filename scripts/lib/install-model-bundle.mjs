import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {MAX_INDEX_BYTES,MODEL_DIRECTORIES,sha,validSha,validObjectKey,validateBundle,validateModelManifest,fileSha} from './model-bundle.mjs';
import {createStorage,storageConfig} from './model-storage.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
export function installConfig(env=process.env){
  if(!env.ARK_MODEL_BUNDLE_KEY){
    if(env.ARK_MODEL_BUNDLE_SHA256)throw new Error('ARK_MODEL_BUNDLE_KEY is missing.');
    return null;
  }
  if(env.ARK_ENABLE_RESEARCH_MODELS!=='1')throw new Error('Experimental bundles require explicit ARK_ENABLE_RESEARCH_MODELS=1; this is not a commercial license.');
  const key=env.ARK_MODEL_BUNDLE_KEY;
  if(!validObjectKey(key)||!/^releases\/[^/]+\/bundle\.json$/.test(key)||!validSha(env.ARK_MODEL_BUNDLE_SHA256))throw new Error('Set a valid immutable bundle key and its exact SHA-256.');
  return {key,sha256:env.ARK_MODEL_BUNDLE_SHA256,cache:path.resolve(env.ARK_MODELS_CACHE_DIR||path.join(root,'.data/model-cache')),storage:storageConfig(env)};
}
async function verifyInstalled(directory,bundle){
  const real=await fs.realpath(directory);
  for(const f of bundle.files){
    const file=await fs.realpath(path.join(real,'models',f.path));
    if(!file.startsWith(real+path.sep)||await fileSha(file)!==f.sha256)throw new Error('Installed model checksum mismatch; existing release preserved.');
  }
  const manifests={};
  for(const name of Object.keys(MODEL_DIRECTORIES)){
    const m=JSON.parse(await fs.readFile(path.join(real,'models',name,'manifest.json')));validateModelManifest(name,m);manifests[name]=m;
    if(bundle.files.find(f=>f.path===`${name}/model.onnx`).sha256!==m.artifactSha256)throw new Error('Installed artifact is not the model declared by its manifest.');
  }
  const review=JSON.parse(await fs.readFile(path.join(real,'models/ark-objects-pilot-v4/candidate-review.json')));
  if(review.artifactSha256!==manifests['ark-objects-pilot-v4'].artifactSha256||review.status!=='candidate-not-promoted'||review.independentValidation!==false)throw new Error('Invalid deployed candidate review.');
  if(manifests['ark-architecture-pilot-v2'].training.openingArtifactSha256!==manifests['ark-architecture-pilot-v1'].artifactSha256)throw new Error('Preserved opening model dependency mismatch.');
}
export async function installModelBundle(config,{storage=config?createStorage(config.storage):null}={}){
  if(!config)return {configured:false};
  await fs.mkdir(config.cache,{recursive:true});const cache=await fs.realpath(config.cache);
  const releases=path.join(cache,'releases'),target=path.join(releases,config.sha256);
  await fs.mkdir(releases,{recursive:true});
  if(await fs.realpath(releases)!==releases)throw new Error('Model release cache cannot be a symlink.');
  let index;
  try{
    if((await fs.lstat(target)).isSymbolicLink())throw new Error('Model release cannot be a symlink.');
    index=await fs.readFile(path.join(target,'bundle.json'));
  }catch(error){
    if(error.code!=='ENOENT')throw error;
    // An incomplete existing release is not silently repaired or overwritten.
    try{await fs.stat(target);throw new Error('Incomplete cached model release; preserved for inspection.');}catch(check){if(check.code!=='ENOENT')throw check;}
  }
  if(index){
    if(index.length>MAX_INDEX_BYTES||sha(index)!==config.sha256)throw new Error('Cached model index differs from pinned release.');
    const bundle=validateBundle(JSON.parse(index));
    try{await verifyInstalled(target,bundle);}catch{throw new Error('Cached model release is corrupt; preserved for inspection.');}
    return {configured:true,cached:true,sha256:config.sha256,models:Object.values(MODEL_DIRECTORIES),root:path.join(target,'models')};
  }
  // Never silently use old weights when the requested release is unavailable.
  await storage.ensurePrivateBucket();
  index=await storage.getObject(config.key,MAX_INDEX_BYTES);
  if(!index||sha(index)!==config.sha256)throw new Error('Private bundle absent or SHA-256 mismatch. API startup cancelled.');
  const bundle=validateBundle(JSON.parse(index)),prefix=config.key.slice(0,-'bundle.json'.length);
  const staging=path.join(cache,'.staging');await fs.mkdir(staging,{recursive:true});
  if(await fs.realpath(staging)!==staging)throw new Error('Model staging cache cannot be a symlink.');
  const stage=path.join(staging,randomUUID());await fs.mkdir(stage);
  try{
    for(const f of bundle.files){
      const targetFile=path.join(stage,'models',f.path);await fs.mkdir(path.dirname(targetFile),{recursive:true});
      const handle=await fs.open(targetFile,'wx'),digest=createHash('sha256');let bytes=0;
      try{for(const part of f.parts){
        const data=await storage.getObject(prefix+part.key,part.bytes);
        if(!data||data.length!==part.bytes||sha(data)!==part.sha256)throw new Error('Model chunk absent, truncated or corrupt. API startup cancelled.');
        digest.update(data);bytes+=data.length;await handle.writeFile(data);
      }}finally{await handle.close();}
      if(bytes!==f.bytes||digest.digest('hex')!==f.sha256)throw new Error('Reconstructed model checksum mismatch.');
    }
    await fs.writeFile(path.join(stage,'bundle.json'),index,{flag:'wx'});await verifyInstalled(stage,bundle);
    try{await fs.rename(stage,target);}catch(error){
      if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code))throw error;
      // Another startup may have installed this exact immutable release.
      if(sha(await fs.readFile(path.join(target,'bundle.json')))!==config.sha256)throw error;
      await verifyInstalled(target,bundle);
    }
    return {configured:true,cached:false,sha256:config.sha256,models:Object.values(MODEL_DIRECTORIES),root:path.join(target,'models')};
  }finally{
    if(path.dirname(stage)===staging&&/^[a-f0-9-]{36}$/.test(path.basename(stage)))await fs.rm(stage,{recursive:true,force:true});
  }
}
