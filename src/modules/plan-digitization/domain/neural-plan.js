import {fail} from "../../../errors.js";
export function validateCadNeural(cad) {
  if(cad.neural===undefined)return;
  const invalid=()=>fail(422,"Invalid neural CAD proposal.");
  if(!Array.isArray(cad.neural)||cad.neural.length>12)invalid();
  const regions=new Set(cad.regions.map(r=>r.id)),sources=new Set(cad.entities.map(e=>e.id)),ids=new Set();
  for(const a of cad.neural) {
    if(!a||!regions.has(a.regionId)||ids.has(a.regionId)||typeof a.sourceSignature!=="string"||!/^v1-[a-f0-9]{16}$/.test(a.sourceSignature)||typeof a.applied!=="boolean")invalid();
    ids.add(a.regionId);
    const m=a.model;
    if(!m||!["yytsi-resnet34-unet","openbim-m2-unet"].includes(m.id)||typeof m.revision!=="string"||!/^(?:[a-f0-9]{40}|v1\.0\.0)$/.test(m.revision)||
      typeof m.checkpointSha256!=="string"||!/^[a-f0-9]{64}$/.test(m.checkpointSha256)||typeof m.artifactSha256!=="string"||!/^[a-f0-9]{64}$/.test(m.artifactSha256)||
      m.usage!=="experimental-research"||!Array.isArray(m.classes)||m.classes.join(",")!=="background,wall,door,window")invalid();
    if(typeof a.overlay!=="string"||a.overlay.length>=1_500_000||!/^data:image\/png;base64,/.test(a.overlay)||!Number.isFinite(a.elapsedMs)||a.elapsedMs<0||a.elapsedMs>=180000||
      !Array.isArray(a.counts)||a.counts.length!==4||!a.counts.every(n=>Number.isInteger(n)&&n>=0&&n<=512*512))invalid();
    if(!Array.isArray(a.walls)||a.walls.length>1000)invalid();
    for(const w of a.walls) {
      if(!w||!Array.isArray(w.a)||!Array.isArray(w.b)||w.a.length!==2||w.b.length!==2||![...w.a,...w.b,w.thickness].every(n=>Number.isFinite(n)&&Math.abs(n)<1e9)||w.thickness<=0||w.thickness>.8||
        w.sourceIds!==undefined&&(!Array.isArray(w.sourceIds)||w.sourceIds.length>500||!w.sourceIds.every(id=>sources.has(id))))invalid();
    }
  }
}
