import {CORE_NEURAL_CLASSES,EXPANDED_NEURAL_CLASSES} from "../domain/neural-contract.js";
// Channel order from CubiCasa5k floortrans/plotting.py::segmentation_plot.
// Kept separately from icon classes: a kitchen is a space, not a fixture.
export const SPACE_CLASSES = ["background","outdoor","wall","kitchen","living","bedroom","bathroom","entry","railing","storage","garage","undefined"];
/** Softmax scores are uncalibrated network outputs, never architectural confidence. */
export function decodeNeuralHeads(outputs,manifest,size=512) {
  const n=size*size, expanded=manifest.id==="cubicasa-multitask-v1", classes=expanded?EXPANDED_NEURAL_CLASSES:CORE_NEURAL_CLASSES;
  const mask=Buffer.alloc(n),scores=Buffer.alloc(n),counts=classes.map(()=>0);
  const spaces=expanded?{classes:SPACE_CLASSES,mask:Buffer.alloc(n),scores:Buffer.alloc(n)}:undefined;
  const expected=expanded?[["rooms",12],["icons",11]]:[["logits",4]];
  for(const [key,channels] of expected)if(!outputs[key]?.data||outputs[key].data.length!==channels*n)throw new Error("Unexpected neural output shape.");
  function best(data,channels,i) {
    let label=0, maximum=data[i];
    for(let c=1;c<channels;c++)if(data[c*n+i]>maximum){maximum=data[c*n+i];label=c;}
    if(!Number.isFinite(maximum))throw new Error("Non-finite neural logits.");
    let denominator=0;for(let c=0;c<channels;c++){if(!Number.isFinite(data[c*n+i]))throw new Error("Non-finite neural logits.");denominator+=Math.exp(data[c*n+i]-maximum);}
    return {label,score:1/denominator};
  }
  const iconMap=[0,3,2,4,5,6,7,8,9,10,11];
  for(let i=0;i<n;i++) {
    let label,score;
    if(expanded) {
      const room=best(outputs.rooms.data,12,i),icon=best(outputs.icons.data,11,i);
      spaces.mask[i]=room.label;spaces.scores[i]=Math.round(255*room.score);
      if(icon.label && icon.score>=.55){label=iconMap[icon.label];score=icon.score;}
      else {label=room.label===2?1:room.label===8?12:0;score=room.score;}
    } else {const prediction=best(outputs.logits.data,4,i);label=prediction.label;score=prediction.score;}
    mask[i]=label;scores[i]=Math.round(255*score);counts[label]++;
  }
  return {mask,scores,counts,spaces};
}
