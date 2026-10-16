import {fail} from "../../../errors.js";
import {validNeuralModel} from "./neural-contract.js";
import {validSymbols} from "./symbol-contract.js";
export function validateRasterNeural(value) {
  const invalid=()=>fail(422,"Invalid image neural evidence.");
  const p=value,size=p?.sourceSize;
  if(!p||p.version!==1||!p.model||!validNeuralModel(p.model)||!size||
    ![size.width,size.height].every(n=>Number.isInteger(n)&&n>0&&n<=6000)||
    typeof p.overlay!=="string"||p.overlay.length>1_500_000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(p.overlay)||
    !Number.isFinite(p.elapsedMs)||p.elapsedMs<0||p.elapsedMs>150_000||
    !Array.isArray(p.counts)||p.counts.length!==p.model.classes.length||p.counts.some(n=>!Number.isInteger(n)||n<0||n>262144)||
    !Array.isArray(p.walls)||p.walls.length>1000||!Array.isArray(p.instances)||p.instances.length>2000||!validSymbols(p.symbols,size))invalid();
  const point=v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite)&&v[0]>=0&&v[1]>=0&&v[0]<=size.width&&v[1]<=size.height;
  if(p.sourceRegion!==undefined) {const r=p.sourceRegion;if(!r||![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>size.width||r.y+r.height>size.height)invalid();}
  const ids=new Set();
  if(p.spaces!==undefined) {
    if(p.model.id!=="cubicasa-multitask-v1"||!Array.isArray(p.spaces)||p.spaces.length>100)invalid();
    const ring=v=>Array.isArray(v)&&v.length>=3&&v.length<=256&&v.every(point)&&Math.abs(v.reduce((sum,a,j)=>{const b=v[(j+1)%v.length];return sum+a[0]*b[1]-b[0]*a[1];},0))>0;
    const spaceIds=new Set();
    for(const s of p.spaces) {
      if(!s||typeof s.id!=="string"||s.id.length>100||spaceIds.has(s.id)||!["outdoor","kitchen","living","bedroom","bathroom","entry","storage","garage","undefined"].includes(s.kind)||!Number.isFinite(s.score)||s.score<0||s.score>1||!ring(s.polygon)||!Array.isArray(s.holes)||s.holes.length>32||!s.holes.every(ring))invalid();
      spaceIds.add(s.id);
    }
  }
  for(const w of p.walls)if(!w||!point(w.start)||!point(w.end)||!Number.isFinite(w.thickness)||w.thickness<=0||w.thickness>Math.max(size.width,size.height))invalid();
  for(const i of p.instances){
    if(!i||typeof i.id!=="string"||i.id.length>100||ids.has(i.id)||!p.model.classes.includes(i.kind)||["wall","background"].includes(i.kind)||
      !Number.isFinite(i.score)||i.score<0||i.score>1||!Array.isArray(i.polygon)||i.polygon.length<3||i.polygon.length>256||!i.polygon.every(point))invalid();
    ids.add(i.id);
  }
}
