import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import desktop
from importer import PreviewImporter, worker_command
from test_importer import write_cube


class DesktopTests(unittest.TestCase):
    def test_folder_is_remembered_and_missing_folder_prompts_again(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            library = root / 'USSA VAULT²'
            library.mkdir()
            settings = root / 'appdata' / 'desktop-settings.json'
            picker = Mock(return_value=str(library))
            self.assertEqual(desktop.resolve_library(None, settings, picker=picker), library)
            self.assertEqual(desktop.load_library(settings), str(library))
            picker.reset_mock()
            self.assertEqual(desktop.resolve_library(None, settings, picker=picker), library)
            picker.assert_not_called()
            library.rmdir()
            picker.return_value = None
            self.assertIsNone(desktop.resolve_library(None, settings, picker=picker))
            picker.assert_called_once_with(None)

    def test_invalid_explicit_path_does_not_overwrite_settings_and_cancel_keeps_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = Path(tmp) / 'settings.json'
            desktop.save_library(settings, Path(tmp))
            with self.assertRaisesRegex(ValueError, 'does not exist'):
                desktop.resolve_library(str(Path(tmp)/'missing'), settings)
            self.assertEqual(desktop.load_library(settings), tmp)
            self.assertIsNone(desktop.resolve_library(None, settings, choose=True, picker=lambda initial: None))
            self.assertEqual(desktop.load_library(settings), tmp)

    def test_frozen_child_dispatch_does_not_pass_python_cli_flags(self):
        with patch.object(sys, 'frozen', True, create=True), patch.object(sys, 'executable', 'VAULTWorkbench.exe'):
            command = worker_command(Path('Unicode².stl'), Path('preview.glb'), 128)
        self.assertEqual(command, ['VAULTWorkbench.exe','--convert-worker','--source','Unicode².stl',
                                   '--target','preview.glb','--max-mb','128'])
        with patch.object(sys, 'frozen', False, create=True):
            command = worker_command('a.stl','b.glb',256)
        self.assertEqual(command[:2], [sys.executable,'-u'])
        self.assertEqual(Path(command[2]).name, 'import_worker.py')

    def test_worker_dispatch_does_not_open_dialog_or_start_server(self):
        with patch('import_worker.main', return_value=7) as worker, \
             patch('desktop.resolve_library', side_effect=AssertionError('Must not read desktop settings')):
            self.assertEqual(desktop.main(['--convert-worker','--source','a.stl','--target','b.glb']),7)
        worker.assert_called_once_with(['--source','a.stl','--target','b.glb'])

    def test_local_server_receives_explicit_host_library_port_and_browser_flag(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(os.environ, {'VAULT_DATA':str(Path(tmp)/'data'), 'HOST':'0.0.0.0'}), \
                 patch('server.main') as serve, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(desktop.main(['--library',tmp,'--port','8788','--no-open']),0)
                serve.assert_called_once_with(['--host','127.0.0.1','--port','8788','--library',tmp])
                serve.reset_mock()
                desktop.main([])
                serve.assert_called_once_with(['--host','127.0.0.1','--port','8787','--library',tmp,'--open'])

    @unittest.skipIf(bool(PreviewImporter.dependencies()), 'Optional importer packages not installed')
    def test_real_entrypoint_converts_without_gui_and_reports_native_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, target = root/'Unicode².stl', root/'preview.glb'
            write_cube(source)
            entry = Path(desktop.__file__)
            converted = subprocess.run([sys.executable,str(entry),'--convert-worker','--source',str(source),
                                        '--target',str(target)],capture_output=True,text=True,check=True,timeout=20)
            self.assertEqual(json.loads(converted.stdout)['printSize'],[30,20,10])
            self.assertEqual(target.read_bytes()[:4],b'glTF')
            checked = subprocess.run([sys.executable,str(entry),'--check-runtime'],
                                     capture_output=True,text=True,check=True,timeout=20)
            self.assertTrue(json.loads(checked.stdout)['ok'])


if __name__=='__main__':
    unittest.main()
