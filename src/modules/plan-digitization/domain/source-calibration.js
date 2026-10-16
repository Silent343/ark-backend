/** Persist actual source-image anchors; never fabricate a full-sheet measurement. */
export function validSourceCalibration(c,ratio){
  const size=c?.sourceSize,points=c?.referencePoints;
  return !!size&&[size.width,size.height].every(n=>Number.isInteger(n)&&n>0&&n<=6000)&&
    Array.isArray(points)&&points.length===2&&points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[1]>=0&&p[0]<=size.width&&p[1]<=size.height)&&
    Number.isFinite(c.referenceDistanceM)&&c.referenceDistanceM>0&&c.referenceDistanceM<=1000&&Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1])>=10&&
    (ratio===undefined||(Number.isFinite(ratio)&&ratio>0&&Math.abs(c.referenceDistanceM/Math.hypot(points[1][0]-points[0][0],points[1][1]-points[0][1])-ratio)<=Math.max(1e-10,ratio*1e-8)));
}
