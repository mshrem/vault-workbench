import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from importer import PreviewImporter
from import_worker import convert, conversion_error


class ImportDiagnosticsTests(unittest.TestCase):
    def test_dependency_check_includes_scipy(self):
        with patch('importer.importlib.util.find_spec', side_effect=lambda name: None if name == 'scipy' else object()):
            self.assertEqual(PreviewImporter.dependencies(), ['scipy'])

    def test_missing_module_diagnostics_preserve_name_without_local_paths(self):
        try:
            raise ModuleNotFoundError("No module named 'scipy'", name='scipy')
        except ModuleNotFoundError as error:
            record = conversion_error(error)
        self.assertEqual(record['missingModule'], 'scipy')
        self.assertEqual(record['errorType'], 'ModuleNotFoundError')
        self.assertIn('rebuild', record['error'])
        self.assertEqual(record['errorFrames'][-1]['file'], 'test_importer.py')
        self.assertNotIn(str(Path(__file__).resolve().parent), json.dumps(record))

    def test_other_exception_diagnostics_do_not_expose_message_paths(self):
        try:
            raise OSError('/private/source/location.stl')
        except OSError as error:
            record = conversion_error(error)
        self.assertEqual(record['errorType'], 'OSError')
        self.assertNotIn('/private', json.dumps(record))


def write_cube(path, x=30):
    vertices = [(0, 0, 0), (x, 0, 0), (x, 20, 0), (0, 20, 0),
                (0, 0, 10), (x, 0, 10), (x, 20, 10), (0, 20, 10)]
    triangles = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4),
                 (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    with path.open('wb') as stream:
        stream.write(b'vault test'.ljust(80, b'\0') + struct.pack('<I', len(triangles)))
        for face in triangles:
            values = [v for i in face for v in vertices[i]]
            stream.write(struct.pack('<12fH', 0, 0, 0, *values, 0))


@unittest.skipIf(bool(PreviewImporter.dependencies()), 'Optional importer packages not installed')
class ImporterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source = self.root / 'originals' / 'Unicode².stl'
        self.source.parent.mkdir()
        write_cube(self.source)
        self.item = dict(id='a' * 16, name=self.source.name, path=self.source.name, type='stl', category='Drawers')
        self.manager = PreviewImporter([self.item], lambda item: self.source, self.root / 'cache')
        self.manager.connect(self.source.parent)

    def tearDown(self):
        self.manager.cancel()
        if self.manager.thread:
            self.manager.thread.join(5)
        self.tmp.cleanup()

    def finish(self):
        self.manager.thread.join(20)
        self.assertFalse(self.manager.thread.is_alive())
        return self.manager.snapshot()

    def test_real_conversion_resume_restart_and_source_invalidation(self):
        original = hashlib.sha256(self.source.read_bytes()).hexdigest()
        self.manager.start()
        result = self.finish()
        self.assertEqual((result['state'], result['converted']), ('complete', 1))
        record = self.manager.records[self.item['id']]
        self.assertEqual(record['printSize'], [30, 20, 10])
        preview = self.manager.preview_path(self.item['id'])
        self.assertEqual(preview.read_bytes()[:4], b'glTF')
        revision = self.manager.available()[self.item['id']]['previewRevision']
        stat = preview.stat()
        os.utime(preview, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1000000))
        self.assertNotEqual(revision, self.manager.available()[self.item['id']]['previewRevision'])
        import numpy as np
        import trimesh
        mesh = trimesh.load(preview, force='mesh')
        self.assertTrue(np.isfinite(mesh.vertex_normals).all())
        self.assertTrue(np.allclose(np.linalg.norm(mesh.vertex_normals, axis=1), 1))
        self.assertEqual(hashlib.sha256(self.source.read_bytes()).hexdigest(), original)
        with patch.object(self.manager, 'convert_one', side_effect=AssertionError('Must use cache')):
            self.manager.start(); result = self.finish()
        self.assertEqual(result['reused'], 1)
        restored = PreviewImporter([self.item], lambda item: self.source, self.root / 'cache')
        restored.connect(self.source.parent)
        self.assertTrue(restored.available()[self.item['id']]['previewAvailable'])
        # Same byte count with a changed vertex must invalidate the cached dimensions too.
        write_cube(self.source, x=31)
        self.assertIsNone(self.manager.preview_path(self.item['id']))
        self.assertEqual(self.manager.available(), {})
        self.manager.start(); self.finish()
        self.assertEqual(self.manager.records[self.item['id']]['printSize'], [31, 20, 10])
        report = json.dumps(self.manager.report())
        self.assertNotIn(str(self.root), report)
        self.assertNotIn('mtimeNs', report)
        self.assertIn('Unicode', report)
        self.assertIsNone(self.manager.preview_path('../index'))

    def test_large_binary_bounds_are_scanned_without_loading_full_mesh(self):
        with patch('trimesh.load_mesh', side_effect=AssertionError('Must not load oversized STL')):
            record = convert(self.source, self.root / 'preview.glb', max_mb=0)
        self.assertEqual(record['printSize'], [30, 20, 10])
        self.assertFalse(record['previewAvailable'])
        self.assertFalse((self.root / 'preview.glb').exists())

    def test_preview_cleanup_discards_numerical_slivers_and_duplicates_without_changing_source_bounds(self):
        data = self.source.read_bytes()
        sliver = struct.pack('<12fH', 0,0,1, 1,1,1, 2,2,1, 3,3.0000005,1, 0)
        self.source.write_bytes(data[:80]+struct.pack('<I',14)+data[84:]+data[84:134]+sliver)
        original = self.source.read_bytes()
        record = convert(self.source,self.root/'clean.glb')
        self.assertEqual(record['sourceFaces'],14)
        self.assertEqual(record['cleanedFaces'],12)
        self.assertEqual(record['degenerateFacesRemoved'],1)
        self.assertEqual(record['duplicateFacesRemoved'],1)
        self.assertTrue(record['previewAvailable'])
        self.assertEqual(record['printSize'],[30,20,10])
        self.assertEqual(self.source.read_bytes(),original)

    def test_new_cleanup_retries_old_complex_records_and_reuses_successful_previews(self):
        from version import CONVERTER_REVISION
        self.manager.start();self.finish()
        record = self.manager.records[self.item['id']]
        record['converterRevision'] = CONVERTER_REVISION-1
        with patch.object(self.manager,'convert_one',side_effect=AssertionError('Keep successful previews')):
            self.manager.start();self.assertEqual(self.finish()['reused'],1)
        record.update(previewAvailable=False, reasonCode='mesh_too_complex', maxSourceMB=128)
        self.manager.start();self.assertEqual(self.finish()['converted'],1)
        self.assertEqual(self.manager.records[self.item['id']]['converterRevision'],CONVERTER_REVISION)
        self.manager.records[self.item['id']].update(previewAvailable=False,reasonCode='mesh_too_complex')
        with patch.object(self.manager,'convert_one',side_effect=AssertionError('Do not repeat a current cleanup')):
            self.manager.start();self.assertEqual(self.finish()['reused'],1)

    def test_zero_normals_repair_uses_scipy_incident_face_lookup(self):
        import numpy as np
        import trimesh
        class MissingNormalsOnce(trimesh.Trimesh):
            @property
            def vertex_normals(self):
                if not getattr(self, 'normals_requested', False):
                    self.normals_requested = True
                    return np.zeros((len(self.vertices), 3))
                return trimesh.Trimesh.vertex_normals.fget(self)

            @vertex_normals.setter
            def vertex_normals(self, value):
                trimesh.Trimesh.vertex_normals.fset(self, value)

        loaded = trimesh.load_mesh(self.source)
        mesh = MissingNormalsOnce(vertices=loaded.vertices, faces=loaded.faces)
        target = self.root / 'repaired.glb'
        with patch('trimesh.load_mesh', return_value=mesh):
            result = convert(self.source, target)
        self.assertTrue(result['previewAvailable'])
        preview = trimesh.load(target, force='mesh')
        self.assertTrue(np.allclose(np.linalg.norm(preview.vertex_normals, axis=1), 1))

    def test_stop_terminates_child_and_resume_retries_unfinished_file(self):
        started = threading.Event()
        real_popen = subprocess.Popen
        children = []
        def sleeping_child(command, **kwargs):
            child = real_popen([sys.executable, '-c', 'import time; time.sleep(60)'], **kwargs)
            children.append(child); started.set()
            return child
        with patch('importer.subprocess.Popen', side_effect=sleeping_child):
            self.manager.start()
            self.assertTrue(started.wait(5))
            with self.assertRaises(ValueError):
                self.manager.start()
            self.manager.cancel()
            result = self.finish()
        self.assertEqual(result['state'], 'cancelled')
        self.assertIsNotNone(children[0].poll())
        self.assertEqual(result['processed'], 0)
        self.manager.start(); self.assertEqual(self.finish()['converted'], 1)

    def test_invalid_stl_does_not_block_remaining_files_and_failure_can_retry(self):
        self.source.write_bytes(b'not a mesh')
        self.manager.start(); result = self.finish()
        self.assertEqual(result['state'], 'complete')
        self.assertEqual(result['failed'], 1)
        record = self.manager.report()['records'][0]
        self.assertIn('error', record)
        self.assertTrue(record['errorType'])
        self.assertTrue(record['errorFrames'])
        self.assertEqual(record['converterExitCode'], 1)
        self.assertNotIn(str(self.root), json.dumps(record))
        self.assertIsNone(self.manager.preview_path(self.item['id']))
        write_cube(self.source)
        self.manager.start(); self.assertEqual(self.finish()['converted'], 1)

    def test_scope_limits_and_dependency_checks(self):
        for category, limit in [('Wrong', 128), ('Drawers', 4), ('Drawers', True)]:
            with self.assertRaises(ValueError):
                self.manager.start(category, limit)
        for workers in (0, 3, True, '2'):
            with self.assertRaises(ValueError):
                self.manager.start(workers=workers)
        with self.assertRaises(ValueError):
            self.manager.start('Sustainers')
        with patch.object(self.manager, 'dependencies', return_value=['trimesh']):
            with self.assertRaisesRegex(ValueError, 'setup-importer'):
                self.manager.start()

    def add_second_source(self):
        source=self.source.parent/'second.stl';write_cube(source,x=40)
        item=dict(self.item,id='b'*16,path=source.name,name=source.name)
        self.manager.catalog.append(item)
        self.manager.resolver=lambda item:self.source.parent/item['path']
        return item

    def test_parallel_workers_overlap_and_commit_both_cache_records_without_losing_data(self):
        second=self.add_second_source()
        barrier=threading.Barrier(2);lock=threading.Lock();active=0;peak=0
        real_convert=self.manager.convert_one
        def overlapping(source,target,max_mb):
            nonlocal active,peak
            with lock:
                active+=1;peak=max(peak,active)
            try:
                barrier.wait(timeout=5)
                return real_convert(source,target,max_mb)
            finally:
                with lock:active-=1
        with patch.object(self.manager,'convert_one',side_effect=overlapping):
            self.manager.start(workers=2);result=self.finish()
        self.assertEqual(peak,2);self.assertEqual(result['converted'],2)
        saved=json.loads((self.manager.cache/'index.json').read_text())['records']
        self.assertEqual(set(saved),{self.item['id'],second['id']})
        self.assertEqual(saved[second['id']]['printSize'],[40,20,10])
        for item in (self.item,second):self.assertIsNotNone(self.manager.preview_path(item['id']))
        # Scheduling changes do not invalidate already generated preview geometry.
        with patch.object(self.manager,'convert_one',side_effect=AssertionError('Must reuse cache')):
            self.manager.start(workers=1);self.assertEqual(self.finish()['reused'],2)

    def test_stop_kills_every_active_child_in_parallel_import(self):
        self.add_second_source();started=threading.Event();lock=threading.Lock()
        real_popen=subprocess.Popen;children=[]
        def sleeping_children(command,**kwargs):
            child=real_popen([sys.executable,'-c','import time; time.sleep(60)'],**kwargs)
            with lock:
                children.append(child)
                if len(children)==2:started.set()
            return child
        with patch('importer.subprocess.Popen',side_effect=sleeping_children):
            self.manager.start(workers=2)
            self.assertTrue(started.wait(5))
            self.assertEqual(len(self.manager.snapshot()['activeFiles']),2)
            self.manager.cancel();result=self.finish()
        self.assertEqual(result['state'],'cancelled');self.assertEqual(result['processed'],0)
        self.assertTrue(all(child.poll() is not None for child in children))
        self.assertEqual(result['activeFiles'],[])


if __name__ == '__main__':
    unittest.main()
