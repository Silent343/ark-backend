import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {MODEL_DIRECTORIES,sha,validateBundle,validObjectKey,PART_BYTES} from '../scripts/lib/model-bundle.mjs';
import {storageConfig,createStorage} from '../scripts/lib/model-storage.mjs';
import {installConfig,installModelBundle} from '../scripts/lib/install-model-bundle.mjs';
import {publishModelBundle} from '../scripts/lib/publish-model-bundle.mjs';
import {startWithModels} from '../scripts/start-with-models.mjs';
import {EXPANDED_NEURAL_CLASSES} from '../src/modules/plan-digitization/domain/neural-contract.js';
import {PILOT_SYMBOL_CLASSES,VEHICLE_SYMBOL_CLASSES} from '../src/modules/plan-digitization/domain/symbol-contract.js';
import {configuredNeuralModels} from '../src/modules/plan-digitization/infrastructure/neural-models.js';
import {configuredSymbolModel} from '../src/modules/plan-digitization/infrastructure/symbol-model.js';

const env={SUPABASE_URL:'https://example-ref.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_this_is_a_fake_test_key_only',ARK_ENABLE_RESEARCH_MODELS:'1'};
async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ark-model-storage-tests-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const prepared=path.join(directory,'prepared');await fs.mkdir(path.join(prepared,'parts'),{recursive:true});
  const files=[],objects=new Map(),manifests={},artifacts={};
  const training={annotationQuality:'agent-provisional',independentValidation:false,parentCheckpointSha256:'dd20b4e1bf1d670f2125107b079df06958b1ccd36e49a464ab739aeb00b8e7a2',datasetSha256:'b'.repeat(64),images:20,epochs:48};
  for(const [name,id] of Object.entries(MODEL_DIRECTORIES)){
    artifacts[name]=Buffer.from('fixture ONNX placeholder '+name);const symbol=name.startsWith('ark-objects-');
    manifests[name]={id,usage:'experimental-research',revision:'a'.repeat(40),checkpointSha256:'c'.repeat(64),artifactSha256:sha(artifacts[name]),size:symbol?640:512,classes:symbol?(id.endsWith('v2')?VEHICLE_SYMBOL_CLASSES:PILOT_SYMBOL_CLASSES):EXPANDED_NEURAL_CLASSES,training:{...training},preprocessing:{mean:[.5,.5,.5],std:[.5,.5,.5],letterbox:true}};
  }
  manifests['ark-architecture-pilot-v2'].training={...training,openingArtifactSha256:manifests['ark-architecture-pilot-v1'].artifactSha256,openingCheckpointSha256:'d'.repeat(64),openingEpochs:48};
  async function add(name,data){
    const bytes=Buffer.isBuffer(data)?data:Buffer.from(JSON.stringify(data)),hash=sha(bytes),key=`parts/${hash}.bin`;
    files.push({path:name,sha256:hash,bytes:bytes.length,parts:[{key,sha256:hash,bytes:bytes.length}]});
    objects.set(key,bytes);await fs.writeFile(path.join(prepared,key),bytes);
  }
  for(const name of Object.keys(MODEL_DIRECTORIES)){await add(name+'/manifest.json',manifests[name]);await add(name+'/model.onnx',artifacts[name]);}
  await add('ark-objects-pilot-v4/candidate-review.json',{artifactSha256:manifests['ark-objects-pilot-v4'].artifactSha256,status:'candidate-not-promoted',independentValidation:false});
  for(const name of ['NOTICE.md','CubiCasa-LICENSE.txt','Ultralytics-LICENSE.txt'])await add('licenses/'+name,Buffer.from('test license placeholder'));
  const bundle={schemaVersion:'ark-model-bundle-1',usage:'experimental-research',release:'unit-tests',files},index=Buffer.from(JSON.stringify(bundle)),digest=sha(index),key=`releases/unit-tests-${digest.slice(0,12)}/bundle.json`,prefix=key.slice(0,-'bundle.json'.length);
  await fs.writeFile(path.join(prepared,'bundle.json'),index);
  const remote=new Map([...objects].map(([k,v])=>[prefix+k,v]));remote.set(key,index);
  const calls=[];
  const storage={async ensurePrivateBucket(){calls.push('private');},async getObject(k,max){calls.push(k);const bytes=remote.get(k);if(bytes&&bytes.length>max)throw new Error('Too large');return bytes??null;}};
  const config=installConfig({...env,ARK_MODEL_BUNDLE_KEY:key,ARK_MODEL_BUNDLE_SHA256:digest,ARK_MODELS_CACHE_DIR:path.join(directory,'cache')});
  return {directory,prepared,bundle,index,key,digest,config,remote,storage,calls};
}

test('Storage accepts only server keys and the exact HTTPS Supabase origin',()=>{
  assert.equal(storageConfig(env).legacy,false);
  for(const SUPABASE_URL of ['http://example-ref.supabase.co','https://example-ref.supabase.co.evil.test','https://user:secret@example-ref.supabase.co','https://example-ref.supabase.co/?secret=1'])assert.throws(()=>storageConfig({...env,SUPABASE_URL}));
  assert.throws(()=>storageConfig({...env,SUPABASE_SECRET_KEY:'sb_publishable_not_a_server_key'}));
  const jwt=role=>`eyJ0eXAiOiJKV1QifQ.${Buffer.from(JSON.stringify({role})).toString('base64url')}.test`;
  assert(storageConfig({...env,SUPABASE_SECRET_KEY:'',SUPABASE_SERVICE_ROLE_KEY:jwt('service_role')}).legacy);
  assert.throws(()=>storageConfig({...env,SUPABASE_SECRET_KEY:'',SUPABASE_SERVICE_ROLE_KEY:jwt('anon')}));
  assert.throws(()=>storageConfig({...env,SUPABASE_SERVICE_ROLE_KEY:jwt('service_role')}));
});
test('Storage headers never send a modern secret as a bearer or follow redirects',async()=>{
  const requests=[],storage=createStorage(storageConfig(env),{fetchImpl:async(url,options)=>{requests.push({url,options});return new Response('safe');}});
  assert.equal((await storage.getObject('releases/test/part.bin',10)).toString(),'safe');
  assert.equal(requests[0].options.headers.apikey,env.SUPABASE_SECRET_KEY);assert.equal(requests[0].options.headers.Authorization,undefined);assert.equal(requests[0].options.redirect,'error');
  assert(!requests[0].url.includes(env.SUPABASE_SECRET_KEY));
  await assert.rejects(()=>storage.getObject('../secret',10));
});
test('Storage enforces privacy, bounded streaming, retries and redacted errors',async()=>{
  const publicStorage=createStorage(storageConfig(env),{fetchImpl:async()=>Response.json({public:true})});
  await assert.rejects(()=>publicStorage.ensurePrivateBucket(),/must be private/);
  const large=createStorage(storageConfig(env),{fetchImpl:async()=>new Response('123456789')});
  await assert.rejects(()=>large.getObject('safe.bin',3),/byte budget/);
  let calls=0;const retry=createStorage(storageConfig(env),{sleep:async()=>{},fetchImpl:async()=>++calls<3?new Response('do not log upstream',{status:503}):new Response('ok')});
  assert.equal((await retry.getObject('safe.bin',4)).toString(),'ok');assert.equal(calls,3);
  const error=createStorage(storageConfig(env),{fetchImpl:async()=>new Response(env.SUPABASE_SECRET_KEY,{status:403})});
  await assert.rejects(()=>error.getObject('safe.bin',100),e=>e.message.includes('403')&&!e.message.includes(env.SUPABASE_SECRET_KEY));
  const oldMissing=createStorage(storageConfig(env),{fetchImpl:async()=>Response.json({statusCode:'404'},{status:400})});assert.equal(await oldMissing.getObject('missing.bin',10),null);
});
test('Bucket setup is private and never changes an existing public bucket',async()=>{
  const requests=[];const storage=createStorage(storageConfig(env),{fetchImpl:async(url,o)=>{requests.push({url,o});return o.method==='POST'?Response.json({id:'ark-models'}):new Response('',{status:404});}});
  assert.equal((await storage.setupBucket()).created,true);
  const body=JSON.parse(requests[1].o.body);assert.equal(body.public,false);assert.equal(body.file_size_limit,6*1024*1024);
  assert.equal(requests[1].o.headers['x-upsert'],'false');
});
test('Bundle rejects path traversal, extra assets, oversized chunks and absent dependencies',async t=>{
  const {bundle}=await fixture(t);assert(validateBundle(bundle));
  for(const key of ['../.env','a//b','a/%2e%2e/b','https://evil.test','a/./b'])assert(!validObjectKey(key));
  for(const mutate of [b=>b.files[0].path='../.env',b=>b.files.push({...b.files[0]}),b=>b.files[0].parts[0].bytes=PART_BYTES+1,b=>b.files.splice(0,1),b=>b.files[0].path='plans/source.dwg',b=>b.release='../escape']){const b=structuredClone(bundle);mutate(b);assert.throws(()=>validateBundle(b));}
});
test('Installation is atomic, discovers the same models, and reuses verified cache offline',async t=>{
  const f=await fixture(t),first=await installModelBundle(f.config,{storage:f.storage});
  assert.equal(first.cached,false);assert.equal(first.sha256,f.digest);assert(f.calls[0]==='private');
  const previous=process.env.ARK_MODELS_DIR;process.env.ARK_MODELS_DIR=first.root;
  try{assert.equal(configuredNeuralModels().length,3);assert.equal(configuredSymbolModel().manifest.id,'ark-objects-pilot-v1');assert.equal(configuredSymbolModel('ark-objects-pilot-v2').candidate,true);}finally{if(previous===undefined)delete process.env.ARK_MODELS_DIR;else process.env.ARK_MODELS_DIR=previous;}
  const cached=await installModelBundle(f.config,{storage:{async ensurePrivateBucket(){throw new Error('network must not be used');}}});assert(cached.cached);
  await fs.writeFile(path.join(first.root,'ark-architecture-pilot-v2/model.onnx'),'tampered');
  await assert.rejects(()=>installModelBundle(f.config,{storage:f.storage}),/corrupt/);
});
test('A corrupt download cannot activate a release or delete the previous one',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.config.cache,'releases','previous'),{recursive:true});await fs.writeFile(path.join(f.config.cache,'releases/previous/keep'),'preserved');
  const key=[...f.remote.keys()].find(k=>k.endsWith('.bin'));f.remote.set(key,Buffer.from('corrupt'));
  await assert.rejects(()=>installModelBundle(f.config,{storage:f.storage}),/corrupt|truncated/);
  assert.equal(await fs.readFile(path.join(f.config.cache,'releases/previous/keep'),'utf8'),'preserved');
  await assert.rejects(fs.stat(path.join(f.config.cache,'releases',f.digest)),{code:'ENOENT'});
  assert.deepEqual(await fs.readdir(path.join(f.config.cache,'.staging')),[]);
});
test('A different release index, missing part or malformed manifest cannot start the API',async t=>{
  const f=await fixture(t);f.remote.set(f.key,Buffer.from('{}'));
  await assert.rejects(()=>installModelBundle(f.config,{storage:f.storage}),/SHA-256 mismatch/);
  let started=false;await assert.rejects(()=>startWithModels({env:{...env,ARK_MODEL_BUNDLE_KEY:f.key,ARK_MODEL_BUNDLE_SHA256:f.digest},install:()=>{throw new Error('corrupt');},start:()=>{started=true;}}),/corrupt/);assert(!started);
  assert.equal(installConfig({}),null);assert.throws(()=>installConfig({...env,ARK_MODEL_BUNDLE_SHA256:f.digest}));
  assert.throws(()=>installConfig({...env,ARK_ENABLE_RESEARCH_MODELS:'0',ARK_MODEL_BUNDLE_KEY:f.key,ARK_MODEL_BUNDLE_SHA256:f.digest}));
});
test('A missing chunk leaves no active release',async t=>{
  const f=await fixture(t);f.remote.delete([...f.remote.keys()].find(k=>k.endsWith('.bin')));
  await assert.rejects(()=>installModelBundle(f.config,{storage:f.storage}),/absent/);
  await assert.rejects(fs.stat(path.join(f.config.cache,'releases',f.digest)),{code:'ENOENT'});
});
test('Even a correctly pinned bundle cannot install an unsupported model manifest',async t=>{
  const f=await fixture(t),oldPrefix=f.key.slice(0,-'bundle.json'.length),parts=new Map([...f.remote].filter(([k])=>k.endsWith('.bin')).map(([k,v])=>[k.slice(oldPrefix.length),v]));
  const file=f.bundle.files.find(x=>x.path==='ark-architecture-pilot-v2/manifest.json'),manifest=JSON.parse(parts.get(file.parts[0].key));manifest.id='unknown-model';
  const bytes=Buffer.from(JSON.stringify(manifest)),digest=sha(bytes),partKey=`parts/${digest}.bin`;
  Object.assign(file,{sha256:digest,bytes:bytes.length,parts:[{key:partKey,sha256:digest,bytes:bytes.length}]});parts.set(partKey,bytes);
  const index=Buffer.from(JSON.stringify(f.bundle)),indexSha=sha(index),key=`releases/unit-tests-${indexSha.slice(0,12)}/bundle.json`,prefix=key.slice(0,-'bundle.json'.length);
  f.remote.clear();for(const [k,v] of parts)f.remote.set(prefix+k,v);f.remote.set(key,index);
  await assert.rejects(()=>installModelBundle({...f.config,key,sha256:indexSha},{storage:f.storage}),/Invalid model manifest/);
  await assert.rejects(fs.stat(path.join(f.config.cache,'releases',indexSha)),{code:'ENOENT'});
});
test('Publication uploads immutable chunks first, index last, and can resume without overwriting',async t=>{
  const f=await fixture(t),remote=new Map(),writes=[];
  const storage={async ensurePrivateBucket(){},async getObject(k){return remote.get(k)??null;},async putObject(k,b){writes.push(k);remote.set(k,b);return true;}};
  const first=await publishModelBundle(f.prepared,storage);assert.equal(first.sha256,f.digest);assert(writes.at(-1).endsWith('/bundle.json'));
  const second=await publishModelBundle(f.prepared,storage);assert.equal(second.uploaded,0);assert.equal(second.reused,writes.length);
  remote.set(writes[0],Buffer.from('different'));
  await assert.rejects(()=>publishModelBundle(f.prepared,storage),/Refusing to overwrite/);
});
