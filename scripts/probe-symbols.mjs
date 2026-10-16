// Runs the same inference as the API. It never edits projects or fabricates annotations.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import {configuredSymbolModel} from '../src/modules/plan-digitization/infrastructure/symbol-model.js';
import {inferSymbols} from '../src/modules/plan-digitization/infrastructure/symbol-inference.js';
const file=process.argv[2];
if(!file)throw new Error('Usage: node scripts/probe-symbols.mjs image-path');
const model=configuredSymbolModel();
if(!model)throw new Error('Install the research model first.');
const artifact=await readFile(model.modelPath);
if(createHash('sha256').update(artifact).digest('hex')!==model.manifest.artifactSha256)throw new Error('Checksum mismatch');
const session=await ort.InferenceSession.create(artifact,{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1});
try {
  const raw=await readFile(file);
  const threshold=process.argv[3]&&/^\d+$/.test(process.argv[3])?Number(process.argv[3]):undefined;
  const bytes=threshold?await sharp(raw).grayscale().threshold(threshold).png().toBuffer():raw;
  const metadata=await sharp(bytes).metadata(),size={width:metadata.width,height:metadata.height};
  const plan=process.argv[3]==='--focus-plan'?JSON.parse(await readFile(process.argv[4],'utf8')):undefined;
  const focus=plan?.sheets?.find(s=>s.neural?.sourceSize.width===size.width&&s.neural?.sourceSize.height===size.height)?.neural?.sourceRegion;
  const result=await inferSymbols(bytes,size,session,model.manifest,focus);
  await mkdir('.data/qa',{recursive:true});
  await writeFile('.data/qa/symbols-probe.json',JSON.stringify({sourceSize:size,...result},null,2));
  const svg=`<svg width="${size.width}" height="${size.height}" xmlns="http://www.w3.org/2000/svg">${result.items.map(i=>`<rect x="${i.box[0]}" y="${i.box[1]}" width="${i.box[2]-i.box[0]}" height="${i.box[3]-i.box[1]}" fill="none" stroke="#bb2784" stroke-width="3"/><text x="${i.box[0]}" y="${i.box[1]-4}" font-size="16" fill="#bb2784">${i.kind} ${i.score.toFixed(2)}</text>`).join('')}</svg>`;
  await sharp(bytes).composite([{input:Buffer.from(svg)}]).png().toFile('.data/qa/symbols-probe.png');
  console.log(JSON.stringify({passes:result.passes,elapsedMs:result.elapsedMs,items:result.items}));
}finally {await session.release();}
