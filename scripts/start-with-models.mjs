import {pathToFileURL} from 'node:url';
import {installConfig,installModelBundle} from './lib/install-model-bundle.mjs';
import {recordModelDeployment} from '../src/shared/infrastructure/models/root.js';

export async function startWithModels({env=process.env,install=installModelBundle,start=()=>import('../src/server.js'),log=console.log}={}){
  const config=installConfig(env);
  if(config&&(env.ARK_NEURAL_MODEL_PATH||env.ARK_MODELS_DIR))throw new Error('Do not combine a pinned bundle with ARK_NEURAL_MODEL_PATH or ARK_MODELS_DIR. Use ARK_MODELS_CACHE_DIR instead.');
  const result=await install(config);
  if(result.configured){
    env.ARK_MODELS_DIR=result.root;recordModelDeployment(result.sha256);
    log(JSON.stringify({event:'ark-model-bundle-ready',sha256:result.sha256,cached:result.cached,models:result.models}));
  }
  return start();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await startWithModels();}
  catch(error){console.error('Ark startup cancelled:',error.message);process.exitCode=1;}
}
