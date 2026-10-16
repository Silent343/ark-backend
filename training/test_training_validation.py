import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("trainer", Path(__file__).with_name("train_mask2former.py"))
trainer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trainer)


class ManifestTests(unittest.TestCase):
    def test_pending_masks_do_not_start_training(self):
        with tempfile.TemporaryDirectory() as folder:
            manifest = Path(folder)/"manifest.json"
            manifest.write_text(json.dumps({"schemaVersion":"ark-panoptic-training-1","records":[{"reviewed":False}]}))
            with self.assertRaisesRegex(ValueError,"No reviewed training"):
                trainer.validate_manifest(manifest)

    def test_same_building_cannot_leak_into_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/"image.png").touch();(root/"mask.png").touch()
            def record(group,split):
                return {"reviewed":True,"split":split,"buildingGroup":group,"image":"image.png","mask":"mask.png"}
            manifest=root/"manifest.json"
            value={"schemaVersion":"ark-panoptic-training-1","records":[record("one","train"),record("one","validation")]}
            manifest.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError,"leakage"):
                trainer.validate_manifest(manifest)
            value["records"][1]["buildingGroup"]="two"
            manifest.write_text(json.dumps(value))
            self.assertEqual(len(trainer.validate_manifest(manifest)[1]),2)


if __name__ == "__main__":
    unittest.main()
