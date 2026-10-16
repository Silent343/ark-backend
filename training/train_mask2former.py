"""Fine-tune Mask2Former on independently reviewed panoptic plan masks.

Validation is dependency-free. A prepared review batch is not automatically training data.
"""
import argparse
import hashlib
import json
from pathlib import Path


def validate_manifest(file):
    manifest = json.loads(Path(file).read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != "ark-panoptic-training-1":
        raise ValueError("Unsupported training manifest")
    groups = {}
    records = []
    for record in manifest["records"]:
        if not record.get("reviewed") or record["split"] == "pending-review":
            continue
        split = record["split"]
        if split not in ("train", "validation", "test"):
            raise ValueError("Invalid split")
        group = record["buildingGroup"]
        if group in groups and groups[group] != split:
            raise ValueError("Building leakage between splits: " + group)
        groups[group] = split
        for key in ("image", "mask"):
            path = (Path(file).parent / record[key]).resolve()
            if not path.is_relative_to(Path(file).parent.resolve()) or not path.is_file():
                raise ValueError("Missing or out-of-package asset: " + key)
        records.append(record)
    if not any(r["split"] == "train" for r in records):
        raise ValueError("No reviewed training masks. Finish annotation review first.")
    if not any(r["split"] == "validation" for r in records):
        raise ValueError("Validation requires independently annotated plans from another building.")
    return manifest, records


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument("--base-model", default="facebook/mask2former-swin-tiny-coco-panoptic")
    parser.add_argument("--output", default=".data/training/ark-mask2former")
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--allow-cpu", action="store_true")
    args = parser.parse_args()
    manifest, records = validate_manifest(args.manifest)
    if args.validate_only:
        print(json.dumps({"ready": True, "reviewedSamples": len(records)}))
        return
    if args.epochs < 1:
        raise ValueError("Epochs must be positive")
    output = Path(args.output).resolve()
    if output.exists():
        raise ValueError("Choose a new output directory; existing checkpoints are preserved")
    import numpy as np
    import torch
    from PIL import Image
    from transformers import AutoImageProcessor, Mask2FormerForUniversalSegmentation

    if not torch.cuda.is_available() and not args.allow_cpu:
        raise ValueError("No CUDA GPU. Use a GPU training environment or explicitly pass --allow-cpu.")
    torch.manual_seed(42)
    np.random.seed(42)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    processor = AutoImageProcessor.from_pretrained(args.base_model, use_fast=False)
    classes = manifest["classes"]
    model = Mask2FormerForUniversalSegmentation.from_pretrained(
        args.base_model, id2label=dict(enumerate(classes)), label2id={c:i for i,c in enumerate(classes)},
        ignore_mismatched_sizes=True,
    ).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-5, weight_decay=.01)
    root = Path(args.manifest).parent

    def sample(record):
        image = Image.open(root / record["image"]).convert("RGB")
        rgb = np.array(Image.open(root / record["mask"]).convert("RGB"), dtype=np.int32)
        ids = rgb[:,:,0] + 256*rgb[:,:,1] + 65536*rgb[:,:,2]
        mapping = {0:0, **{s["id"]:s["category_id"] for s in record["segments_info"]}}
        if not set(np.unique(ids)).issubset(mapping):
            raise ValueError("Mask contains an unannotated segment ID")
        semantic = np.zeros(ids.shape, dtype=np.int64)
        for id_, category in mapping.items():
            semantic[ids == id_] = category
        encoded = processor(images=image, segmentation_maps=ids, instance_id_to_semantic_id=mapping,
                            return_tensors="pt")
        encoded = {k:[v_.to(device) for v_ in v] if isinstance(v,list) else v.to(device) for k,v in encoded.items()}
        return encoded, semantic

    history = []
    train = [r for r in records if r["split"] == "train"]
    validation = [r for r in records if r["split"] == "validation"]
    for epoch in range(args.epochs):
        model.train()
        losses = []
        for index in np.random.permutation(len(train)):
            encoded, _ = sample(train[index])
            optimizer.zero_grad(set_to_none=True)
            loss = model(**encoded).loss
            if not torch.isfinite(loss):
                raise ValueError("Non-finite training loss")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(),1.)
            optimizer.step()
            losses.append(float(loss.detach()))
        intersection = np.zeros(len(classes)); union = np.zeros(len(classes))
        model.eval()
        with torch.no_grad():
            for record in validation:
                encoded, truth = sample(record)
                outputs = model(pixel_values=encoded["pixel_values"],pixel_mask=encoded.get("pixel_mask"))
                predicted = processor.post_process_semantic_segmentation(outputs,target_sizes=[truth.shape])[0].cpu().numpy()
                for category in range(len(classes)):
                    intersection[category] += np.logical_and(predicted==category, truth==category).sum()
                    union[category] += np.logical_or(predicted==category, truth==category).sum()
        per_class = {c:float(intersection[i]/union[i]) if union[i] else None for i,c in enumerate(classes)}
        row = {"epoch":epoch+1,"loss":sum(losses)/len(losses),"validationIoU":per_class}
        history.append(row); print(json.dumps(row),flush=True)
    output.mkdir(parents=True)
    model.save_pretrained(output); processor.save_pretrained(output)
    (output/"training-run.json").write_text(json.dumps({"baseModel":args.base_model,
        "manifestSha256":hashlib.sha256(Path(args.manifest).read_bytes()).hexdigest(),
        "seed":42,"device":str(device),"history":history,"format":"PyTorch/HuggingFace; not yet a Node ONNX artifact"},indent=2),encoding="utf-8")


if __name__ == "__main__":
    main()
