import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {SYMBOL_CLASSES,SYMBOL_KINDS} from '../domain/symbol-contract.js';
const SIZE=640,AREA=SIZE*SIZE;
export const SYMBOL_THRESHOLD=0.35;
export function boxIoU(a,b) {
  const intersection=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
  return intersection/((a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-intersection||1);
}
export function suppressSymbols(items) {
  const kept=[];
  for(const item of items.sort((a,b)=>b.score-a.score)) {
    // Conflicting labels on the same furniture cannot create overlapping 3D objects.
    const nestedSeat=k=>{
      if(item.kind!=='chair'||!['sofa','bed'].includes(k.kind))return false;
      const a=item.box,b=k.box,intersection=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
      return intersection/((a[2]-a[0])*(a[3]-a[1]))>.9;
    };
    const plantContainer=item.kind==='plant'&&kept.filter(k=>k.kind==='plant'&&(k.box[0]+k.box[2])/2>item.box[0]&&(k.box[0]+k.box[2])/2<item.box[2]&&(k.box[1]+k.box[3])/2>item.box[1]&&(k.box[1]+k.box[3])/2<item.box[3]).length>=2;
    if(!plantContainer&&!kept.some(k=>boxIoU(k.box,item.box)>(k.kind===item.kind?0.4:0.7)||nestedSeat(k)))kept.push(item);
    if(kept.length===300)break;
  }
  return kept.map((i,n)=>({...i,id:`symbol-${n}`,status:'proposed',rotation:0}));
}
export function decodeSymbols(output,region,content,sourceSize,classes=SYMBOL_CLASSES) {
  if(output.dims.join(',')!==`1,${4+classes.length},8400`)throw new Error('Unexpected symbol detector output.');
  const data=output.data,N=8400,items=[];
  for(let n=0;n<N;n++) {
    let cls=0,score=-Infinity;
    // Argmax over ALL classes; never relabel an unsupported winning class as furniture.
    for(let c=0;c<classes.length;c++)if(data[(c+4)*N+n]>score){cls=c;score=data[(c+4)*N+n];}
    const kind=classes[cls];
    if(score<SYMBOL_THRESHOLD||score>1||!Number.isFinite(score)||!SYMBOL_KINDS.includes(kind))continue;
    const [cx,cy,w,h]=[data[n],data[N+n],data[2*N+n],data[3*N+n]];
    if(![cx,cy,w,h].every(Number.isFinite)||w<=0||h<=0||cx<content.x||cy<content.y||cx>content.x+content.width||cy>content.y+content.height)continue;
    const x=v=>Math.max(region.x,Math.min(region.x+region.width,region.x+(v-content.x)*region.width/content.width));
    const y=v=>Math.max(region.y,Math.min(region.y+region.height,region.y+(v-content.y)*region.height/content.height));
    const box=[x(cx-w/2),y(cy-h/2),x(cx+w/2),y(cy+h/2)];
    if(box[2]-box[0]<3||box[3]-box[1]<3||box[2]>sourceSize.width||box[3]>sourceSize.height)continue;
    // Discard cut-off objects on internal tile boundaries. The full pass and overlapping tiles cover these.
    if((region.x>0&&cx-w/2<content.x+2)||(region.y>0&&cy-h/2<content.y+2)||
      (region.x+region.width<sourceSize.width&&cx+w/2>content.x+content.width-2)||
      (region.y+region.height<sourceSize.height&&cy+h/2>content.y+content.height-2))continue;
    items.push({kind,score,box});
  }
  return items;
}
export function symbolTiles(size,focus,minimumEdge=640) {
  const regions=[{x:0,y:0,...size}];
  const bounds=focus??{x:0,y:0,...size};
  if(Math.max(bounds.width,bounds.height)<=minimumEdge)return regions;
  const edge=Math.max(minimumEdge,Math.ceil(Math.max(bounds.width,bounds.height)/2.6));
  const positions=length=>{if(length<=edge)return [0];const steps=Math.min(2,Math.ceil((length-edge)/(edge*.75)));return Array.from({length:steps+1},(_,i)=>Math.round(i*(length-edge)/steps));};
  for(const y of positions(bounds.height))for(const x of positions(bounds.width))regions.push({x:bounds.x+x,y:bounds.y+y,width:Math.min(edge,bounds.width),height:Math.min(edge,bounds.height)});
  return regions;
}
export async function inferSymbols(bytes,sourceSize,session,manifest,focus) {
  const started=performance.now(),regions=symbolTiles(sourceSize,manifest.id==='ark-objects-pilot-v1'?focus:undefined,manifest.id==='ark-objects-pilot-v1'?384:640),items=[];
  for(const region of regions) {
    const scale=Math.min(SIZE/region.width,SIZE/region.height),w=Math.round(region.width*scale),h=Math.round(region.height*scale);
    const left=Math.floor((SIZE-w)/2),top=Math.floor((SIZE-h)/2);
    const rgb=await sharp(bytes,{limitInputPixels:16_000_000}).extract({left:region.x,top:region.y,width:region.width,height:region.height})
      .flatten({background:'#fff'}).toColourspace('srgb').removeAlpha().resize(w,h,{fit:'fill'})
      .extend({left,top,right:SIZE-w-left,bottom:SIZE-h-top,background:{r:114,g:114,b:114}}).raw().toBuffer();
    const input=new Float32Array(3*AREA);
    for(let n=0;n<AREA;n++)for(let c=0;c<3;c++)input[c*AREA+n]=rgb[3*n+c]/255;
    const output=await session.run({images:new ort.Tensor('float32',input,[1,3,SIZE,SIZE])});
    items.push(...decodeSymbols(output.detections,region,{x:left,y:top,width:w,height:h},sourceSize,manifest.classes));
  }
  const supported=focus?items.filter(i=>{const x=(i.box[0]+i.box[2])/2,y=(i.box[1]+i.box[3])/2;return x>=focus.x&&x<=focus.x+focus.width&&y>=focus.y&&y<=focus.y+focus.height;}):items;
  return {model:manifest,threshold:SYMBOL_THRESHOLD,passes:regions.length,elapsedMs:Math.round(performance.now()-started),items:suppressSymbols(supported)};
}
