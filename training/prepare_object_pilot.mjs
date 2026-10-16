/** Private, explicitly provisional object labels. Never feeds the independent benchmark. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {combinedBounds,entityBounds} from './cad_object_geometry.mjs';
import {completeObjectCrop} from './complete_object_crop.mjs';
export const OBJECT_CLASSES=['chair','table','sofa','bed','plant','stair','vehicle'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(a,b,t=0)=>a[0]<=b[2]+t&&a[2]>=b[0]-t&&a[1]<=b[3]+t&&a[3]>=b[1]-t;
const area=b=>(b[2]-b[0])*(b[3]-b[1]);
function inkLength(s) {if(s.kind==='circle')return 2*Math.PI*s.radius;let n=0;for(let i=2;i<(s.points?.length??0);i+=2)n+=Math.hypot(s.points[i]-s.points[i-2],s.points[i+1]-s.points[i-1]);return n;}
export function selectPrototype(shapes,selection) {
  if(selection==='complete-group')return shapes;
  if(selection==='largest-closed-path')return shapes.filter(s=>s.kind==='path'&&s.closed).sort((a,b)=>area(entityBounds(b))-area(entityBounds(a))).slice(0,1);
  if(selection!=='largest-connected-ink')throw new Error('Unknown prototype selection');
  const bounds=shapes.map(entityBounds),remaining=new Set(shapes.map((_,i)=>i)),components=[];
  const extent=combinedBounds(shapes),tolerance=Math.min(extent[2]-extent[0],extent[3]-extent[1])*.015;
  while(remaining.size){const members=[remaining.values().next().value];remaining.delete(members[0]);for(let k=0;k<members.length;k++)for(const n of remaining)if(inside(bounds[members[k]],bounds[n],tolerance)){members.push(n);remaining.delete(n);}components.push(members.map(n=>shapes[n]));}
  return components.sort((a,b)=>b.reduce((s,p)=>s+inkLength(p),0)-a.reduce((s,p)=>s+inkLength(p),0))[0];
}
function vectorSvg(shapes,size=180) {
 const b=combinedBounds(shapes),k=(size-12)/Math.max(b[2]-b[0],b[3]-b[1]);
 const point=(x,y)=>[6+(x-b[0])*k,6+(b[3]-y)*k];
 const drawings=shapes.map(s=>s.kind==='path'?`<polyline points="${Array.from({length:s.points.length/2},(_,i)=>point(s.points[i*2],s.points[i*2+1]).join(',')).join(' ')}${s.closed?' '+point(s.points[0],s.points[1]).join(','):''}" fill="none" stroke="#333" stroke-width="1.1"/>`:s.kind==='circle'?`<circle cx="${point(s.x,s.y)[0]}" cy="${point(s.x,s.y)[1]}" r="${s.radius*k}" fill="none" stroke="#333" stroke-width="1.1"/>`:'').join('');
 return {svg:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil((b[2]-b[0])*k+12)}" height="${Math.ceil((b[3]-b[1])*k+12)}">${drawings}</svg>`),bounds:b};
}
export function rotateBox(b,size,turn) {let [x1,y1,x2,y2]=b;for(let n=0;n<turn;n++)[x1,y1,x2,y2]=[size-y2,x1,size-y1,x2];return [x1,y1,x2,y2];}
export async function prepareObjectPilot(configFile,outDirectory) {
 const configBytes=await fs.readFile(configFile),config=JSON.parse(configBytes),out=path.resolve(outDirectory),privateRoot=path.resolve('.data');
 let parentBytes;
 if(config.extends){const parent=path.resolve(path.dirname(configFile),config.extends);if(!parent.startsWith(privateRoot+path.sep))throw new Error('Replay labels must remain private');parentBytes=await fs.readFile(parent);const replay=JSON.parse(parentBytes);if(replay.extends||replay.classes?.join(',')!==config.classes?.slice(0,replay.classes.length).join(','))throw new Error('Invalid replay label package');config.images=[...(replay.images??[]),...(config.images??[])];config.cadPrototypes=[...(replay.cadPrototypes??[]),...(config.cadPrototypes??[])];}
 const reserved=new Set(config.heldOutBuildingGroups??[]);
 if([...config.images,...(config.cadPrototypes??[])].some(s=>!s.buildingGroup||reserved.has(s.buildingGroup)))throw new Error('Held-out building leaked into training sources');
 if(!out.startsWith(privateRoot+path.sep))throw new Error('Private training output must be under .data');
 const classes=config.classes;
 if(config.schemaVersion!=='ark-object-labels-1'||![OBJECT_CLASSES.join(','),OBJECT_CLASSES.slice(0,6).join(',')].includes(classes?.join(','))||!config.annotator)throw new Error('Invalid object label package');
 try{await fs.access(out);throw new Error('Existing training packages cannot be overwritten');}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const d of ['images','labels','review'])await fs.mkdir(path.join(out,d),{recursive:true});
 const records=[],sources=[],counts=Object.fromEntries(classes.map(c=>[c,0]));
 const save=async(bytes,items,metadata)=>{
   if(!items.length&&!metadata.negative)return;
   const stem=`object-${String(records.length+1).padStart(4,'0')}`,size=640;
   const encoded=await sharp(bytes).resize(size,size,{fit:'fill'}).png().toBuffer();
   const labels=items.map(i=>`${classes.indexOf(i.kind)} ${(i.box[0]+i.box[2])/2/size} ${(i.box[1]+i.box[3])/2/size} ${(i.box[2]-i.box[0])/size} ${(i.box[3]-i.box[1])/size}`).join('\n')+'\n';
   await fs.writeFile(path.join(out,'images',stem+'.png'),encoded);await fs.writeFile(path.join(out,'labels',stem+'.txt'),labels);
   records.push({id:stem,image:`images/${stem}.png`,labels:`labels/${stem}.txt`,imageSha256:hash(encoded),...metadata,objects:items.map(i=>({kind:i.kind,box:i.box}))});
   for(const i of items)counts[i.kind]++;
 };
 for(const source of config.images){
   if(!/^[a-z0-9-]{1,100}$/.test(source.id))throw new Error('Invalid source ID');
   const bytes=await fs.readFile(source.path),m=await sharp(bytes).metadata();
   if(source.sourceHash&&hash(bytes)!==source.sourceHash)throw new Error('Source image changed');
   const seen=new Set();
   for(const a of source.annotations){if(!classes.includes(a.kind)||!Array.isArray(a.box)||a.box.length!==4||!a.box.every(Number.isFinite)||a.box[0]<0||a.box[1]<0||a.box[2]>m.width||a.box[3]>m.height||area(a.box)<=0)throw new Error('Invalid object box');seen.add(a.kind);}
   sources.push({id:source.id,hash:hash(bytes),name:path.basename(source.path),buildingGroup:source.buildingGroup,objects:source.annotations.length,annotationQuality:source.annotationQuality});
   const colors=['#a35810','#1859a9','#713ea0','#a32e59','#27814d','#b04024','#3c5185'];
   const overlay=`<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}">${source.annotations.map((a,i)=>`<rect x="${a.box[0]}" y="${a.box[1]}" width="${a.box[2]-a.box[0]}" height="${a.box[3]-a.box[1]}" stroke="${colors[OBJECT_CLASSES.indexOf(a.kind)]}" stroke-width="2" fill="none"/><text x="${a.box[0]}" y="${Math.max(14,a.box[1]-3)}" font-size="12" fill="${colors[OBJECT_CLASSES.indexOf(a.kind)]}">${i+1} ${a.kind}</text>`).join('')}</svg>`;
   await sharp(bytes).composite([{input:Buffer.from(overlay)}]).png().toFile(path.join(out,'review',source.id+'-labels.png'));
   const crops=[];
   for(const edge of [256,640])for(const center of source.annotations.filter((a,n)=>edge===256||n%3===0)){
     const region=completeObjectCrop(source.annotations.map(a=>a.box),m.width,m.height,(center.box[0]+center.box[2])/2,(center.box[1]+center.box[3])/2,Math.min(edge,m.width,m.height));
     const key=region.join(',');if(crops.some(c=>c.key===key))continue;crops.push({key,region});
   }
   for(const crop of crops){
     const region=crop.region,w=region[2]-region[0],h=region[3]-region[1],k=Math.min(640/w,640/h),rw=Math.round(w*k),rh=Math.round(h*k),padX=Math.floor((640-rw)/2),padY=Math.floor((640-rh)/2);
     const clipped=source.annotations.filter(a=>a.box[0]>=region[0]&&a.box[1]>=region[1]&&a.box[2]<=region[2]&&a.box[3]<=region[3]).map(a=>({kind:a.kind,box:[(a.box[0]-region[0])*rw/w+padX,(a.box[1]-region[1])*rh/h+padY,(a.box[2]-region[0])*rw/w+padX,(a.box[3]-region[1])*rh/h+padY]}));
     const raster=await sharp(bytes).extract({left:region[0],top:region[1],width:w,height:h}).resize(rw,rh).extend({left:padX,top:padY,right:640-rw-padX,bottom:640-rh-padY,background:'#fff'}).png().toBuffer();
     for(const turn of [0,1])await save(await sharp(raster).rotate(turn*90).png().toBuffer(),clipped.map(i=>({...i,box:rotateBox(i.box,640,turn)})),{sourceIds:[source.id],buildingGroups:[source.buildingGroup],crop:region,rotation:turn*90,syntheticComposite:false,split:'train',labelQuality:'agent-annotated-pilot'});
   }
   for(const b of source.negativeRegions??[]){
     if(!Array.isArray(b)||b.length!==4||!b.every(Number.isInteger)||b[0]<0||b[1]<0||b[2]>m.width||b[3]>m.height||area(b)<=0||source.annotations.some(a=>inside(a.box,b)))throw new Error('Negative crop intersects an annotated target');
     const raster=await sharp(bytes).extract({left:b[0],top:b[1],width:b[2]-b[0],height:b[3]-b[1]}).resize(640,640,{fit:'contain',background:'#fff'}).png().toBuffer();
     for(const turn of [0,1])await save(await sharp(raster).rotate(turn*90).png().toBuffer(),[],{sourceIds:[source.id],buildingGroups:[source.buildingGroup],crop:b,rotation:turn*90,syntheticComposite:false,split:'train',negative:true,labelQuality:'agent-reviewed-no-targets-pilot'});
   }
 }
 const cache=new Map(),prototypes=[];
 for(const p of config.cadPrototypes??[]){
   if(!cache.has(p.vectors)){const raw=await fs.readFile(p.vectors);const v=JSON.parse(raw);cache.set(p.vectors,{...v,shapes:v.shapes??v.cad?.entities,sourceHash:v.sourceHash??hash(raw)});}
   const v=cache.get(p.vectors),shapes=selectPrototype(v.shapes.filter(s=>s.group===p.group&&s.kind!=='text'),p.selection);
   if(!shapes.length)throw new Error('Empty prototype');
   const rendered=vectorSvg(shapes),raster=await sharp(rendered.svg).png().toBuffer(),meta=await sharp(raster).metadata();
   await fs.writeFile(path.join(out,'review',`${prototypes.length+1}-${p.kind}-cad.png`),raster);
   prototypes.push({kind:p.kind,raster,shapes,width:meta.width,height:meta.height,sourceId:v.sourceHash,group:p.group,buildingGroup:p.buildingGroup});
   sources.push({id:v.sourceHash,name:p.sourceName,buildingGroup:p.buildingGroup,group:p.group,selection:p.selection,selectedBounds:rendered.bounds,selectedEntityIds:shapes.map(s=>s.id),annotationQuality:p.review});
 }
 // Large, complete symbols are rendered from vectors (not enlarged thick PNG
 // strokes). This covers scale changes without using the reserved test building.
 const prototypeSizes=config.prototypeSizes??[280,520];
 if(!Array.isArray(prototypeSizes)||!prototypeSizes.length||prototypeSizes.length>6||prototypeSizes.some(n=>!Number.isInteger(n)||n<24||n>520))throw new Error('Invalid prototype scales');
 for(const p of prototypes)for(const edge of prototypeSizes){
   const vector=vectorSvg(p.shapes,edge),raster=await sharp(vector.svg).png().toBuffer(),m=await sharp(raster).metadata(),left=Math.floor((640-m.width)/2),top=Math.floor((640-m.height)/2);
   const canvas=await sharp({create:{width:640,height:640,channels:3,background:'#fff'}}).composite([{input:raster,left,top}]).png().toBuffer();
   for(const turn of [0,1])await save(await sharp(canvas).rotate(turn*90).png().toBuffer(),[{kind:p.kind,box:rotateBox([left+6,top+6,left+m.width-6,top+m.height-6],640,turn)}],{sourceIds:[p.sourceId],buildingGroups:[p.buildingGroup],syntheticComposite:true,split:'train',labelQuality:'complete-reviewed-CAD-prototype-multiscale'});
 }
 if(config.fragmentNegatives)for(const p of prototypes.filter(p=>p.kind==='chair')){
   const vector=vectorSvg(p.shapes,520),raster=await sharp(vector.svg).png().toBuffer(),m=await sharp(raster).metadata();
   const width=Math.max(8,Math.round(m.width*.16)),fragment=await sharp(raster).extract({left:m.width-width,top:0,width,height:m.height}).png().toBuffer();
   const image=await sharp({create:{width:640,height:640,channels:3,background:'#fff'}}).composite([{input:fragment,left:300,top:Math.floor((640-m.height)/2)}]).png().toBuffer();
   for(const turn of [0,1,2,3])await save(await sharp(image).rotate(turn*90).png().toBuffer(),[],{sourceIds:[p.sourceId],buildingGroups:[p.buildingGroup],split:'train',negative:true,syntheticComposite:true,labelQuality:'reviewed-prototype-fragment-not-a-complete-object'});
 }
 // Compositions use real CAD strokes and retain their origin. They are augmentations, not new buildings.
 for(let n=0;n<12;n++){
   const overlays=[],items=[],sourceIds=new Set(),buildingGroups=new Set();
   for(let j=0;j<9;j++){
     const p=prototypes[(j+n)%prototypes.length],factor=(.32+(n%4)*.09),w=Math.round(p.width*factor),h=Math.round(p.height*factor);
     const left=35+(j%3)*205+(n*7)%35,top=35+Math.floor(j/3)*205+(n*11)%30;
     overlays.push({input:await sharp(p.raster).resize(w,h).png().toBuffer(),left,top});items.push({kind:p.kind,box:[left,top,left+w,top+h]});sourceIds.add(p.sourceId);buildingGroups.add(p.buildingGroup);
   }
   const image=await sharp({create:{width:640,height:640,channels:3,background:'#fff'}}).composite(overlays).png().toBuffer();
   await save(image,items,{sourceIds:[...sourceIds],buildingGroups:[...buildingGroups],syntheticComposite:true,split:'train',labelQuality:'agent-reviewed-CAD-prototype-derived'});
 }
 const manifest={schemaVersion:'ark-object-training-1',createdAt:new Date().toISOString(),classes,
   annotator:config.annotator,independentReviewer:config.independentReviewer,independentValidation:false,
   annotationPolicy:'pilot-agent-labels; excluded from independent architectural benchmark',configurationSha256:hash(configBytes),...(parentBytes?{replayConfigurationSha256:hash(parentBytes)}:{}),heldOutBuildingGroups:[...reserved],sources,records,
   summary:{images:records.length,originalObjects:config.images.reduce((n,s)=>n+s.annotations.length,0),cadPrototypes:prototypes.length,augmentedObjects:counts,uniqueBuildingGroups:[...new Set(sources.map(s=>s.buildingGroup))]}};
 const manifestBytes=JSON.stringify(manifest,null,2);await fs.writeFile(path.join(out,'manifest.json'),manifestBytes);
 const list=records.map(r=>path.join(out,r.image).replaceAll('\\','/')).join('\n')+'\n';await fs.writeFile(path.join(out,'train.txt'),list);
 // Ultralytics requires a validation path. This diagnostic is explicitly training-fit only.
 await fs.writeFile(path.join(out,'data.yaml'),`path: ${JSON.stringify(out.replaceAll('\\','/'))}\ntrain: train.txt\nval: train.txt\nnc: ${classes.length}\nnames: ${JSON.stringify(classes)}\n`);
 console.log(JSON.stringify(manifest.summary,null,2));return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){const [config,out]=process.argv.slice(2);if(!config||!out)throw new Error('Usage: node training/prepare_object_pilot.mjs labels.json .data/training/unique-package');await prepareObjectPilot(config,out);}
