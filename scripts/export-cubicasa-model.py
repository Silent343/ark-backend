"""Export the official, hash-pinned research checkpoint; no training or remote inference."""
import argparse
import hashlib
import importlib.util
import json
import sys
import types
from pathlib import Path
import torch

CHECKPOINT = "dd20b4e1bf1d670f2125107b079df06958b1ccd36e49a464ab739aeb00b8e7a2"
SOURCE = "05a07265d9ec8cade5228b834645af00c655e1413b21d02b0b3183d041f7752a"
REVISION = "c34440266665a11f4484eb06cd2e4b7d72ad76c1"
CLASSES = ["background", "wall", "door", "window", "cabinet", "equipment", "toilet", "sink", "bench", "fireplace", "bathtub", "chimney", "railing"]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    for name, expected in [("weights.pkl", CHECKPOINT), ("hg_furukawa_original.py", SOURCE)]:
        if hashlib.sha256((args.directory / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"{name}: checksum mismatch")
    # The audited upstream class imports a pose-initialization module used only by init_weights.
    # We load the provided floor-plan weights directly and never call that initialization path.
    package = types.ModuleType("floortrans")
    models = types.ModuleType("floortrans.models")
    models.model_1427 = None
    sys.modules["floortrans"] = package
    sys.modules["floortrans.models"] = models
    spec = importlib.util.spec_from_file_location("ark_cubicasa_pinned", args.directory / "hg_furukawa_original.py")
    upstream = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(upstream)
    torch.set_num_threads(2)
    checkpoint = torch.load(args.directory / "weights.pkl", map_location="cpu", weights_only=True)
    model = upstream.hg_furukawa_original(44)
    model.load_state_dict(checkpoint["model_state"], strict=True)
    model.eval()

    class Heads(torch.nn.Module):
        def __init__(self, net):
            super().__init__()
            self.net = net
        def forward(self, image):
            prediction = self.net(image)
            return prediction[:, 21:33], prediction[:, 33:44]

    target = args.directory / "model.onnx"
    with torch.inference_mode():
        torch.onnx.export(Heads(model).eval(), torch.zeros(1, 3, 512, 512), str(target),
                          input_names=["image"], output_names=["rooms", "icons"],
                          opset_version=18, dynamo=False, external_data=False)
    manifest = {"id":"cubicasa-multitask-v1", "revision":REVISION, "checkpointSha256":CHECKPOINT,
                "artifactSha256":hashlib.sha256(target.read_bytes()).hexdigest(), "sourceSha256":SOURCE,
                "classes":CLASSES, "size":512, "outputLayout":"cubicasa-multitask-v1",
                "modelCard":"https://github.com/CubiCasa/CubiCasa5k", "usage":"experimental-research",
                "codeLicense":"CC-BY-NC-4.0", "trainingDatasetLicense":"CC-BY-NC-4.0",
                "preprocessing":{"mean":[.5,.5,.5],"std":[.5,.5,.5],"letterbox":True}}
    (args.directory / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"exported":str(target),"sha256":manifest["artifactSha256"],"classes":CLASSES}))

if __name__ == "__main__":
    main()
