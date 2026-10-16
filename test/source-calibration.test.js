import test from 'node:test';
import assert from 'node:assert/strict';
import {validSourceCalibration} from '../src/modules/plan-digitization/domain/source-calibration.js';
test('source scale retains real anchors, rejecting invalid and degenerate measurements',()=>{
 const c={sourceSize:{width:1151,height:1489},referencePoints:[[404,1419],[673,1419]],referenceDistanceM:5};
 assert(validSourceCalibration(c));
 assert(validSourceCalibration(c,5/269));assert(!validSourceCalibration(c,.01));assert(!validSourceCalibration(c,NaN));
 for(const patch of [{referenceDistanceM:0},{referenceDistanceM:Infinity},{referencePoints:[[0,0],[2,0]]},{referencePoints:[[0,0],[1152,0]]},{sourceSize:{width:10000,height:1489}}])assert(!validSourceCalibration({...c,...patch}));
});
