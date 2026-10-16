import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {prepareModelBundle} from './lib/prepare-model-bundle.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
try{
  const {values}=parseArgs({options:{release:{type:'string',default:'ark-research-20261016'},'objects-license':{type:'string'}}});
  const result=await prepareModelBundle({modelDir:path.join(root,'.data/models'),outputDir:path.join(root,'.data/model-bundles'),release:values.release,noticeFile:path.join(root,'config/model-artifacts-NOTICE.md'),objectsLicenseFile:values['objects-license']||path.join(root,'.venv/Lib/site-packages/ultralytics-8.3.235.dist-info/licenses/LICENSE')});
  console.log(JSON.stringify(result,null,2));
  console.log(`ARK_MODEL_BUNDLE_KEY=${result.key}\nARK_MODEL_BUNDLE_SHA256=${result.sha256}`);
}catch(error){console.error('Model preparation failed:',error.message);process.exitCode=1;}
