/** Optional second reading of the entire learned foreground, never a hand-picked
 * house region. Retain generous context and skip focus when it would discard
 * multiple dispersed drawings or produce little extra resolution. */
export function neuralFocus(decoded, content, sourceSize, grid=512) {
  let minX=grid,minY=grid,maxX=-1,maxY=-1,count=0;
  for(let y=content.y;y<content.y+content.height;y++)for(let x=content.x;x<content.x+content.width;x++) {
    const i=y*grid+x;
    const learned=decoded.mask[i]>0 && decoded.mask[i]!==12 && decoded.scores[i]>=140 || decoded.spaces && ![0,2,8].includes(decoded.spaces.mask[i]) && decoded.spaces.scores[i]>=140;
    if(!learned)continue;
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);count++;
  }
  if(count<128||maxX-minX<24||maxY-minY<24)return null;
  const pad=16,scaleX=sourceSize.width/content.width,scaleY=sourceSize.height/content.height;
  const x=Math.max(0,Math.floor((minX-content.x-pad)*scaleX)),y=Math.max(0,Math.floor((minY-content.y-pad)*scaleY));
  const right=Math.min(sourceSize.width,Math.ceil((maxX+1-content.x+pad)*scaleX)),bottom=Math.min(sourceSize.height,Math.ceil((maxY+1-content.y+pad)*scaleY));
  const width=right-x,height=bottom-y;
  if(width*height>sourceSize.width*sourceSize.height*.8)return null;
  // A tall sheet whose height barely changes gains no actual sampling resolution.
  if(Math.max(width,height)>Math.max(sourceSize.width,sourceSize.height)*.88)return null;
  return {x,y,width,height};
}
