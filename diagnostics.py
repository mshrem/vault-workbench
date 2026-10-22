"""Bounded local diagnostic events. No telemetry or original-file contents."""
from collections import deque
from datetime import datetime, timezone
import importlib.metadata
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import platform
import re
import shutil
import sys
import threading
import traceback
import uuid
from version import APP_VERSION

MAX_LOG_BYTES = 1024 * 1024
BACKUP_COUNT = 2
FRONTEND_EVENTS = {'webgl_unavailable', 'assembly_missing', 'assembly_load_failed',
                   'inspection_failed', 'import_action_failed', 'javascript_error', 'promise_rejection'}


def exception_details(error):
    result = {'errorType': type(error).__name__,
              'errorFrames': [{'file': Path(f.filename).name, 'line': f.lineno, 'function': f.name}
                              for f in traceback.extract_tb(error.__traceback__)[-12:]]}
    if isinstance(error, OSError):
        result['errno'] = error.errno
    return result


def preview_reason(record):
    if record.get('reasonCode'):
        return record['reasonCode']
    if record.get('error'):
        return 'missing_dependency' if record.get('missingModule') else 'conversion_failed'
    if record.get('previewAvailable'):
        return 'ready'
    note = record.get('note', '')
    return ('source_size_limit' if 'source limit' in note else
            'mesh_too_complex' if 'complex' in note else 'dimensions_only')


class QuietRotatingHandler(RotatingFileHandler):
    def handleError(self, record):
        # A failed diagnostic write must not break an import or expose a local path.
        self.last_error = type(sys.exc_info()[1]).__name__


class Diagnostics:
    def __init__(self, data_dir, max_bytes=MAX_LOG_BYTES):
        self.folder = Path(data_dir) / 'logs'
        self.lock = threading.RLock()
        self.memory = deque(maxlen=2000)
        self.handler = None
        self.write_error = None
        self.max_bytes = max_bytes
        self.frontend_times = deque()
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            self.handler = QuietRotatingHandler(self.folder / 'events.jsonl', maxBytes=max_bytes,
                                               backupCount=BACKUP_COUNT, encoding='utf-8', delay=True)
            self.handler.setFormatter(logging.Formatter('%(message)s'))
            self.handler.last_error = None
        except OSError as error:
            self.write_error = type(error).__name__

    def event(self, name, level='info', **details):
        # Callers supply structured fields, never raw exception messages, URLs,
        # environment variables, source geometry, or arbitrary browser text.
        entry = dict(eventId=uuid.uuid4().hex, time=datetime.now(timezone.utc).isoformat(),
                     event=name, level=level, **details)
        with self.lock:
            self.memory.append(entry)
            if self.handler:
                record = logging.LogRecord('vault', logging.INFO, '', 0,
                                           json.dumps(entry, ensure_ascii=True), (), None)
                self.handler.last_error = None
                try:
                    self.handler.handle(record)
                    self.write_error = self.handler.last_error
                finally:
                    # Release files between events, including on Windows where an
                    # open log otherwise prevents rotation/removal during shutdown.
                    self.handler.close()

    def frontend(self, payload):
        import time
        event = payload.get('event')
        if event not in FRONTEND_EVENTS:
            raise ValueError('Unknown diagnostic event')
        # Whitelist fields; browser URLs, messages and stack strings are discarded.
        fields = {}
        for name in ('family', 'errorType'):
            value = payload.get(name)
            if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,48}', value):
                fields[name] = value
        for name in ('height', 'depth', 'status'):
            value = payload.get(name)
            if type(value) is int and 0 <= value <= 999:
                fields[name] = value
        fields['partIds'] = [v for v in payload.get('partIds', [])[:30]
                             if isinstance(v, str) and re.fullmatch(r'[a-f0-9]{16}', v)] if isinstance(payload.get('partIds', []), list) else []
        with self.lock:
            now = time.monotonic()
            while self.frontend_times and self.frontend_times[0] < now - 60:
                self.frontend_times.popleft()
            if len(self.frontend_times) >= 20:
                return False
            self.frontend_times.append(now)
            self.event(event, 'warning', **fields)
        return True

    def events(self):
        with self.lock:
            records = {}
            for suffix in ('.2', '.1', ''):
                path = self.folder / ('events.jsonl' + suffix)
                try:
                    # Bound reads as well as writes; ignore malformed/incomplete lines.
                    with path.open('rb') as file:
                        data = file.read(self.max_bytes + 16384)
                    for line in data.splitlines():
                        try:
                            entry = json.loads(line)
                            if isinstance(entry, dict) and isinstance(entry.get('eventId'), str):
                                records[entry['eventId']] = entry
                        except (ValueError, UnicodeError):
                            pass
                except OSError:
                    pass
            for entry in self.memory:
                records[entry['eventId']] = entry
            return list(records.values())[-2000:]

    def environment(self, data_dir):
        packages = {}
        for name in ('numpy', 'trimesh', 'fast-simplification', 'scipy'):
            try:
                packages[name] = importlib.metadata.version(name)
            except importlib.metadata.PackageNotFoundError:
                packages[name] = None
        try:
            disk = shutil.disk_usage(data_dir)
            storage = {'freeBytes': disk.free, 'totalBytes': disk.total}
        except OSError as error:
            storage = {'errorType': type(error).__name__}
        return dict(appVersion=APP_VERSION, python=platform.python_version(), system=platform.system(),
                    architecture=platform.machine(), frozen=bool(getattr(sys, 'frozen', False)),
                    packages=packages, cacheDisk=storage, logWriteError=self.write_error,
                    maxLogBytes=self.max_bytes, logBackups=BACKUP_COUNT)
