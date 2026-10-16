import assert from 'node:assert/strict';
import test from 'node:test';
import {architectureTiles} from '../src/modules/plan-digitization/infrastructure/architecture-tiles.js';
test('detail crops are bounded, overlap and never lose any learned region extent',()=>{
 for(const r of [{x:10,y:20,width:400,height:1200},{x:100,y:100,width:1600,height:1200}]){
  const tiles=architectureTiles(r);assert(tiles.length<=4);assert(tiles.length>=2);
  assert.equal(Math.min(...tiles.map(t=>t.x)),r.x);assert.equal(Math.max(...tiles.map(t=>t.x+t.width)),r.x+r.width);
  assert.equal(Math.min(...tiles.map(t=>t.y)),r.y);assert.equal(Math.max(...tiles.map(t=>t.y+t.height)),r.y+r.height);
  for(const t of tiles)assert(t.width<=900&&t.height<=900&&t.x>=r.x&&t.y>=r.y);
 }
 assert.deepEqual(architectureTiles({x:0,y:0,width:500,height:600}),[]);
 assert.throws(()=>architectureTiles({x:0,y:0,width:Infinity,height:10}));
});
