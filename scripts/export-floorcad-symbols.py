"""Pinned local research export. Never uses unrestricted pickle loading."""
import hashlib
import importlib
import json
from pathlib import Path
import torch

ROOT = Path(__file__).resolve().parents[1] / '.data/models/floorcad-symbols-v1'
SOURCE_HASH = 'be1a5a404c5ad1c454ba7531e2c16548a6330945319cbf989751ff73578b494c'
REVISION = '02995225d7aed598bc7e0214f5b7f3fe7fe95657'
CLASSES = 'bath bath_tub bay_window bed bedside_cupboard blind_window chair class_31 class_32 class_34 class_35 double_door elevator escalator gas_stove half_height_cabinet high_cabinet opening_symbol parking railing refrigerator single_door sink sliding_door sofa squat_toilet stair table toilet tv_cabinet urinal wall wardrobe washing_machine window'.split()
ALLOWED = '''ultralytics.nn.tasks.DetectionModel torch.nn.modules.linear.Identity
ultralytics.nn.modules.conv.Conv torch.nn.modules.conv.Conv2d
ultralytics.nn.modules.block.C2f torch.nn.modules.activation.SiLU
torch.nn.modules.pooling.MaxPool2d torch.nn.modules.upsampling.Upsample
torch.nn.modules.batchnorm.BatchNorm2d ultralytics.nn.modules.block.Bottleneck
ultralytics.nn.modules.conv.Concat ultralytics.nn.modules.head.Detect
ultralytics.nn.modules.block.SPPF ultralytics.nn.modules.block.DFL
torch.nn.modules.container.Sequential torch.nn.modules.container.ModuleList'''.split()

def load_source_model():
    checkpoint = ROOT / 'source.pt'
    if hashlib.sha256(checkpoint.read_bytes()).hexdigest() != SOURCE_HASH:
        raise ValueError('Unexpected source checkpoint checksum')
    if not set(torch.serialization.get_unsafe_globals_in_checkpoint(checkpoint)) <= set(ALLOWED):
        raise ValueError('Unexpected checkpoint types')
    safe = [getattr(importlib.import_module(s.rsplit('.', 1)[0]), s.rsplit('.', 1)[1]) for s in ALLOWED]
    with torch.serialization.safe_globals(safe):
        data = torch.load(checkpoint, map_location='cpu', weights_only=True)
    model = (data.get('ema') or data['model']).float().eval()
    names = [model.names[i] for i in range(len(model.names))]
    if names != CLASSES:
        raise ValueError(f'Unexpected class order: {names}')
    return model

def main():
    model = load_source_model()
    for p in model.parameters():
        p.requires_grad_(False)
    head = model.model[-1]
    head.export, head.format, head.dynamic = True, 'onnx', False
    torch.set_num_threads(2)
    sample = torch.zeros(1, 3, 640, 640)
    with torch.no_grad():
        output = model(sample)
        print('Output shape:', output.shape, flush=True)
        torch.onnx.export(model, sample, ROOT / 'model.onnx', input_names=['images'],
                          output_names=['detections'], opset_version=17, dynamo=False)
    artifact_hash = hashlib.sha256((ROOT / 'model.onnx').read_bytes()).hexdigest()
    manifest = dict(id='floorcad-symbols-v1', revision=REVISION,
        checkpointSha256=SOURCE_HASH, artifactSha256=artifact_hash,
        classes=CLASSES, size=640, usage='experimental-research',
        source='https://huggingface.co/mudasir13cs/floorcad-yolov8n-detect',
        weightsLicense='AGPL-3.0', datasetLicense='CC-BY-NC-4.0',
        label='FloorCAD · símbolos (investigación)')
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print(json.dumps(manifest), flush=True)

if __name__ == '__main__':
    main()
