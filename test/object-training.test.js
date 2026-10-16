import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPrototype,rotateBox} from '../training/prepare_object_pilot.mjs';
import {matchBoxes} from '../training/evaluate_objects.mjs';
test('held-out diagnostics match classes and geometry one-to-one, without correcting predictions',()=>{
 const targets=[{kind:'chair',box:[0,0,10,10]},{kind:'table',box:[20,0,40,10]}];
 const predictions=[{id:'a',kind:'chair',score:.9,box:[0,0,10,10]},{id:'b',kind:'chair',score:.8,box:[0,0,10,10]},{id:'c',kind:'sofa',score:.9,box:[20,0,40,10]}];
 const m=matchBoxes(predictions,targets);assert.equal(m.truePositives,1);assert.equal(m.falsePositives,2);assert.equal(m.falseNegatives,1);
});
test('chair labels exclude detached CAD fragments and table labels exclude neighboring stools',()=>{
  const chair=[{kind:'path',closed:true,points:[0,0,2,0,2,3,0,3,0,0]},{kind:'path',closed:false,points:[.1,.2,1.9,.2]},{kind:'path',closed:false,points:[50,0,50,1]}];
  assert.equal(selectPrototype(chair,'largest-connected-ink').length,2);
  const table={kind:'path',closed:true,points:[0,0,10,0,10,2,0,2,0,0]},stool={kind:'circle',x:2,y:4,radius:1};
  assert.deepEqual(selectPrototype([table,stool],'largest-closed-path'),[table]);
  assert.deepEqual(rotateBox([10,20,40,60],100,1),[40,10,80,40]);
  assert.deepEqual(rotateBox([10,20,40,60],100,4),[10,20,40,60]);
});
