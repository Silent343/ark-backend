/** Expand a crop until every intersected annotation is complete, rather than
 * teaching an armrest or a clipped chair as a full object. No labels are inferred. */
export function completeObjectCrop(boxes,width,height,cx,cy,edge){
 let left=Math.max(0,Math.min(width-edge,Math.round(cx-edge/2))),top=Math.max(0,Math.min(height-edge,Math.round(cy-edge/2)));
 let right=Math.min(width,left+edge),bottom=Math.min(height,top+edge);
 for(let n=0;n<=boxes.length;n++){
  const before=[left,top,right,bottom].join(',');
  for(const b of boxes)if(Math.min(right,b[2])-Math.max(left,b[0])>0&&Math.min(bottom,b[3])-Math.max(top,b[1])>0){left=Math.min(left,Math.floor(b[0]));top=Math.min(top,Math.floor(b[1]));right=Math.max(right,Math.ceil(b[2]));bottom=Math.max(bottom,Math.ceil(b[3]));}
  if(before===[left,top,right,bottom].join(','))return [left,top,right,bottom];
 }
 throw new Error('Object crop closure did not converge');
}
