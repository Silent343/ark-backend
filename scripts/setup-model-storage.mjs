import {parseArgs} from 'node:util';
import {createStorage,storageConfig} from './lib/model-storage.mjs';
try{
  const {values}=parseArgs({options:{apply:{type:'boolean',default:false}}});
  if(!values.apply)console.log('Dry run: create private ark-models bucket (6 MiB per chunk; binary/JSON/text). Run with --apply to use your server-only Supabase environment. No public bucket or client policies will be created.');
  else console.log(JSON.stringify(await createStorage(storageConfig()).setupBucket()));
}catch(error){console.error('Private model Storage setup failed:',error.message);process.exitCode=1;}
