"""Export a hash-pinned experimental checkpoint to a fixed-shape CPU ONNX artifact."""
import argparse
import hashlib
import json
from pathlib import Path
import torch
import numpy as np
import segmentation_models_pytorch as smp
from safetensors.torch import load_file

REVISION = "68843a3ab7b12aa03b23c36f955a0d8099b4e2ee"
CHECKPOINT_SHA = "d7f6a0fd06e2931aecfc8c4849192c5e153701578026efc78d9a6246731a8d6c"

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--directory", required=True, type=Path)
    p.add_argument("--candidate", choices=["yytsi", "openbim"], default="openbim")
    args = p.parse_args()
    is_open = args.candidate == "openbim"
    weights = args.directory / ("weights.pt" if is_open else "best.safetensors")
    expected = "cd7f41460ca1d3cc99bca9c61db8ac83d0381ddec385d55257e3ccb99967ffd7" if is_open else CHECKPOINT_SHA
    if hashlib.sha256(weights.read_bytes()).hexdigest() != expected:
        raise ValueError("Checkpoint SHA-256 mismatch")
    torch.set_num_threads(2)
    model = smp.Unet(encoder_name="resnet34", encoder_weights=None, in_channels=3, classes=4)
    if is_open:
        # The pinned official checkpoint includes a NumPy scalar metric; permit only these data types.
        with torch.serialization.safe_globals([(np._core.multiarray.scalar,"numpy.core.multiarray.scalar"), np.dtype, np.dtypes.Float64DType]):
            state = torch.load(weights, map_location="cpu", weights_only=True)
    else:
        state = load_file(str(weights))
    model.load_state_dict(state.get("model_state_dict", state), strict=True)
    model.eval()
    if is_open:
        class CanonicalClasses(torch.nn.Module):
            def __init__(self, net):
                super().__init__()
                self.net = net
            def forward(self, image):
                return self.net(image)[:, [0, 1, 3, 2], :, :]
        model = CanonicalClasses(model).eval()
    target = args.directory / "model.onnx"
    with torch.inference_mode():
        torch.onnx.export(model, torch.zeros(1, 3, 512, 512), str(target),
                          input_names=["image"], output_names=["logits"],
                          opset_version=18, dynamo=False, external_data=False)
    manifest = {"id":"openbim-m2-unet" if is_open else "yytsi-resnet34-unet", "revision":"v1.0.0" if is_open else REVISION, "checkpointSha256":expected,
                "artifactSha256":hashlib.sha256(target.read_bytes()).hexdigest(),
                "classes":["background","wall","door","window"], "size":512,
                "modelCard":"https://github.com/Chunling1/OpenBIM-FloorPlan-AI/releases/tag/v1.0.0" if is_open else "https://huggingface.co/Yytsi/floorplan-to-3d-walls",
                "usage":"experimental-research", "codeLicense":"MIT", "trainingDatasetLicense":"CC-BY-NC-4.0",
                "preprocessing":{"mean":[.485,.456,.406],"std":[.229,.224,.225],"letterbox":not is_open}}
    (args.directory / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"exported":str(target),"sha256":manifest["artifactSha256"]}))

if __name__ == "__main__":
    main()
