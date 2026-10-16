import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeSymbols,suppressSymbols,symbolTiles} from '../src/modules/plan-digitization/infrastructure/symbol-inference.js';
import {SYMBOL_CLASSES,PILOT_SYMBOL_CLASSES,validSymbols,validSymbolModel} from '../src/modules/plan-digitization/domain/symbol-contract.js';
const model={id:'floorcad-symbols-v1',revision:'02995225d7aed598bc7e0214f5b7f3fe7fe95657',checkpointSha256:'be1a5a404c5ad1c454ba7531e2c16548a6330945319cbf989751ff73578b494c',artifactSha256:'a'.repeat(64),usage:'experimental-research',size:640,classes:SYMBOL_CLASSES};
test('symbol decoder maps tiles to original pixels and does not relabel unsupported classes',()=>{
  const data=new Float32Array(39*8400),N=8400;
  data[0]=320;data[N]=320;data[2*N]=100;data[3*N]=200;data[(4+6)*N]=.8;
  const decoded=decodeSymbols({data,dims:[1,39,8400]},{x:100,y:200,width:640,height:640},{x:0,y:0,width:640,height:640},{width:1000,height:1500});
  assert.equal(decoded[0].kind,'chair');assert.deepEqual(decoded[0].box,[370,420,470,620]);
  data[(4+31)*N]=.9;
  assert.equal(decodeSymbols({data,dims:[1,39,8400]},{x:0,y:0,width:640,height:640},{x:0,y:0,width:640,height:640},{width:640,height:640}).length,0);
  assert.throws(()=>decodeSymbols({data,dims:[1,35,8400]}, {}, {}, {}));
});
test('symbol suppression is global across tiles, bounded and retains distinct neighboring chairs',()=>{
  const items=suppressSymbols([{kind:'chair',score:.8,box:[0,0,30,30]},{kind:'chair',score:.7,box:[1,1,31,31]},{kind:'chair',score:.8,box:[35,0,65,30]}]);
  assert.equal(items.length,2);assert(items.every(i=>i.status==='proposed'));
  assert.equal(suppressSymbols([{kind:'sofa',score:.95,box:[0,0,100,50]},{kind:'chair',score:.8,box:[5,5,45,45]}]).length,1,'a sofa cushion must not also become a chair');
  assert.equal(suppressSymbols([{kind:'plant',score:.9,box:[0,0,30,30]},{kind:'plant',score:.8,box:[40,0,70,30]},{kind:'plant',score:.7,box:[0,0,71,31]}]).length,2,'an extra vegetation patch must not duplicate its individual plants');
  for(const size of [{width:640,height:640},{width:1151,height:1489},{width:6000,height:6000}]){
    const tiles=symbolTiles(size);assert(tiles.length<=10);
    assert(tiles.every(r=>r.x>=0&&r.y>=0&&r.x+r.width<=size.width&&r.y+r.height<=size.height));
  }
});
test('symbol evidence rejects invalid boxes, fake classes, duplicate ids and invalid reviews',()=>{
  const s={model,threshold:.35,passes:1,elapsedMs:20,items:suppressSymbols([{kind:'bed',score:.9,box:[10,20,50,80]}])},size={width:100,height:100};
  assert(validSymbols(s,size));assert(validSymbols(undefined,size));
  for(const patch of [{box:[0,0,101,50]},{box:[10,10,0,0]},{kind:'plant'},{score:NaN},{status:'trusted'},{rotation:45},{stairType:'spiral'}])assert(!validSymbols({...s,items:[{...s.items[0],...patch}]},size));
  assert(!validSymbols({...s,items:[s.items[0],s.items[0]]},size));
  assert(!validSymbols({...s,model:{...model,usage:'validated-bim'}},size));
});

test('trained pilot decodes plants with its own class order and cannot claim independent validation',()=>{
  const pilot={...model,id:'ark-objects-pilot-v1',revision:'d'.repeat(40),classes:PILOT_SYMBOL_CLASSES,training:{datasetSha256:'e'.repeat(64),images:82,epochs:36,annotationQuality:'agent-provisional',independentValidation:false}};
  assert(validSymbolModel(pilot));assert(!validSymbolModel({...pilot,training:{...pilot.training,independentValidation:true}}));
  const data=new Float32Array(10*8400),N=8400;
  data[0]=100;data[N]=120;data[2*N]=40;data[3*N]=60;data[(4+4)*N]=.9;
  const items=suppressSymbols(decodeSymbols({data,dims:[1,10,8400]},{x:0,y:0,width:640,height:640},{x:0,y:0,width:640,height:640},{width:640,height:640},pilot.classes));
  assert.equal(items[0].kind,'plant');assert(validSymbols({model:pilot,threshold:.35,passes:1,elapsedMs:10,items},{width:640,height:640}));
  assert(!validSymbols({model,threshold:.35,passes:1,elapsedMs:10,items},{width:640,height:640}),'the old model must not claim a class it never learned');
});
