import test from 'node:test';import assert from 'node:assert/strict';
import {validArchitectureLabels} from '../training/prepare_architecture_pilot.mjs';
import {validNeuralModel,EXPANDED_NEURAL_CLASSES} from '../src/modules/plan-digitization/domain/neural-contract.js';
import {decodeNeuralHeads} from '../src/modules/plan-digitization/infrastructure/neural-postprocessing.js';
test('architectural pilot cannot turn provisional masks into independent validation',()=>{
 const p={id:'ark-architecture-pilot-v1',revision:'a'.repeat(40),checkpointSha256:'b'.repeat(64),artifactSha256:'c'.repeat(64),usage:'experimental-research',classes:EXPANDED_NEURAL_CLASSES};
 assert(!validNeuralModel(p));
 const training={annotationQuality:'agent-provisional',independentValidation:false,parentCheckpointSha256:'dd20b4e1bf1d670f2125107b079df06958b1ccd36e49a464ab739aeb00b8e7a2',datasetSha256:'d'.repeat(64),images:20,epochs:24};
 assert(validNeuralModel({...p,training}));assert(!validNeuralModel({...p,training:{...training,independentValidation:true}}));
 const floors={...p,id:'ark-architecture-pilot-v2',training};assert(!validNeuralModel(floors),'Room-only candidate must identify its preserved opening weights');
 assert(validNeuralModel({...floors,training:{...training,openingCheckpointSha256:'e'.repeat(64),openingArtifactSha256:'f'.repeat(64),openingEpochs:48}}));
 assert(!validArchitectureLabels({schemaVersion:'ark-architecture-labels-1',annotationQuality:'agent-provisional',independentValidation:true,sources:[]}));
});
test('uncertain room type does not mean uncertain floor support',()=>{
 const rooms=new Float32Array(12).fill(-4),icons=new Float32Array(11).fill(-4);rooms[3]=2;rooms[4]=2;icons[0]=2;
 const result=decodeNeuralHeads({rooms:{data:rooms},icons:{data:icons}},{id:'ark-architecture-pilot-v1'},1);
 assert(result.spaces.scores[0]<140);assert(result.spaces.coverageScores[0]>240);
 rooms.fill(-4);rooms[2]=5;const wall=decodeNeuralHeads({rooms:{data:rooms},icons:{data:icons}},{id:'cubicasa-multitask-v1'},1);assert(wall.spaces.coverageScores[0]<20,'Strong wall evidence cannot turn into floor coverage');
});
