import {setTimeout as delay} from 'node:timers/promises';
import {validObjectKey} from './model-bundle.mjs';

export function storageConfig(env=process.env){
  let url;try{url=new URL(env.SUPABASE_URL);}catch{throw new Error('Set SUPABASE_URL to your HTTPS Supabase project URL.');}
  if(url.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)||url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Only the HTTPS Supabase project origin is allowed.');
  const modern=env.SUPABASE_SECRET_KEY,legacy=env.SUPABASE_SERVICE_ROLE_KEY;
  if(modern&&legacy)throw new Error('Configure only one Supabase server key.');
  if(modern&&!/^sb_secret_[A-Za-z0-9_-]{16,4096}$/.test(modern))throw new Error('Invalid SUPABASE_SECRET_KEY; publishable keys are not supported.');
  if(!modern){
    let payload;try{payload=JSON.parse(Buffer.from((legacy||'').split('.')[1],'base64url'));}catch{throw new Error('Set a server-only SUPABASE_SECRET_KEY.');}
    if(payload.role!=='service_role'||!/^[-A-Za-z0-9_.]+$/.test(legacy)||legacy.length>4096)throw new Error('A legacy key must have the service_role role.');
  }
  const bucket=env.ARK_MODEL_BUCKET||'ark-models';
  if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket))throw new Error('Invalid private model bucket name.');
  return {origin:url.origin,bucket,key:modern||legacy,legacy:!modern};
}
async function boundedBody(response,maximum){
  if(Number(response.headers.get('content-length'))>maximum){await response.body?.cancel();throw new Error('Storage response exceeds byte budget.');}
  const chunks=[];let length=0;
  for await(const chunk of response.body||[]){length+=chunk.length;if(length>maximum)throw new Error('Storage response exceeds byte budget.');chunks.push(chunk);}
  return Buffer.concat(chunks,length);
}
export function createStorage(config,{fetchImpl=fetch,sleep=delay}={}){
  const headers={apikey:config.key,...(config.legacy?{Authorization:`Bearer ${config.key}`}:{})};
  async function request(route,{method='GET',body,contentType='application/json'}={}){
    for(let attempt=0;attempt<3;attempt++){
      let response;
      try{response=await fetchImpl(config.origin+'/storage/v1/'+route,{method,headers:{...headers,...(body?{'Content-Type':contentType,'x-upsert':'false'}:{})},body,redirect:'error',signal:AbortSignal.timeout(120000)});}
      catch{if(attempt===2)throw new Error('Supabase Storage connection failed (check URL, TLS and network).');await sleep(500*(attempt+1));continue;}
      if([408,429,500,502,503,504].includes(response.status)&&attempt<2){await response.body?.cancel();await sleep(500*(attempt+1));continue;}
      return response;
    }
  }
  const objectRoute=key=>{if(!validObjectKey(key))throw new Error('Invalid Storage object key.');return `${encodeURIComponent(config.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;};
  async function absent(response){
    if(response.status===404){await response.body?.cancel();return true;}
    if(response.status!==400)return false;
    // Older Storage gateways may wrap a missing object as HTTP 400/JSON 404.
    let error;try{error=JSON.parse(await boundedBody(response,16384));}catch{return false;}
    return String(error.statusCode)==='404'||['NoSuchKey','NoSuchBucket','not_found'].includes(error.code);
  }
  async function bucketInfo(){
    const response=await request('bucket/'+encodeURIComponent(config.bucket));
    if(await absent(response))return null;
    if(!response.ok){await response.body?.cancel();throw new Error(`Cannot inspect private model bucket (HTTP ${response.status}).`);}
    let info;try{info=JSON.parse(await boundedBody(response,16384));}catch{throw new Error('Invalid Storage bucket response.');}
    if(info.public!==false)throw new Error('Model bucket must be private. No files were transferred.');
    return info;
  }
  return {
    async ensurePrivateBucket(){if(!await bucketInfo())throw new Error('Private model bucket absent. Run models:storage:setup -- --apply first.');},
    async setupBucket(){
      const existing=await bucketInfo();if(existing)return {created:false,private:true};
      const body=JSON.stringify({id:config.bucket,name:config.bucket,public:false,file_size_limit:6*1024*1024,allowed_mime_types:['application/octet-stream','application/json','text/plain']});
      const response=await request('bucket',{method:'POST',body});
      if(!response.ok){await response.body?.cancel();throw new Error(`Cannot create private model bucket (HTTP ${response.status}).`);}
      await response.body?.cancel();return {created:true,private:true};
    },
    async getObject(key,maximum){
      const response=await request('object/authenticated/'+objectRoute(key));
      if(await absent(response))return null;
      if(!response.ok){await response.body?.cancel();throw new Error(`Model download failed (HTTP ${response.status}).`);}
      return boundedBody(response,maximum);
    },
    async putObject(key,bytes,contentType='application/octet-stream'){
      const response=await request('object/'+objectRoute(key),{method:'POST',body:bytes,contentType});
      const status=response.status;await response.body?.cancel();
      if(response.ok)return true;
      // Concurrent immutable publication: the caller must GET and verify bytes.
      if(status===400||status===409)return false;
      throw new Error(`Model upload failed (HTTP ${status}).`);
    },
  };
}
