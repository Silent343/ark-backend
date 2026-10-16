import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {MODEL_DIRECTORIES,PART_BYTES,MAX_INDEX_BYTES,fileSha,sha,validateBundle,validateModelManifest} from './model-bundle.mjs';

export async function prepareModelBundle({modelDir,outputDir,release,noticeFile,objectsLicenseFile}){
  if(!/^[a-z0-9][a-z0-9-]{1,60}$/.test(release))throw new Error('Invalid model release label.');
  const source=await fs.realpath(modelDir);
  await fs.mkdir(outputDir,{recursive:true});const output=await fs.realpath(outputDir);
  const stage=await fs.mkdtemp(path.join(output,'preparing-'));
  const files=[];
  try{
    await fs.mkdir(path.join(stage,'parts'));
    async function add(logical,file){
      const handle=await fs.open(file,'r'),digest=createHash('sha256'),parts=[];let bytes=0;
      try{
        const buffer=Buffer.alloc(PART_BYTES);
        while(true){const result=await handle.read(buffer,0,buffer.length,null);if(!result.bytesRead)break;
          const part=buffer.subarray(0,result.bytesRead),hash=sha(part),key=`parts/${hash}.bin`;digest.update(part);bytes+=part.length;
          if(bytes>128*1024*1024)throw new Error('Model file exceeds bundle limit.');
          try{await fs.writeFile(path.join(stage,key),part,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
          parts.push({key,sha256:hash,bytes:part.length});
        }
      }finally{await handle.close();}
      const entry={path:logical,sha256:digest.digest('hex'),bytes,parts};files.push(entry);return entry;
    }
    async function localFile(directory,name){
      const file=await fs.realpath(path.join(source,directory,name));
      if(!file.startsWith(source+path.sep))throw new Error('Model source symlink escapes model directory.');
      return file;
    }
    for(const directory of Object.keys(MODEL_DIRECTORIES)){
      const manifestFile=await localFile(directory,'manifest.json'),bytes=await fs.readFile(manifestFile);
      if(bytes.length>MAX_INDEX_BYTES)throw new Error('Model manifest too large.');
      const manifest=JSON.parse(bytes);validateModelManifest(directory,manifest);
      const packagedManifest=await add(`${directory}/manifest.json`,manifestFile);
      if(packagedManifest.sha256!==sha(bytes))throw new Error('Model manifest changed during preparation.');
      const artifact=await add(`${directory}/model.onnx`,await localFile(directory,'model.onnx'));
      if(artifact.sha256!==manifest.artifactSha256)throw new Error('Local ONNX artifact differs from its manifest.');
      if(directory==='ark-objects-pilot-v4'){
        const reviewFile=await localFile(directory,'candidate-review.json'),review=JSON.parse(await fs.readFile(reviewFile));
        if(review.artifactSha256!==artifact.sha256||review.independentValidation!==false||review.status!=='candidate-not-promoted')throw new Error('Candidate review does not match deployed objects.');
        await add(`${directory}/candidate-review.json`,reviewFile);
      }
    }
    const cubicasa=await localFile('cubicasa-multitask-v1','LICENSE');
    if(await fileSha(cubicasa)!=='abb20326fa72589cde781457dbe51f7d69f376d167254e95c36f338923669303')throw new Error('Unexpected CubiCasa license.');
    const objectsLicense=await fs.readFile(objectsLicenseFile,'utf8');
    if(!objectsLicense.includes('GNU AFFERO GENERAL PUBLIC LICENSE')||!objectsLicense.includes('Version 3'))throw new Error('Expected the full Ultralytics AGPL-3.0 license.');
    await add('licenses/CubiCasa-LICENSE.txt',cubicasa);
    await add('licenses/Ultralytics-LICENSE.txt',objectsLicenseFile);
    await add('licenses/NOTICE.md',noticeFile);
    const bundle=validateBundle({schemaVersion:'ark-model-bundle-1',usage:'experimental-research',release,files});
    const index=Buffer.from(JSON.stringify(bundle,null,2)+'\n'),digest=sha(index),id=`${release}-${digest.slice(0,12)}`,target=path.join(output,id);
    await fs.writeFile(path.join(stage,'bundle.json'),index,{flag:'wx'});
    try{await fs.rename(stage,target);}catch(error){
      if(!['EEXIST','ENOTEMPTY','EPERM'].includes(error.code)||sha(await fs.readFile(path.join(target,'bundle.json')))!==digest)throw error;
      // Same immutable package already exists; do not replace it.
      for(const f of files)for(const p of f.parts)if(await fileSha(path.join(target,p.key))!==p.sha256)throw new Error('Existing prepared bundle is corrupt.');
    }
    return {directory:target,key:`releases/${id}/bundle.json`,sha256:digest,bytes:files.reduce((n,f)=>n+f.bytes,0),files:files.length,models:Object.values(MODEL_DIRECTORIES)};
  }finally{
    // Only this invocation's freshly created, resolved staging directory.
    if(path.dirname(stage)===output&&path.basename(stage).startsWith('preparing-'))await fs.rm(stage,{recursive:true,force:true});
  }
}
