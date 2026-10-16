import importlib.util
import unittest
import json
import hashlib
import tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('architecture_training',Path(__file__).with_name('train_architecture_pilot.py'))
training=importlib.util.module_from_spec(spec);spec.loader.exec_module(training)
class ArchitectureValidation(unittest.TestCase):
    def test_provisional_policy_and_group_boundaries(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);asset=root/'asset.png';asset.write_bytes(b'fixture');digest=hashlib.sha256(asset.read_bytes()).hexdigest()
            row={'split':'train','buildingGroup':'house',**{k:'asset.png' for k in ['image','rooms','icons']},**{k+'Sha256':digest for k in ['image','rooms','icons']}}
            manifest={'schemaVersion':'ark-architecture-pilot-1','annotationQuality':'agent-provisional','independentValidation':False,'ignoreIndex':255,'trainingGroups':['house'],'diagnosticGroups':[],'records':[row]}
            file=root/'manifest.json'
            file.write_text(json.dumps(manifest));self.assertEqual(len(training.validate_package(file,True)['records']),1)
            with self.assertRaisesRegex(ValueError,'Explicit --pilot'):training.validate_package(file,False)
            manifest['records'].append({**row,'split':'diagnostic'});file.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,'building leakage'):training.validate_package(file,True)
    def test_declared_group_cannot_hide_training_overlap(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);file=root/'manifest.json';asset=root/'asset.png';asset.write_bytes(b'fixture');digest=hashlib.sha256(asset.read_bytes()).hexdigest()
            row={'split':'train','buildingGroup':'house',**{k:'asset.png' for k in ['image','rooms','icons']},**{k+'Sha256':digest for k in ['image','rooms','icons']}}
            file.write_text(json.dumps({'schemaVersion':'ark-architecture-pilot-1','annotationQuality':'agent-provisional','independentValidation':False,'ignoreIndex':255,'trainingGroups':[],'records':[row]}))
            with self.assertRaisesRegex(ValueError,'group manifest mismatch'):training.validate_package(file,True)
if __name__=='__main__':unittest.main()
