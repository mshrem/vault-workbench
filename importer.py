"""Resumable, local-only preview cache. Originals are always read-only."""
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
from diagnostics import Diagnostics, exception_details, preview_reason
from version import APP_VERSION, CONVERTER_REVISION

FORMAT_VERSION = 1
CATEGORIES = ('All', 'Drawers', 'Sustainers', 'Modifications', 'Pegboard')


def default_data_dir():
    if os.getenv('VAULT_DATA'):
        return Path(os.environ['VAULT_DATA']).expanduser()
    if os.name == 'nt':
        return Path(os.getenv('LOCALAPPDATA', str(Path.home() / 'AppData' / 'Local'))) / 'VAULTWorkbench'
    return Path.home() / '.local' / 'share' / 'VAULTWorkbench'


def worker_command(source, target, max_mb):
    """A frozen executable dispatches its own worker; it is not a Python CLI."""
    if getattr(sys, 'frozen', False):
        command = [sys.executable, '--convert-worker']
    else:
        command = [sys.executable, '-u', str(Path(__file__).with_name('import_worker.py'))]
    return command + ['--source', str(source), '--target', str(target), '--max-mb', str(max_mb)]


class PreviewImporter:
    def __init__(self, catalog, resolver, data_dir=None):
        self.catalog, self.resolver = catalog, resolver
        self.folder = Path(data_dir) if data_dir is not None else default_data_dir()
        self.diagnostics = Diagnostics(self.folder)
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.thread = None
        self.active = {}
        self.started_at = None
        self.finished_at = None
        self.records = {}
        self.root_key = ''
        self.job = dict(state='idle', total=0, processed=0, converted=0, reused=0,
                        dimensionsOnly=0, failed=0, current='', message='Ready to scan your connected originals.')

    @staticmethod
    def dependencies():
        names = ('numpy', 'trimesh', 'fast_simplification', 'scipy')
        return [n for n in names if importlib.util.find_spec(n) is None]

    @staticmethod
    def fingerprint(source):
        stat = source.stat()
        return dict(bytes=stat.st_size, mtimeNs=stat.st_mtime_ns, formatVersion=FORMAT_VERSION)

    def connect(self, root):
        # A different collection must never reuse another folder's cache.
        with self.lock:
            self.root_key = hashlib.sha256(str(Path(root).resolve()).encode()).hexdigest()[:16] if root else ''
            self.cache = self.folder / (self.root_key or 'disconnected')
            try:
                saved = json.loads((self.cache / 'index.json').read_text(encoding='utf-8'))
                self.records = saved.get('records', {}) if saved.get('formatVersion') == FORMAT_VERSION else {}
            except (OSError, ValueError):
                self.records = {}

    def save(self):
        temporary = self.cache / 'index.json.tmp'
        temporary.write_text(json.dumps(dict(formatVersion=FORMAT_VERSION, records=self.records)), encoding='utf-8')
        temporary.replace(self.cache / 'index.json')

    def valid_record(self, item, source):
        record = self.records.get(item['id'])
        return (record if record and record.get('fingerprint') == self.fingerprint(source)
                and (not record.get('previewAvailable') or (self.cache / (item['id'] + '.glb')).is_file()) else None)

    def available(self):
        with self.lock:
            result = {}
            for item in self.catalog:
                source = self.resolver(item)
                if not source:
                    continue
                try:
                    record = self.valid_record(item, source)
                except OSError:
                    continue
                if record:
                    result[item['id']] = {k: record[k] for k in ('printSize', 'previewAvailable', 'note') if k in record}
                    result[item['id']]['reasonCode'] = preview_reason(record)
                    if record.get('previewAvailable'):
                        try:
                            stat = (self.cache / (item['id'] + '.glb')).stat()
                            result[item['id']]['previewRevision'] = f'{stat.st_mtime_ns}-{stat.st_size}'
                        except OSError:
                            result[item['id']]['previewAvailable'] = False
                            result[item['id']]['reasonCode'] = 'missing_preview_file'
            return result

    def snapshot(self):
        with self.lock:
            elapsed = (self.finished_at or time.monotonic()) - self.started_at if self.started_at else 0
            completed = self.job['converted'] + self.job['dimensionsOnly'] + self.job['failed']
            remaining = max(0, self.job['total'] - self.job['processed'])
            eta = elapsed / completed * remaining if completed >= 3 and self.job['state'] == 'running' else None
            reasons = {}
            for record in self.records.values():
                reason = preview_reason(record)
                reasons[reason] = reasons.get(reason, 0)+1
            return dict(**self.job, missingDependencies=self.dependencies(),
                        reasonCounts=reasons,
                        indexed=len(self.records), previews=sum(bool(r.get('previewAvailable')) for r in self.records.values()),
                        activeFiles=list(self.active.values()), elapsedSeconds=round(elapsed),
                        etaSeconds=round(eta) if eta is not None else None)

    def start(self, category='Drawers', max_mb=128, workers=2):
        if category not in CATEGORIES or type(max_mb) is not int or max_mb not in (128, 256, 512):
            raise ValueError('Choose a listed category and a 128, 256 or 512 MB limit.')
        if type(workers) is not int or workers not in (1, 2, 4):
            raise ValueError('Choose 1, 2 or 4 conversion workers.')
        with self.lock:
            if self.thread and self.thread.is_alive():
                raise ValueError('An import is already running.')
            missing = self.dependencies()
            if missing:
                raise ValueError('Missing Python dependencies: ' + ', '.join(missing) +
                                 '. Rebuild the Docker image after updating the app, or on Windows run setup-importer-windows.cmd and restart.')
            selected = [i.copy() for i in self.catalog if i['type'] == 'stl'
                        and (category == 'All' or i['category'] == category) and self.resolver(i)]
            if not self.root_key or not selected:
                raise ValueError('No connected STL files in this category. Check the original folder.')
            self.cache.mkdir(parents=True, exist_ok=True)
            self.stop.clear()
            self.active.clear()
            self.started_at = time.monotonic()
            self.finished_at = None
            self.job = dict(state='running', total=len(selected), processed=0, converted=0, reused=0,
                            dimensionsOnly=0, failed=0, current='', category=category, maxMB=max_mb,
                            workers=workers, message='Starting local import…')
            self.diagnostics.event('import_started', category=category, maxMB=max_mb, workers=workers, files=len(selected))
            self.thread = threading.Thread(target=self.run, args=(selected, max_mb, workers), daemon=True)
            self.thread.start()
            return self.snapshot()

    def cancel(self):
        with self.lock:
            if self.job['state'] == 'running':
                self.stop.set()
                self.job.update(state='stopping', message='Stopping active conversions. Finished files are saved.')
                self.diagnostics.event('import_stop_requested')
            return self.snapshot()

    def run(self, selected, max_mb, workers):
        failed = False
        try:
            # Heavy work remains in separate processes; only coordinators share threads.
            # Each worker owns one source/target pair. Cache commits stay serialized.
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = [pool.submit(self.process_item, item, max_mb) for item in selected]
                try:
                    for future in as_completed(futures):
                        future.result()
                except Exception:
                    self.stop.set()
                    for future in futures:
                        future.cancel()
                    raise
        except Exception as error:
            failed = True
            self.diagnostics.event('import_aborted', 'error', **exception_details(error))
        finally:
            with self.lock:
                self.finished_at = time.monotonic()
                self.active.clear()
                if failed:
                    self.job.update(state='error', current='', message='Import stopped. Check free cache disk space and folder permissions, then resume.')
                else:
                    self.job.update(state='cancelled' if self.stop.is_set() else 'complete', current='',
                                    message='Paused. Start again to resume from the saved cache.' if self.stop.is_set()
                                    else 'Import finished. Open Parts library to inspect previews or download the report.')
                self.diagnostics.event('import_finished', state=self.job['state'], processed=self.job['processed'],
                                       converted=self.job['converted'], failed=self.job['failed'],
                                       dimensionsOnly=self.job['dimensionsOnly'], reused=self.job['reused'])

    def process_item(self, item, max_mb):
        if self.stop.is_set():
            return
        with self.lock:
            self.active[item['id']] = item['name']
            self.job['current'] = ' · '.join(self.active.values())
            self.job['message'] = f"Converting up to {self.job['workers']} STLs in parallel. Finished previews are saved automatically."
        try:
            source = self.resolver(item)
            if source is None:
                with self.lock:
                    self.records[item['id']] = dict(error='Source became unavailable before conversion.',
                        reasonCode='source_unavailable', previewAvailable=False, path=item['path'], name=item['name'], category=item['category'])
                    self.diagnostics.event('file_unavailable', 'warning', partId=item['id'])
                    self.job['processed'] += 1
                    self.job['failed'] += 1
                return
            try:
                fingerprint = self.fingerprint(source)
                with self.lock:
                    previous = self.valid_record(item, source)
            except OSError as error:
                with self.lock:
                    self.records[item['id']] = dict(error='Cannot read the original file.', reasonCode='source_unavailable',
                        previewAvailable=False, path=item['path'], name=item['name'], category=item['category'], **exception_details(error))
                    self.diagnostics.event('file_unavailable', 'warning', partId=item['id'], **exception_details(error))
                    self.job['processed'] += 1
                    self.job['failed'] += 1
                return
            # Do not invalidate old previews when enabling parallel processing.
            retry_cleanup = (previous and preview_reason(previous) == 'mesh_too_complex'
                             and previous.get('converterRevision', 1) < CONVERTER_REVISION)
            if previous and (previous.get('previewAvailable') or
                             previous.get('maxSourceMB', 0) >= max_mb and not previous.get('error') and not retry_cleanup):
                with self.lock:
                    self.job['reused'] += 1
                    self.job['processed'] += 1
                return
            target = self.cache / (item['id'] + '.glb')
            started = time.monotonic()
            self.diagnostics.event('file_started', partId=item['id'], sourceBytes=fingerprint['bytes'])
            record = self.convert_one(source, target, max_mb)
            if record is None:
                return
            try:
                if self.fingerprint(source) != fingerprint:
                    record = {'error': 'Source changed during import; run the importer again.', 'previewAvailable': False, 'reasonCode':'source_changed'}
            except OSError:
                record = {'error': 'Source became unavailable during import.', 'previewAvailable': False, 'reasonCode':'source_unavailable'}
            with self.lock:
                self.records[item['id']] = dict(record, fingerprint=fingerprint, maxSourceMB=max_mb,
                                               conversionSeconds=round(time.monotonic() - started, 2),
                                               path=item['path'], name=item['name'], category=item['category'])
                self.save()
                self.job['processed'] += 1
                counter = 'failed' if record.get('error') else 'converted' if record.get('previewAvailable') else 'dimensionsOnly'
                self.job[counter] += 1
                fields = {k: record[k] for k in ('reasonCode', 'stage', 'errorType', 'converterExitCode', 'sourceFaces', 'remainingFaces', 'previewFaces', 'converterRevision', 'degenerateFacesRemoved', 'duplicateFacesRemoved') if k in record}
                self.diagnostics.event('file_'+counter, 'warning' if counter!='converted' else 'info',
                    partId=item['id'], seconds=round(time.monotonic()-started,2), **fields)
        finally:
            with self.lock:
                self.active.pop(item['id'], None)
                self.job['current'] = ' · '.join(self.active.values())

    def convert_one(self, source, target, max_mb):
        command = worker_command(source, target, max_mb)
        creation = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        # Avoid multiple numerical thread pools competing inside each converter.
        env = dict(os.environ, OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1', MKL_NUM_THREADS='1', NUMEXPR_NUM_THREADS='1')
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   text=True, encoding='utf-8', creationflags=creation, env=env)
        deadline = time.monotonic() + 600
        try:
            while True:
                if self.stop.is_set():
                    process.kill()
                    process.communicate()
                    return None
                if time.monotonic() >= deadline:
                    process.kill()
                    process.communicate()
                    return dict(error='Conversion exceeded 10 minutes. Inspect this source in your slicer.', previewAvailable=False,
                                reasonCode='worker_timeout', stage=self.worker_stage(target), converterExitCode=process.returncode)
                try:
                    output, _ = process.communicate(timeout=.2)
                    break
                except subprocess.TimeoutExpired:
                    continue
            try:
                record = json.loads(output)
                if not isinstance(record, dict):
                    raise ValueError('Invalid worker result')
            except ValueError:
                record = dict(error='Converter stopped unexpectedly. Try the 128 MB limit or inspect in your slicer.', previewAvailable=False,
                              reasonCode='worker_exit', stage=self.worker_stage(target))
            if process.returncode and not record.get('error'):
                record = dict(error='Converter failed. Inspect this source in your slicer.', previewAvailable=False,
                              reasonCode='worker_exit', stage=self.worker_stage(target))
            if record.get('error'):
                record['converterExitCode'] = process.returncode
            return record
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()
            target.with_suffix('.glb.tmp').unlink(missing_ok=True)
            target.with_suffix('.stage.json').unlink(missing_ok=True)

    @staticmethod
    def worker_stage(target):
        try:
            stage = json.loads(target.with_suffix('.stage.json').read_text(encoding='utf-8')).get('stage')
            return stage if stage in {'starting','scan_bounds','load_stl','clean_preview','simplify','repair_normals','write_preview'} else 'unknown'
        except (OSError, ValueError, AttributeError):
            return 'unknown'

    def support_report(self):
        with self.lock:
            parts = []
            for item in self.catalog:
                if item['type'] != 'stl':
                    continue
                record = self.records.get(item['id'])
                source = self.resolver(item)
                if source is None:
                    state = 'source_unavailable'
                elif not record:
                    state = 'not_imported'
                else:
                    try:
                        valid = self.valid_record(item, source)
                        state = (preview_reason(record) if valid else
                                 'missing_preview_file' if record.get('previewAvailable') and record.get('fingerprint')==self.fingerprint(source)
                                 else 'source_changed')
                    except OSError:
                        state = 'source_unavailable'
                part = dict(id=item['id'], name=item['name'], path=item['path'], category=item['category'], status=state)
                if record:
                    for key in ('errorType','errorFrames','missingModule','reasonCode','stage','converterExitCode',
                                'maxSourceMB','sourceFaces','remainingFaces','previewFaces','conversionSeconds',
                                'converterRevision','cleanedFaces','degenerateFacesRemoved','duplicateFacesRemoved'):
                        if key in record:
                            part[key] = record[key]
                parts.append(part)
            counts = {}
            for part in parts:
                counts[part['status']] = counts.get(part['status'],0)+1
            return dict(application='VAULT Workbench', version=APP_VERSION,
                        generatedAt=datetime.now(timezone.utc).isoformat(), environment=self.diagnostics.environment(self.folder),
                        job={key:value for key,value in self.job.items() if key not in {'current','message'}}, summary=counts, parts=parts)

    def preview_path(self, key):
        if not re.fullmatch(r'[a-f0-9]{16}', key):
            return None
        with self.lock:
            item = next((i for i in self.catalog if i['id'] == key), None)
            source = self.resolver(item) if item else None
            record = self.valid_record(item, source) if source else None
            return self.cache / (key + '.glb') if record and record.get('previewAvailable') else None

    def report(self):
        with self.lock:
            # No home directory, absolute paths, source geometry or preview bytes.
            return dict(application='VAULT Workbench', version=APP_VERSION,
                        generatedAt=datetime.now(timezone.utc).isoformat(), units='mm',
                        orientation='Original STL axes; not assembled orientation.',
                        records=[dict(id=key, **{k: v for k, v in record.items() if k != 'fingerprint'})
                                 for key, record in self.records.items()])
