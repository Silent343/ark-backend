import fs from 'node:fs/promises';
import path from 'node:path';
import {MAX_INDEX_BYTES,sha,validateBundle} from './model-bundle.mjs';

export async function publishModelBundle(directory,storage){
  const root=await fs.realpath(directory),index=await fs.readFile(path.join(root,'bundle.json'));
  if(index.length>MAX_INDEX_BYTES)throw new Error('Bundle index too large.');
  const bundle=validateBundle(JSON.parse(index)),digest=sha(index);
  const prefix=`releases/${bundle.release}-${digest.slice(0,12)}/`;
  const parts=new Map();for(const f of bundle.files)for(const p of f.parts)parts.set(p.key,p);
  // Validate everything before making any external write.
  for(const p of parts.values()){
    const file=await fs.realpath(path.join(root,p.key));if(!file.startsWith(root+path.sep))throw new Error('Prepared bundle symlink escapes directory.');
    const data=await fs.readFile(file);if(data.length!==p.bytes||sha(data)!==p.sha256)throw new Error('Prepared model chunk differs from index.');
  }
  await storage.ensurePrivateBucket();let uploaded=0,reused=0;
  async function putVerified(key,bytes,type){
    let existing=await storage.getObject(key,bytes.length);
    if(existing){if(sha(existing)!==sha(bytes))throw new Error('Refusing to overwrite a different immutable Storage object.');reused++;return;}
    if(await storage.putObject(key,bytes,type)){uploaded++;return;}
    existing=await storage.getObject(key,bytes.length);
    if(!existing||sha(existing)!==sha(bytes))throw new Error('Immutable upload conflict; existing object was not overwritten.');reused++;
  }
  for(const p of parts.values())await putVerified(prefix+p.key,await fs.readFile(path.join(root,p.key)),'application/octet-stream');
  // The index becomes visible only after every referenced part is uploaded.
  await putVerified(prefix+'bundle.json',index,'application/json');
  return {key:prefix+'bundle.json',sha256:digest,uploaded,reused};
}
