import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('object_training', Path(__file__).with_name('train_objects.py'))
training = importlib.util.module_from_spec(spec)
spec.loader.exec_module(training)

class ObjectTrainingValidation(unittest.TestCase):
    def test_reserved_buildings_cannot_enter_training(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'manifest.json'
            file.write_text(json.dumps({'schemaVersion':'ark-object-training-1','classes':training.CLASSES,
                'independentValidation':False,'annotator':'agent','heldOutBuildingGroups':['held-out'],
                'records':[{'split':'train','sourceIds':['source'],'buildingGroups':['held-out']}]}))
            with self.assertRaisesRegex(ValueError, 'Reserved building leaked'):
                training.validate_package(file,True)

    def test_unreviewed_package_requires_explicit_pilot(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'manifest.json'
            file.write_text(json.dumps({'schemaVersion':'ark-object-training-1','classes':training.CLASSES,
                                       'independentValidation':False,'records':[],'annotator':'agent'}))
            with self.assertRaisesRegex(ValueError, 'Explicit --pilot'):
                training.validate_package(file,False)
            with self.assertRaisesRegex(ValueError, 'Missing annotated'):
                training.validate_package(file,True)

    def test_declaring_independence_cannot_bypass_pilot_policy(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'manifest.json'
            file.write_text(json.dumps({'schemaVersion':'ark-object-training-1','classes':training.CLASSES,
                                       'independentValidation':True,'records':[],'annotator':'agent'}))
            with self.assertRaisesRegex(ValueError, 'Explicit --pilot'):
                training.validate_package(file,True)

if __name__ == '__main__':
    unittest.main()
