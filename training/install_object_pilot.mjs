import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validSymbolModel} from '../src/modules/plan-digitization/domain/symbol-contract.js';
const [runFolder,directory='ark-objects-pilot-v1']=process.argv.slice(2);if(!runFolder||!['ark-objects-pilot-v1','ark-objects-pilot-v2','ark-objects-pilot-v3','ark-objects-pilot-v4'].includes(directory))throw new Error('Usage: node training/install_object_pilot.mjs .data/training/run-folder [ark-objects-pilot-v4]');
const run=path.resolve(runFolder),root=path.resolve('.data');
if(!run.startsWith(root+path.sep))throw new Error('Only private local training artifacts can be installed');
const manifest=JSON.parse(await fs.readFile(path.join(run,'manifest.json'),'utf8')),bytes=await fs.readFile(path.join(run,'objects.onnx'));
if(!['ark-objects-pilot-v1','ark-objects-pilot-v2'].includes(manifest.id)||!validSymbolModel(manifest)||createHash('sha256').update(bytes).digest('hex')!==manifest.artifactSha256)throw new Error('Unverified pilot artifact');
const out=path.join(root,'models',directory);
await fs.mkdir(out); // Deliberately refuse to overwrite an installed model.
await fs.writeFile(path.join(out,'model.onnx'),bytes,{flag:'wx'});await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
console.log(JSON.stringify({installed:manifest.id,images:manifest.training.images,independentValidation:false}));
