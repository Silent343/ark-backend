/** At most four detail crops with overlap. Never spans outside the learned source region. */
export function architectureTiles(region) {
  const {x,y,width,height}=region;
  if(![x,y,width,height].every(Number.isInteger)||width<1||height<1)throw new Error('Invalid architecture region');
  if(Math.max(width,height)<700)return [];
  const edge=Math.max(512,Math.min(900,Math.ceil(Math.max(width,height)*.62)));
  const w=Math.min(width,edge),h=Math.min(height,edge);
  const xs=width>w?[x,x+width-w]:[x],ys=height>h?[y,y+height-h]:[y];
  return ys.flatMap(top=>xs.map(left=>({x:left,y:top,width:w,height:h})));
}
