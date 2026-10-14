import {mkdir, writeFile, readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import path from "node:path";

// Research-only, explicitly invoked. Never called by npm install, build or server startup.
const revision = "c34440266665a11f4484eb06cd2e4b7d72ad76c1";
const expectedCheckpoint = "dd20b4e1bf1d670f2125107b079df06958b1ccd36e49a464ab739aeb00b8e7a2";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, ".data/models/cubicasa-multitask-v1");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
await mkdir(directory, {recursive:true});
async function download(name, url, maximum, expected) {
  const target = path.join(directory, name);
  let bytes;
  try { bytes = await readFile(target); }
  catch(error) {
    if(error.code !== "ENOENT") throw error;
    const response = await fetch(url, {signal:AbortSignal.timeout(300_000)});
    if(!response.ok) throw new Error(`Download failed: ${response.status}`);
    if(Number(response.headers.get("content-length")) > maximum) throw new Error("Model download exceeds the declared budget.");
    bytes = Buffer.from(await response.arrayBuffer());
    if(bytes.length > maximum || bytes.length < 10 || expected && sha(bytes) !== expected) throw new Error("Downloaded artifact size/checksum mismatch.");
    await writeFile(target, bytes, {flag:"wx"});
  }
  if(expected && sha(bytes) !== expected) throw new Error(`Existing ${name} checksum mismatch; preserved for inspection.`);
  return {name, url, sha256:sha(bytes), bytes:bytes.length};
}
const checkpoint = await download("weights.pkl", "https://drive.usercontent.google.com/download?id=1gRB7ez1e4H7a9Y09lLqRuna0luZO5VRK&export=download&confirm=t", 230_000_000, expectedCheckpoint);
console.log(JSON.stringify({checkpointSha256:checkpoint.sha256,bytes:checkpoint.bytes}));
const source = await download("hg_furukawa_original.py", `https://raw.githubusercontent.com/CubiCasa/CubiCasa5k/${revision}/floortrans/models/hg_furukawa_original.py`, 100_000,"05a07265d9ec8cade5228b834645af00c655e1413b21d02b0b3183d041f7752a");
const license = await download("LICENSE", `https://raw.githubusercontent.com/CubiCasa/CubiCasa5k/${revision}/LICENSE`, 100_000,"abb20326fa72589cde781457dbe51f7d69f376d167254e95c36f338923669303");
const provenance = {revision,checkpoint,source,license,modelCard:"https://github.com/CubiCasa/CubiCasa5k",usage:"experimental-research"};
const record = path.join(directory,"download-provenance.json");
try { await writeFile(record,JSON.stringify(provenance,null,2),{flag:"wx"}); }
catch(error) { if(error.code!=="EEXIST")throw error; const current=JSON.parse(await readFile(record,"utf8")); if(current.checkpoint.sha256!==checkpoint.sha256||current.source.sha256!==source.sha256)throw new Error("Existing download provenance differs."); }
console.log("Official CubiCasa research weights/source downloaded. Export and evaluate before use.");
