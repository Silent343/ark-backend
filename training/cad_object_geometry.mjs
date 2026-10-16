/** Bounds for the private corpus's flattened CAD primitives; no frontend runtime dependency. */
export function entityBounds(shape) {
  if(shape.kind==='path'){
    const box=[Infinity,Infinity,-Infinity,-Infinity];
    for(let n=0;n<shape.points.length;n+=2){box[0]=Math.min(box[0],shape.points[n]);box[1]=Math.min(box[1],shape.points[n+1]);box[2]=Math.max(box[2],shape.points[n]);box[3]=Math.max(box[3],shape.points[n+1]);}
    return box;
  }
  const radius=shape.kind==='circle'?shape.radius:Math.max(shape.height??0,.001);
  return [shape.x-radius,shape.y-radius,shape.x+radius,shape.y+radius];
}
export function combinedBounds(shapes) {
  const box=[Infinity,Infinity,-Infinity,-Infinity];
  for(const shape of shapes){const b=entityBounds(shape);box[0]=Math.min(box[0],b[0]);box[1]=Math.min(box[1],b[1]);box[2]=Math.max(box[2],b[2]);box[3]=Math.max(box[3],b[3]);}
  if(!box.every(Number.isFinite)||box[2]<=box[0]||box[3]<=box[1])throw new Error('Empty or invalid CAD prototype bounds');
  return box;
}
