/** Private partial masks: unannotated pixels are IGNORE, never background truth. */
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import sharp from 'sharp';
export function validArchitectureLabels(c){
 return c?.schemaVersion==='ark-architecture-labels-1'&&c.annotationQuality==='agent-provisional'&&c.independentValidation===false&&Array.isArray(c.sources)&&c.sources.length>0&&c.sources.length<=100&&c.sources.every(s=>s&&typeof s.id==='string'&&typeof s.buildingGroup==='string'&&['train','diagnostic'].includes(s.split)&&Array.isArray(s.rooms)&&Array.isArray(s.icons));
}
export async function prepareArchitecturePilot(configFile,outDirectory){
 const bytes=await fs.readFile(configFile),c=JSON.parse(bytes),out=path.resolve(outDirectory),root=path.resolve('.data');
 if(!validArchitectureLabels(c)||!out.startsWith(root+path.sep))throw new Error('Invalid private architecture pilot');
 const groups=new Map();for(const s of c.sources){if(groups.has(s.buildingGroup)&&groups.get(s.buildingGroup)!==s.split)throw new Error('Architecture building leakage');groups.set(s.buildingGroup,s.split);}
 await fs.mkdir(out);for(const d of ['images','rooms','icons','review'])await fs.mkdir(path.join(out,d));
 const records=[],sources=[];const hash=b=>createHash('sha256').update(b).digest('hex');
 for(const s of c.sources){
  const image=await fs.readFile(s.path),m=await sharp(image).metadata();if(s.sourceSha256&&s.sourceSha256!==hash(image))throw new Error('Architecture source changed');
  if(!/^[a-z0-9-]{1,100}$/.test(s.id)||!m.width||!m.height||Math.max(m.width,m.height)>6000)throw new Error('Invalid source');
  for(const [head,max]of [['rooms',11],['icons',10]])for(const a of s[head])if(!Number.isInteger(a.category)||a.category<0||a.category>max&&a.category!==255||!Array.isArray(a.polygon)||a.polygon.length<3||a.polygon.length>256||!a.polygon.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[1]>=0&&p[0]<=m.width&&p[1]<=m.height))throw new Error('Invalid partial-mask polygon');
  const mask=async head=>sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/>${s[head].map(a=>`<polygon points="${a.polygon.map(p=>p.join(',')).join(' ')}" fill="rgb(${a.category},${a.category},${a.category})"/>`).join('')}</svg>`)).greyscale().png().toBuffer();
  const room=await mask('rooms'),icon=await mask('icons');
  sources.push({id:s.id,buildingGroup:s.buildingGroup,split:s.split,sourceSha256:hash(image),roomAnnotations:s.rooms.length,iconAnnotations:s.icons.length});
  const regions=s.split==='diagnostic'?[[0,0,m.width,m.height]]:[[0,0,m.width,m.height],...(s.crops??[])];
  for(let j=0;j<regions.length;j++){
   const b=regions[j];if(!Array.isArray(b)||b.length!==4||!b.every(Number.isInteger)||b[0]<0||b[1]<0||b[2]>m.width||b[3]>m.height||b[2]<=b[0]||b[3]<=b[1])throw new Error('Invalid architecture crop');
   for(const turn of s.split==='diagnostic'?[0]:[0,1]){
    const id=`${s.id}-${j}-${turn}`,extract={left:b[0],top:b[1],width:b[2]-b[0],height:b[3]-b[1]};
    const assets={image:await sharp(image).extract(extract).rotate(turn*90).png().toBuffer(),rooms:await sharp(room).extract(extract).rotate(turn*90).png().toBuffer(),icons:await sharp(icon).extract(extract).rotate(turn*90).png().toBuffer()};
    const row={id,buildingGroup:s.buildingGroup,split:s.split,sourceId:s.id,crop:b,rotation:turn*90};
    for(const key of ['image','rooms','icons']){const folder=key==='image'?'images':key;row[key]=`${folder}/${id}.png`;row[key+'Sha256']=hash(assets[key]);await fs.writeFile(path.join(out,row[key]),assets[key],{flag:'wx'});}
    records.push(row);
   }
  }
  const colors=['#637f8c','#769667','#242a30','#c8a77f','#9bafba','#bca9ba','#99bab3','#bbc0b4','#888','#baa68e','#af927b','#b7b7aa'];
  const overlay=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}">${s.rooms.filter(a=>a.category!==255).map(a=>`<polygon points="${a.polygon.map(p=>p.join(',')).join(' ')}" fill="${colors[a.category]}" fill-opacity=".28" stroke="${colors[a.category]}"/>`).join('')}${s.icons.filter(a=>[1,2].includes(a.category)).map(a=>`<polygon points="${a.polygon.map(p=>p.join(',')).join(' ')}" fill="${a.category===1?'#137cb8':'#c44d24'}" fill-opacity=".7"/>`).join('')}</svg>`);
  await sharp(image).composite([{input:overlay}]).png().toFile(path.join(out,'review',s.id+'.png'));
 }
 const manifest={schemaVersion:'ark-architecture-pilot-1',annotationQuality:'agent-provisional',independentValidation:false,ignoreIndex:255,configurationSha256:hash(bytes),sources,records,trainingGroups:[...groups].filter(([,v])=>v==='train').map(([k])=>k),diagnosticGroups:[...groups].filter(([,v])=>v==='diagnostic').map(([k])=>k)};
 await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});console.log(JSON.stringify({samples:records.length,training:records.filter(r=>r.split==='train').length,diagnostic:records.filter(r=>r.split==='diagnostic').length,independentValidation:false}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){const [c,o]=process.argv.slice(2);if(!c||!o)throw new Error('Usage: prepare_architecture_pilot.mjs labels.json .data/new-folder');await prepareArchitecturePilot(c,o);}
