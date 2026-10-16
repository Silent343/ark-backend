import test from "node:test";
import assert from "node:assert/strict";
import {neuralFocus} from "../src/modules/plan-digitization/infrastructure/neural-focus.js";
test("focused inference preserves all learned foreground and source bounds",()=>{
  const mask=new Uint8Array(512*512),scores=new Uint8Array(mask.length).fill(255);
  for(let y=150;y<300;y++)for(let x=200;x<300;x++)mask[y*512+x]=1;
  const region=neuralFocus({mask,scores},{x:0,y:0,width:512,height:512},{width:1024,height:1024});
  assert(region);assert(region.x<400&&region.y<300);assert(region.x+region.width>600&&region.y+region.height>600);
  mask.fill(1);
  assert.equal(neuralFocus({mask,scores},{x:0,y:0,width:512,height:512},{width:1024,height:1024}),null,"no wasteful extra pass for full-page content");
  mask.fill(0);
  assert.equal(neuralFocus({mask,scores},{x:0,y:0,width:512,height:512},{width:1024,height:1024}),null);
});
