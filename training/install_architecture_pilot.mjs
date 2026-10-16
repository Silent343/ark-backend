import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {validNeuralModel} from '../src/modules/plan-digitization/domain/neural-contract.js';
const run=path.resolve(process.argv[2]??''),root=path.resolve('.data');
if(!run.startsWith(path.join(root,'training')+path.sep))throw new Error('Private architecture run required');
const manifest=JSON.parse(await fs.readFile(path.join(run,'manifest.json'),'utf8')),artifact=await fs.readFile(path.join(run,'model.onnx'));
if(!['ark-architecture-pilot-v1','ark-architecture-pilot-v2'].includes(manifest.id)||!validNeuralModel(manifest)||createHash('sha256').update(artifact).digest('hex')!==manifest.artifactSha256)throw new Error('Unverified architecture pilot');
const target=path.join(root,'models',manifest.id);await fs.mkdir(target);
await fs.writeFile(path.join(target,'model.onnx'),artifact,{flag:'wx'});await fs.writeFile(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
console.log(JSON.stringify({installed:manifest.id,default:false,independentValidation:false}));
