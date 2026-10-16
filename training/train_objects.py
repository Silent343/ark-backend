"""Pilot furniture fine-tuning. Agent annotations never become an independent benchmark."""
import argparse
import copy
import hashlib
import importlib.util
import importlib
import json
import os
from pathlib import Path
import sys

LEGACY_CLASSES = ['chair', 'table', 'sofa', 'bed', 'plant', 'stair']
CLASSES = LEGACY_CLASSES + ['vehicle']

def validate_package(manifest_file, pilot):
    file = Path(manifest_file).resolve()
    manifest = json.loads(file.read_text(encoding='utf-8'))
    if manifest.get('schemaVersion') != 'ark-object-training-1' or manifest.get('classes') not in [LEGACY_CLASSES, CLASSES]:
        raise ValueError('Unexpected object training contract')
    if manifest.get('independentValidation') is not False or not pilot:
        raise ValueError('These labels are provisional. Explicit --pilot is required; independent validation remains pending.')
    if not manifest.get('records') or not manifest.get('annotator'):
        raise ValueError('Missing annotated training records')
    classes=manifest['classes']
    counts = dict.fromkeys(classes, 0)
    held_out = set(manifest.get('heldOutBuildingGroups', []))
    for record in manifest['records']:
        if record.get('split') != 'train' or not record.get('sourceIds'):
            raise ValueError('Pilot package must explicitly retain source identity and training-only split')
        if not record.get('buildingGroups') or held_out.intersection(record['buildingGroups']):
            raise ValueError('Reserved building leaked into the training package')
        for key in ['image', 'labels']:
            asset = (file.parent / record[key]).resolve()
            if not asset.is_relative_to(file.parent) or not asset.is_file():
                raise ValueError('Missing or out-of-package training asset')
        if hashlib.sha256((file.parent / record['image']).read_bytes()).hexdigest() != record['imageSha256']:
            raise ValueError('Training image changed after labeling')
        lines = [line for line in (file.parent / record['labels']).read_text().splitlines() if line.strip()]
        if len(lines) != len(record.get('objects', [])) or (not lines and not record.get('negative')):
            raise ValueError('Object label count differs from the annotated manifest')
        for index, line in enumerate(lines):
            values = list(map(float, line.split()))
            if len(values) != 5 or not all(0 <= n <= 1 for n in values[1:]) or min(values[3:]) <= 0:
                raise ValueError('Invalid normalized object box')
            category = int(values[0])
            if category != values[0] or not 0 <= category < len(classes):
                raise ValueError('Unknown training class')
            target = record['objects'][index]
            b = target['box']
            expected = [(b[0]+b[2])/1280, (b[1]+b[3])/1280, (b[2]-b[0])/640, (b[3]-b[1])/640]
            if target['kind'] != classes[category] or any(abs(a-b)>1e-7 for a,b in zip(values[1:],expected)):
                raise ValueError('Object labels changed after annotation packaging')
            counts[classes[category]] += 1
    if not all(counts.values()):
        raise ValueError('Every declared class requires annotated positive examples')
    return file, manifest, counts

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--pilot', action='store_true')
    parser.add_argument('--validate-only', action='store_true')
    parser.add_argument('--epochs', type=int, default=12)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--initial-run')
    parser.add_argument('--freeze', type=int, default=10)
    parser.add_argument('--lr', type=float, default=.001)
    args = parser.parse_args()
    file, manifest, counts = validate_package(args.manifest, args.pilot)
    classes = manifest['classes']
    print(json.dumps({'stage': 'preflight', 'images': len(manifest['records']), 'objects': counts,
                      'independentValidation': False}), flush=True)
    if args.validate_only:
        return
    output = Path(args.output).resolve()
    if not output.is_relative_to(Path('.data/training').resolve()) or output.exists() or not 1 <= args.epochs <= 1000 or not 1 <= args.threads <= 8 or not 0 <= args.freeze <= 10 or not 0 < args.lr <= .1:
        raise ValueError('Choose a new run directory and bounded training settings')
    os.environ['OMP_NUM_THREADS'] = str(args.threads)
    os.environ['MKL_NUM_THREADS'] = str(args.threads)
    os.environ['ULTRALYTICS_AUTOINSTALL'] = 'false'
    import torch
    from ultralytics import YOLO, settings
    from ultralytics.models.yolo.detect import DetectionTrainer
    from ultralytics.nn.tasks import DetectionModel
    import ultralytics.data.utils as data_utils
    torch.set_num_threads(args.threads)
    torch.set_num_interop_threads(1)
    settings.update({'sync': False, 'wandb': False, 'mlflow': False, 'tensorboard': False})
    data_utils.check_font = lambda *a, **k: None  # No remote plotting asset needed for local training.
    spec = importlib.util.spec_from_file_location('floorcad_export', Path(__file__).resolve().parents[1] / 'scripts/export-floorcad-symbols.py')
    source_export = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(source_export)
    source_model = source_export.load_source_model()
    SOURCE_HASH = source_export.SOURCE_HASH
    previous_epochs = 0
    if args.initial_run:
        initial = Path(args.initial_run).resolve()
        if not initial.is_relative_to(Path('.data/training').resolve()):
            raise ValueError('Initial pilot must be a private local training run')
        previous = json.loads((initial / 'manifest.json').read_text())
        checkpoint = initial / 'weights/best.pt'
        if previous.get('id') not in ['ark-objects-pilot-v1','ark-objects-pilot-v2'] or previous.get('classes') not in [LEGACY_CLASSES, classes] or hashlib.sha256(checkpoint.read_bytes()).hexdigest() != previous['checkpointSha256']:
            raise ValueError('Pilot checkpoint provenance mismatch')
        allowed = source_export.ALLOWED
        if not set(torch.serialization.get_unsafe_globals_in_checkpoint(checkpoint)) <= set(allowed):
            raise ValueError('Unexpected pilot checkpoint types')
        safe = [getattr(importlib.import_module(s.rsplit('.', 1)[0]), s.rsplit('.', 1)[1]) for s in allowed]
        with torch.serialization.safe_globals(safe):
            loaded = torch.load(checkpoint, map_location='cpu', weights_only=True)
        source_model = (loaded.get('ema') or loaded['model']).float().eval()
        if [source_model.names[i] for i in range(len(source_model.names))] != previous['classes']:
            raise ValueError('Unexpected pilot checkpoint class order')
        SOURCE_HASH = previous['checkpointSha256']
        previous_epochs = previous['training']['epochs']

    class PilotTrainer(DetectionTrainer):
        def get_model(self, cfg=None, weights=None, verbose=True):
            model = DetectionModel(copy.deepcopy(source_model.yaml), nc=len(classes), verbose=False)
            model.load(source_model, verbose=False)
            original = source_model.model[-1]
            new = model.model[-1]
            source_ids = {name: index for index, name in source_model.names.items()}
            with torch.no_grad():
                for old_branch, new_branch in zip(original.cv3, new.cv3):
                    for index, name in enumerate(classes):
                        if name in source_ids:
                            new_branch[-1].weight[index].copy_(old_branch[-1].weight[source_ids[name]])
                            new_branch[-1].bias[index].copy_(old_branch[-1].bias[source_ids[name]])
            return model

    yolo = YOLO('yolov8n.yaml', task='detect')
    yolo.model = source_model
    yolo.overrides = {'model': 'yolov8n.yaml', 'task': 'detect'}
    yolo.train(trainer=PilotTrainer, data=str(file.parent / 'data.yaml'), epochs=args.epochs,
               imgsz=416, batch=4, device='cpu', workers=0, optimizer='AdamW', lr0=args.lr,
               weight_decay=.0005, freeze=args.freeze, seed=42, deterministic=True, amp=False,
               mosaic=0., mixup=0., copy_paste=0., degrees=0., scale=.15, translate=.1,
               fliplr=.5, flipud=.5, hsv_h=0., hsv_s=.2, hsv_v=.15, plots=False, val=False, save=True, save_period=5,
               project=str(output.parent), name=output.name, exist_ok=False, verbose=False)
    trained = yolo.model.cpu().float().eval()
    for p in trained.parameters():
        p.requires_grad_(False)
    head = trained.model[-1]
    head.export, head.format, head.dynamic, head.shape = True, 'onnx', False, None
    artifact = output / 'objects.onnx'
    with torch.no_grad():
        sample = torch.zeros(1, 3, 640, 640)
        shape = list(trained(sample).shape)
        if shape != [1, 4+len(classes), 8400]:
            raise ValueError(f'Unexpected trained output shape: {shape}')
        torch.onnx.export(trained, sample, artifact, input_names=['images'], output_names=['detections'],
                          opset_version=17, dynamo=False)
    best = output / 'weights/best.pt'
    dataset_hash = hashlib.sha256(file.read_bytes()).hexdigest()
    trained_manifest = dict(id='ark-objects-pilot-v2' if 'vehicle' in classes else 'ark-objects-pilot-v1', revision=dataset_hash[:40],
        checkpointSha256=hashlib.sha256(best.read_bytes()).hexdigest(),
        artifactSha256=hashlib.sha256(artifact.read_bytes()).hexdigest(), classes=classes,
        size=640, usage='experimental-research', weightsLicense='AGPL-3.0', datasetLicense='private-user-data-and-NC-pretraining',
        label='Ark · mobiliario entrenado (piloto)',
        training=dict(datasetSha256=dataset_hash, parentCheckpointSha256=SOURCE_HASH, epochs=args.epochs+previous_epochs,
                      images=len(manifest['records']), objectCounts=counts, annotationQuality='agent-provisional',
                      independentValidation=False, evaluationScope='training-fit-only; no independent accuracy claim'))
    trained_manifest['training']['buildingGroups'] = manifest['summary']['uniqueBuildingGroups']
    trained_manifest['training']['heldOutBuildingGroups'] = manifest.get('heldOutBuildingGroups', [])
    (output / 'manifest.json').write_text(json.dumps(trained_manifest, indent=2), encoding='utf-8')
    print(json.dumps({'stage': 'exported', 'onnx': str(artifact), 'independentValidation': False}), flush=True)

if __name__ == '__main__':
    main()
