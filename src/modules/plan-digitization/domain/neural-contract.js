export const CORE_NEURAL_CLASSES = ["background","wall","door","window"];
export const EXPANDED_NEURAL_CLASSES = [...CORE_NEURAL_CLASSES,"cabinet","equipment","toilet","sink","bench","fireplace","bathtub","chimney","railing"];
export const NEURAL_MODELS = {
  "openbim-m2-unet": {label:"OpenBIM · arquitectura",classes:CORE_NEURAL_CLASSES,directory:"openbim-m2-v1"},
  "yytsi-resnet34-unet": {label:"U-Net · arquitectura",classes:CORE_NEURAL_CLASSES},
  "cubicasa-multitask-v1": {label:"CubiCasa · arquitectura y equipamiento",classes:EXPANDED_NEURAL_CLASSES,directory:"cubicasa-multitask-v1"},
  "ark-architecture-pilot-v1": {label:"Ark · aberturas (piloto)",classes:EXPANDED_NEURAL_CLASSES,directory:"ark-architecture-pilot-v1",candidate:true},
  "ark-architecture-pilot-v2": {label:"Ark · suelos y aberturas (candidato)",classes:EXPANDED_NEURAL_CLASSES,directory:"ark-architecture-pilot-v2",candidate:true},
};
export const SPACE_MODEL_IDS=['cubicasa-multitask-v1','ark-architecture-pilot-v1','ark-architecture-pilot-v2'];
export function validNeuralModel(model) {
  if(['ark-architecture-pilot-v1','ark-architecture-pilot-v2'].includes(model?.id)&&(!model.training||model.training.annotationQuality!=='agent-provisional'||model.training.independentValidation!==false||model.training.parentCheckpointSha256!=='dd20b4e1bf1d670f2125107b079df06958b1ccd36e49a464ab739aeb00b8e7a2'||!/^[a-f0-9]{64}$/.test(model.training.datasetSha256)||!Number.isInteger(model.training.images)||model.training.images<1||model.training.images>10000||!Number.isInteger(model.training.epochs)||model.training.epochs<1||model.training.epochs>1000))return false;
  if(model?.id==='ark-architecture-pilot-v2'&&(!/^[a-f0-9]{64}$/.test(model.training.openingCheckpointSha256)||!/^[a-f0-9]{64}$/.test(model.training.openingArtifactSha256)||!Number.isInteger(model.training.openingEpochs)||model.training.openingEpochs<1||model.training.openingEpochs>1000))return false;
  return !!model && Object.hasOwn(NEURAL_MODELS,model.id) && typeof model.revision==="string" && /^(?:[a-f0-9]{40}|v1\.0\.0)$/.test(model.revision) &&
    typeof model.checkpointSha256==="string" && /^[a-f0-9]{64}$/.test(model.checkpointSha256) && typeof model.artifactSha256==="string" && /^[a-f0-9]{64}$/.test(model.artifactSha256) &&
    model.usage==="experimental-research" && Array.isArray(model.classes) && model.classes.join(",")===NEURAL_MODELS[model.id].classes.join(",");
}
export function validNeuralTiling(tiling) {
  return tiling===undefined || !!tiling && tiling.tileSize===512 && tiling.overlapRatio===.2 && Number.isInteger(tiling.tileCount) && tiling.tileCount>=1 && tiling.tileCount<=128 &&
    Number.isFinite(tiling.metersPerPixel) && tiling.metersPerPixel>=.005 && tiling.metersPerPixel<=.1 && tiling.complete===true;
}
/** Bounds and explicit approval are enforced on both sides of the API. */
export function validNeuralInstances(items, classes, wallCount, opening, tileCount=1) {
  if (items === undefined) return true;
  if (!Array.isArray(items) || items.length > 2000) return false;
  const ids = new Set();
  const point = p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && Math.abs(n) < 1e9);
  return items.every(item => {
    if (!item || typeof item.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(item.id) || ids.has(item.id) ||
      !classes.includes(item.kind) || ["background","wall"].includes(item.kind) || typeof item.approved !== "boolean" ||
      !Number.isFinite(item.score) || item.score < 0 || item.score > 1 ||
      !Array.isArray(item.polygon) || item.polygon.length < 3 || item.polygon.length > 256 || !item.polygon.every(point) ||
      !Array.isArray(item.tileIds) || !item.tileIds.length || item.tileIds.length > 128 ||
      new Set(item.tileIds).size!==item.tileIds.length || !item.tileIds.every(id => typeof id === "string" && /^tile-(0|[1-9][0-9]*)$/.test(id) && Number(id.slice(5))<tileCount) ||
      item.heightM !== undefined && (!Number.isFinite(item.heightM) || item.heightM <= 0 || item.heightM > 10)) return false;
    ids.add(item.id);
    const area = Math.abs(item.polygon.reduce((sum,p,i) => {const q=item.polygon[(i+1)%item.polygon.length];return sum+p[0]*q[1]-q[0]*p[1];},0))/2;
    if (!Number.isFinite(area) || area <= 1e-12) return false;
    const polygon=item.polygon;
    if(new Set(polygon.map(p=>p.join(":"))).size!==polygon.length)return false;
    let winding=0,sign=0;
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],c=polygon[(i+2)%polygon.length];
      const ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-b[0],vy=c[1]-b[1];
      const cross=ux*vy-uy*vx;
      if(Math.abs(cross)>1e-12){if(sign&&Math.sign(cross)!==sign)return false;sign=Math.sign(cross);}
      winding+=Math.atan2(cross,ux*vx+uy*vy);
    }
    if(Math.abs(Math.abs(winding)-Math.PI*2)>1e-6)return false;
    if (opening) {
      if (!["door","window"].includes(item.kind) || !["hosted","unhosted","ambiguous"].includes(item.hostStatus)) return false;
      if (item.hostStatus === "hosted") {
        if (!Number.isInteger(item.hostWallIndex) || item.hostWallIndex < 0 || item.hostWallIndex >= wallCount || !point(item.center) ||
          !Number.isFinite(item.widthM) || item.widthM < .2 || item.widthM > 8) return false;
      } else if (item.hostWallIndex !== undefined || item.center !== undefined || item.widthM !== undefined || item.approved) return false;
      if (item.sillM !== undefined && (!Number.isFinite(item.sillM) || item.sillM < 0 || item.sillM > 10)) return false;
      if (item.approved && (item.heightM === undefined || item.kind === "window" && item.sillM === undefined)) return false;
    } else if (["door","window"].includes(item.kind) || item.approved && (item.kind === "railing" || item.heightM === undefined)) return false;
    return true;
  });
}
