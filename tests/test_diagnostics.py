import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from diagnostics import Diagnostics, preview_reason
from importer import PreviewImporter
from test_importer import write_cube


class DiagnosticsTests(unittest.TestCase):
    def test_rotated_logs_are_bounded_and_survive_a_new_instance(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Diagnostics(tmp, max_bytes=512)
            for count in range(100):
                log.event('file_started', partId='a'*16, counter=count)
            files = list(log.folder.glob('events.jsonl*'))
            self.assertLessEqual(len(files),3)
            self.assertLessEqual(sum(p.stat().st_size for p in files),1536)
            restored = Diagnostics(tmp, max_bytes=512)
            events = restored.events()
            self.assertTrue(events)
            self.assertEqual(events[-1]['counter'],99)
            self.assertIsNone(log.write_error)
            for p in files:
                for line in p.read_text().splitlines():
                    self.assertIsInstance(json.loads(line),dict)

    def test_browser_events_ignore_arbitrary_messages_urls_and_secret_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Diagnostics(tmp)
            self.assertTrue(log.frontend(dict(event='assembly_load_failed', errorType='TypeError', partIds=['a'*16],
                message='/home/private/source.stl', url='http://private-host/?token=SECRET', token='SECRET')))
            output=json.dumps(log.events())
            self.assertNotIn('SECRET',output);self.assertNotIn('/home',output);self.assertNotIn('private-host',output)
            self.assertIn('TypeError',output)
            with self.assertRaises(ValueError):log.frontend({'event':'arbitrary_event'})
            for _ in range(30):log.frontend({'event':'javascript_error'})
            self.assertEqual(len(log.events()),20)

    def test_log_write_failure_preserves_memory_events_and_reports_the_problem(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch('diagnostics.Path.mkdir',side_effect=PermissionError('private path')):
                log=Diagnostics(tmp)
            log.event('import_aborted',errorType='PermissionError')
            self.assertEqual(log.events()[-1]['event'],'import_aborted')
            self.assertEqual(log.environment(tmp)['logWriteError'],'PermissionError')
            self.assertNotIn('private path',json.dumps(log.events()))

    def test_old_dimensions_only_records_keep_distinct_reason_codes(self):
        self.assertEqual(preview_reason({'note':'Dimensions scanned. Preview exceeds the 128 MB source limit.'}),'source_size_limit')
        self.assertEqual(preview_reason({'note':'Dimensions scanned. Mesh remains too complex for a lightweight preview.'}),'mesh_too_complex')
        self.assertEqual(preview_reason({'error':'failed','missingModule':'scipy'}),'missing_dependency')

    def test_support_report_distinguishes_stale_missing_preview_and_unimported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);library=root/'private-originals';library.mkdir()
            items=[]
            for index in range(3):
                source=library/f'{index}.stl';write_cube(source)
                items.append(dict(id=str(index)*16,path=source.name,name=source.name,type='stl',category='Drawers'))
            manager=PreviewImporter(items,lambda item:library/item['path'],root/'cache');manager.connect(library)
            manager.records[items[0]['id']]={'fingerprint':manager.fingerprint(library/'0.stl'), 'previewAvailable':True}
            manager.records[items[1]['id']]={'fingerprint':{'bytes':0},'previewAvailable':True}
            report=manager.support_report()
            self.assertEqual(report['summary'],{'missing_preview_file':1,'source_changed':1,'not_imported':1})
            self.assertNotIn(str(root),json.dumps(report))

    def test_abnormal_worker_exit_keeps_last_stage_and_exit_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'a.stl';target=root/'a.glb';write_cube(source)
            target.with_suffix('.stage.json').write_text('{"stage":"simplify"}')
            manager=PreviewImporter([],lambda item:source,root/'cache')
            real_popen=subprocess.Popen
            def failed_worker(command,**kwargs):
                return real_popen([sys.executable,'-c','raise SystemExit(23)'],**kwargs)
            with patch('importer.subprocess.Popen',side_effect=failed_worker):
                record=manager.convert_one(source,target,128)
            self.assertEqual(record['reasonCode'],'worker_exit')
            self.assertEqual(record['stage'],'simplify')
            self.assertEqual(record['converterExitCode'],23)
            self.assertFalse(target.with_suffix('.stage.json').exists())


if __name__=='__main__':unittest.main()
