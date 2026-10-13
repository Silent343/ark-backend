import {mkdir,writeFile,access} from "node:fs/promises";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import path from "node:path";
// Explicitly invoked research installer. No download occurs during npm install/start/build.
const root=fileURLToPath(new URL("../",import.meta.url));
const directory=path.join(root,".data/models/openbim-m2-v1"),target=path.join(directory,"weights.pt");
const expected="cd7f41460ca1d3cc99bca9c61db8ac83d0381ddec385d55257e3ccb99967ffd7";
try {await access(target);throw new Error("Checkpoint already exists. Verify it with the exporter; it will not be overwritten.");}
catch(error){if(error.code!=="ENOENT")throw error;}
const response=await fetch("https://github.com/Chunling1/OpenBIM-FloorPlan-AI/releases/download/v1.0.0/M2_DA_FT_v2_best.pt",{signal:AbortSignal.timeout(300000)});
if(!response.ok)throw new Error(`Checkpoint download failed: ${response.status}`);
const bytes=Buffer.from(await response.arrayBuffer());
if(bytes.length>150_000_000||createHash("sha256").update(bytes).digest("hex")!==expected)throw new Error("Checkpoint SHA-256 mismatch.");
await mkdir(directory,{recursive:true});await writeFile(target,bytes,{flag:"wx"});
console.log("Pinned experimental OpenBIM checkpoint downloaded and verified. Export it with scripts/export-floorplan-model.py before use.");
