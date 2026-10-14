import {fail} from "../../../errors.js";
import {validNeuralModel,validNeuralTiling,validNeuralInstances} from "./neural-contract.js";
export function validateCadNeural(cad) {
  if(cad.neural===undefined)return;
  const invalid=()=>fail(422,"Invalid neural CAD proposal.");
  if(!Array.isArray(cad.neural)||cad.neural.length>12)invalid();
  const regions=new Set(cad.regions.map(r=>r.id)),sources=new Set(cad.entities.map(e=>e.id)),ids=new Set();
  for(const a of cad.neural) {
    if(!a||!regions.has(a.regionId)||ids.has(a.regionId)||typeof a.sourceSignature!=="string"||!/^v1-[a-f0-9]{16}$/.test(a.sourceSignature)||typeof a.applied!=="boolean")invalid();
    ids.add(a.regionId);
    const m=a.model;
    if(!validNeuralModel(m)||!validNeuralTiling(a.tiling))invalid();
    if(typeof a.overlay!=="string"||a.overlay.length>=1_500_000||!/^data:image\/png;base64,/.test(a.overlay)||!Number.isFinite(a.elapsedMs)||a.elapsedMs<0||a.elapsedMs>=(a.tiling?90_000*a.tiling.tileCount+10_000:180000)||
      !Array.isArray(a.counts)||a.counts.length!==m.classes.length||!a.counts.every(n=>Number.isInteger(n)&&n>=0&&n<=512*512*(a.tiling?.tileCount??1)))invalid();
    if(!Array.isArray(a.walls)||a.walls.length>10000||!validNeuralInstances(a.openings,m.classes,a.walls.length,true,a.tiling?.tileCount??1)||!validNeuralInstances(a.fixtures,m.classes,a.walls.length,false,a.tiling?.tileCount??1))invalid();
    for(const w of a.walls) {
      if(!w||!Array.isArray(w.a)||!Array.isArray(w.b)||w.a.length!==2||w.b.length!==2||![...w.a,...w.b,w.thickness].every(n=>Number.isFinite(n)&&Math.abs(n)<1e9)||w.thickness<=0||w.thickness>.8||
        w.sourceIds!==undefined&&(!Array.isArray(w.sourceIds)||w.sourceIds.length>500||!w.sourceIds.every(id=>sources.has(id))))invalid();
    }
  }
}
