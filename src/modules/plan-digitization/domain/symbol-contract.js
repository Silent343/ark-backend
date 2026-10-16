export const SYMBOL_CLASSES = 'bath bath_tub bay_window bed bedside_cupboard blind_window chair class_31 class_32 class_34 class_35 double_door elevator escalator gas_stove half_height_cabinet high_cabinet opening_symbol parking railing refrigerator single_door sink sliding_door sofa squat_toilet stair table toilet tv_cabinet urinal wall wardrobe washing_machine window'.split(' ');
export const SYMBOL_KINDS = ['chair','table','sofa','bed','plant','stair'];
export const PILOT_SYMBOL_CLASSES = ['chair','table','sofa','bed','plant','stair'];
export const SYMBOL_MODEL_ID = 'floorcad-symbols-v1';
export function validSymbolModel(m) {
  if(m?.id==='ark-objects-pilot-v1')return m.usage==='experimental-research'&&m.size===640&&
    /^[a-f0-9]{40}$/.test(m.revision)&&['checkpointSha256','artifactSha256'].every(k=>/^[a-f0-9]{64}$/.test(m[k]))&&
    Array.isArray(m.classes)&&m.classes.join(',')===PILOT_SYMBOL_CLASSES.join(',')&&
    m.training?.independentValidation===false&&m.training.annotationQuality==='agent-provisional'&&
    /^[a-f0-9]{64}$/.test(m.training.datasetSha256)&&Number.isInteger(m.training.images)&&m.training.images>0&&m.training.images<=10000&&
    Number.isInteger(m.training.epochs)&&m.training.epochs>=1&&m.training.epochs<=1000;
  return !!m && m.id===SYMBOL_MODEL_ID && m.revision==='02995225d7aed598bc7e0214f5b7f3fe7fe95657' &&
    m.checkpointSha256==='be1a5a404c5ad1c454ba7531e2c16548a6330945319cbf989751ff73578b494c' &&
    /^[a-f0-9]{64}$/.test(m.artifactSha256) && m.usage==='experimental-research' &&
    m.size===640 && Array.isArray(m.classes) && m.classes.join(',')===SYMBOL_CLASSES.join(',');
}
export function validSymbols(s,size) {
  if(s===undefined)return true;
  if(!s||!validSymbolModel(s.model)||s.threshold!==0.35||!Number.isInteger(s.passes)||s.passes<1||s.passes>10||
    !Number.isFinite(s.elapsedMs)||s.elapsedMs<0||s.elapsedMs>90000||!Array.isArray(s.items)||s.items.length>300)return false;
  const ids=new Set();
  return s.items.every(i=>{
    if(!i||typeof i.id!=='string'||!/^symbol-\d+$/.test(i.id)||ids.has(i.id)||!SYMBOL_KINDS.includes(i.kind)||!s.model.classes.includes(i.kind)||
      !Number.isFinite(i.score)||i.score<s.threshold||i.score>1||!Array.isArray(i.box)||i.box.length!==4||!i.box.every(Number.isFinite)||
      i.box[0]<0||i.box[1]<0||i.box[2]<=i.box[0]||i.box[3]<=i.box[1]||i.box[2]>size.width||i.box[3]>size.height||
      !['proposed','rejected','confirmed'].includes(i.status)||![0,90,180,270].includes(i.rotation)||
      (i.stairType!==undefined && (i.kind!=='stair'||!['straight','spiral'].includes(i.stairType))))return false;
    ids.add(i.id);return true;
  });
}
