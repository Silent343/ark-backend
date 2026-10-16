/** Keep a failed/regressing research candidate visible without promoting it. */
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
const [run,...args]=process.argv.slice(2),reports=[...args];let output='.data/models/object-candidate-review.json';
if(reports[0]==='--output'){reports.shift();output=reports.shift();}
if(!run||!output||reports.length<2||reports.length%2)throw new Error('Usage: node training/record_object_candidate.mjs run [--output .data/unique-review.json] before.json after.json [before after...]');
const root=path.resolve('.data'),folder=path.resolve(run);if(!folder.startsWith(root+path.sep))throw new Error('Candidate must stay private');
if(!path.resolve(output).startsWith(root+path.sep))throw new Error('Candidate review must stay private');
const manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
const bytes=await fs.readFile(path.join(folder,'objects.onnx'));if(createHash('sha256').update(bytes).digest('hex')!==manifest.artifactSha256)throw new Error('Candidate hash mismatch');
const totals={before:{tp:0,fp:0,fn:0},after:{tp:0,fp:0,fn:0}},comparisons=[];
for(let i=0;i<reports.length;i+=2){const before=JSON.parse(await fs.readFile(reports[i],'utf8')),after=JSON.parse(await fs.readFile(reports[i+1],'utf8'));if(before.labelsSha256!==after.labelsSha256||after.artifactSha256!==manifest.artifactSha256||after.independentValidation!==false)throw new Error('Non-comparable candidate evaluation');for(const [key,r]of [['before',before],['after',after]])for(const source of r.results){if(!manifest.training.heldOutBuildingGroups.includes(source.buildingGroup))throw new Error('Source not reserved before training');totals[key].tp+=source.metrics.truePositives;totals[key].fp+=source.metrics.falsePositives;totals[key].fn+=source.metrics.falseNegatives;}comparisons.push({before:path.basename(reports[i]),after:path.basename(reports[i+1]),labelsSha256:after.labelsSha256});}
const report={status:'candidate-not-promoted',reason:totals.after.fp>totals.before.fp?'false-positive-regression':'independent-architectural-evaluation-pending',images:manifest.training.images,epochs:manifest.training.epochs,artifactSha256:manifest.artifactSha256,independentValidation:false,totals,comparisons};
await fs.writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));
