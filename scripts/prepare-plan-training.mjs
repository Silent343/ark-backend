import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import sharp from "sharp";

export const TRAINING_CLASSES=["background","wall","door","window","column","stair","cabinet","equipment","toilet","sink","chair","table","bed","sofa","bench","bathtub","fireplace","chimney","railing","water","drain","valve","room","outdoor","slab","plant","vehicle"];
const escape=s=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
export function trainingEligible(task) {
  return task.reviewed===true && task.cropConfirmed===true && task.previewTruncated!==true &&
    task.viewType==="plan" && typeof task.annotator==="string" && task.annotator.trim().length>0 &&
    typeof task.reviewer==="string" && task.reviewer.trim().length>0 && task.reviewer.trim()!==task.annotator.trim() &&
    TRAINING_CLASSES.filter(c=>c!=="background").every(c=>task.exhaustiveClasses?.includes(c)) &&
    Array.isArray(task.annotations) && task.annotations.length>0 && task.annotations.every(a=>
      a.reviewed===true && TRAINING_CLASSES.includes(a.class) && a.class!=="background" &&
      a.geometry==="polygon" && Array.isArray(a.points) && a.points.length>=3 && a.points.length<=1000 &&
      a.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=task.crop[0]&&p[0]<=task.crop[2]&&p[1]>=task.crop[1]&&p[1]<=task.crop[3]) &&
      Math.abs(a.points.reduce((sum,p,i)=>{const q=a.points[(i+1)%a.points.length];return sum+p[0]*q[1]-q[0]*p[1];},0))>1e-12);
}

export async function prepareTraining(batchFile,outDir) {
  const batch=JSON.parse(fs.readFileSync(batchFile,"utf8"));
  if(batch.schemaVersion!=="ark-review-draft-1" || !Array.isArray(batch.tasks))throw new Error("Unsupported review batch.");
  const out=path.resolve(outDir),privateRoot=path.resolve(import.meta.dirname,"../.data");
  if(!out.startsWith(privateRoot+path.sep))throw new Error("Training data must stay in the ignored .data directory.");
  if(fs.existsSync(out))throw new Error("Choose a new output folder; existing labels are never overwritten.");
  for(const folder of ["images","masks","pending"])fs.mkdirSync(path.join(out,folder),{recursive:true});
  const records=[],pending=[],groups=new Set();
  const auditPath=path.resolve(path.dirname(batchFile),"../audit.json");
  const inventory=fs.existsSync(auditPath)?JSON.parse(fs.readFileSync(auditPath,"utf8")).files.map(f=>({name:f.name,hash:f.hash,bytes:f.bytes})):[];
  fs.writeFileSync(path.join(out,"source-inventory.json"),JSON.stringify({sourceFiles:inventory,annotationStage:"review-crops-selected; remaining views need classification and annotation"},null,2));
  for(const [index,task] of batch.tasks.entries()) {
    if(!task.sourceGroup)throw new Error("Confirm the building group before preparing training data.");
    groups.add(task.sourceGroup);
    const [x0,y0,x1,y1]=task.crop;
    if(![x0,y0,x1,y1].every(Number.isFinite)||x1<=x0||y1<=y0)throw new Error("Invalid crop.");
    const size=1024,scale=Math.min((size-32)/(x1-x0),(size-32)/(y1-y0));
    const offsetX=(size-(x1-x0)*scale)/2,offsetY=(size-(y1-y0)*scale)/2;
    const point=p=>[offsetX+(p[0]-x0)*scale,offsetY+(y1-p[1])*scale];
    const polygon=points=>points.map(p=>point(p).join(",")).join(" ");
    const drawings=(task.shapes??[]).map(s=>{
      const color=/^#[0-9a-f]{3,8}$/i.test(s.color??"")?s.color:"#333333";
      if(s.kind==="path"){
        const points=[];for(let i=0;i<s.points.length;i+=2)points.push([s.points[i],s.points[i+1]]);
        return `<${s.closed?"polygon":"polyline"} points="${polygon(points)}" fill="none" stroke="${color}" stroke-width="1"/>`;
      }
      if(s.kind==="circle") {const [x,y]=point([s.x,s.y]);return `<circle cx="${x}" cy="${y}" r="${s.radius*scale}" fill="none" stroke="${color}" stroke-width="1"/>`;}
      if(s.kind==="text") {const [x,y]=point([s.x,s.y]);return `<text x="${x}" y="${y}" font-size="${Math.max(1,Math.min(60,s.height*scale))}" fill="${color}" transform="rotate(${-s.rotation*180/Math.PI} ${x} ${y})">${escape(s.value)}</text>`;}
      return "";
    }).join("");
    const svg=body=>`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="white"/>${body}</svg>`;
    const stem=`${String(index+1).padStart(3,"0")}-${task.sourceHash.slice(0,16)}`;
    await sharp(Buffer.from(svg(drawings))).png().toFile(path.join(out,"images",stem+".png"));
    const eligible=trainingEligible(task),segments=[];
    if(eligible) {
      const maskShapes=task.annotations.map((a,i)=>{
        const id=i+1;segments.push({id,category_id:TRAINING_CLASSES.indexOf(a.class),iscrowd:0});
        const color=`rgb(${id&255},${(id>>8)&255},${(id>>16)&255})`;
        return `<polygon points="${polygon(a.points)}" fill="${color}" shape-rendering="crispEdges"/>`;
      }).join("");
      const maskSvg=svg(maskShapes).replace('fill="white"','fill="black"');
      await sharp(Buffer.from(maskSvg)).png().toFile(path.join(out,"masks",stem+".png"));
    }
    const record={id:stem,image:`images/${stem}.png`,mask:eligible?`masks/${stem}.png`:null,
      sourceName:task.sourceName,sourceHash:task.sourceHash,buildingGroup:task.sourceGroup,
      coordinateTransform:{x0,y1,scale,offsetX,offsetY},width:size,height:size,
      split:eligible?"train":"pending-review",reviewed:eligible,segments_info:segments};
    records.push(record);
    if(!eligible) {
      pending.push(stem);
      fs.writeFileSync(path.join(out,"pending",stem+".json"),JSON.stringify({
        ...task,shapes:undefined,allowedClasses:TRAINING_CLASSES.filter(c=>c!=="background"),
        image:record.image,coordinateTransform:record.coordinateTransform,
        note:"CAD-coordinate annotations. Proposals are retained for review, never exported as training labels.",
      },null,2));
    }
  }
  const manifest={schemaVersion:"ark-panoptic-training-1",createdAt:new Date().toISOString(),
    sourceBatchSha256:createHash("sha256").update(fs.readFileSync(batchFile)).digest("hex"),
    rightsStatus:batch.rightsStatus,classes:TRAINING_CLASSES,
    splitPolicy:"building-group-disjoint; all Larco drawings belong to one building; validation/test require other buildings",
    independentValidationReady:false,records,
    summary:{sourceFiles:inventory.length,images:records.length,trainingReady:records.filter(r=>r.reviewed).length,pendingReview:pending.length,buildingGroups:[...groups]}};
  fs.writeFileSync(path.join(out,"manifest.json"),JSON.stringify(manifest,null,2));
  return manifest.summary;
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){
  const [batch,out]=process.argv.slice(2);if(!batch||!out)throw new Error("Usage: node scripts/prepare-plan-training.mjs review-batch.json .data/training/new-run");
  console.log(JSON.stringify(await prepareTraining(batch,out),null,2));
}
