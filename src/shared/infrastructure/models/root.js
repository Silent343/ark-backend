import path from 'node:path';
import {fileURLToPath} from 'node:url';

const localRoot=fileURLToPath(new URL('../../../../.data/models',import.meta.url));
let deployment;
export function modelRoot(){return path.resolve(process.env.ARK_MODELS_DIR||localRoot);}
export function recordModelDeployment(sha256){deployment={sha256,verified:true,source:'private-storage-bundle'};}
export function modelDeployment(){return deployment;}
