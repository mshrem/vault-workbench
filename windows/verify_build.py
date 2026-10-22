"""Run on Windows after packaging: native extensions, child worker, HTTP and cache."""
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import Request, urlopen


def write_cube(path):
    vertices = [(0,0,0),(30,0,0),(30,20,0),(0,20,0),(0,0,10),(30,0,10),(30,20,10),(0,20,10)]
    faces = [(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),
             (1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
    with path.open('wb') as stream:
        stream.write(b'Windows bundle test'.ljust(80,b'\0') + struct.pack('<I',len(faces)))
        for face in faces:
            stream.write(struct.pack('<12fH',0,0,0,*(value for index in face for value in vertices[index]),0))


def get_json(url, payload=None):
    request = Request(url, data=json.dumps(payload).encode() if payload is not None else None,
                      headers={'Content-Type': 'application/json'})
    with urlopen(request, timeout=5) as response:
        return json.load(response)


def main():
    executable = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory(prefix='vault-windows-check-') as tmp:
        root = Path(tmp)
        library = root / 'USSA VAULT'
        source = library / 'VAULT' / '01. DRAWERS' / 'Windows Unicode².stl'
        source.parent.mkdir(parents=True)
        write_cube(source)
        checksum = hashlib.sha256(source.read_bytes()).hexdigest()
        env = dict(os.environ, VAULT_DATA=str(root / 'cache'), PYTHONUTF8='1')
        result = subprocess.run([str(executable), '--check-runtime'], env=env,
                                capture_output=True, text=True, encoding='utf-8', check=True, timeout=90)
        assert json.loads(result.stdout)['ok'], result.stdout
        result = subprocess.run([str(executable), '--convert-worker', '--source', str(source),
                                 '--target', str(root/'direct.glb')], env=env,
                                capture_output=True, text=True, encoding='utf-8', check=True, timeout=90)
        assert json.loads(result.stdout)['printSize'] == [30,20,10], result.stdout
        assert (root/'direct.glb').read_bytes()[:4] == b'glTF'
        with socket.socket() as probe:
            probe.bind(('127.0.0.1',0))
            port = probe.getsockname()[1]
        url = f'http://127.0.0.1:{port}'
        # File-backed diagnostics avoid pipe deadlocks and preserve failure logs.
        with (root/'server.log').open('w',encoding='utf-8') as log:
            process = subprocess.Popen([str(executable), '--library', str(library), '--no-open',
                                        '--port', str(port)], env=env, stdout=log, stderr=log)
            try:
                deadline = time.monotonic()+90
                while True:
                    if process.poll() is not None:
                        raise RuntimeError('Packaged server exited: '+(root/'server.log').read_text(encoding='utf-8'))
                    try:
                        status = get_json(url+'/api/status')
                        break
                    except (URLError, TimeoutError):
                        if time.monotonic()>deadline:
                            raise TimeoutError('Packaged server did not start')
                        time.sleep(.2)
                assert status['connected'] and status['matched']==1, status
                with urlopen(url+'/vendor/build/three.module.js',timeout=5) as response:
                    assert response.status==200 and response.read()
                get_json(url+'/api/importer/start', {'category':'Drawers','maxMB':128,'workers':2})
                deadline = time.monotonic()+90
                while True:
                    imported = get_json(url+'/api/importer')
                    if imported['state'] not in ('running','stopping'):
                        break
                    if time.monotonic()>deadline:
                        raise TimeoutError('Packaged child-worker import timed out')
                    time.sleep(.2)
                assert imported['state']=='complete' and imported['converted']==1, imported
                assert imported['failed']==0, get_json(url+'/api/importer/report')
                previews = get_json(url+'/api/previews')
                key = next(iter(previews))
                with urlopen(url+'/api/preview/'+key,timeout=5) as response:
                    assert response.read()[:4]==b'glTF'
                assert hashlib.sha256(source.read_bytes()).hexdigest()==checksum
                assert list((root/'cache').rglob('index.json'))
            finally:
                try:
                    get_json(url+'/api/importer/cancel', {})
                except (OSError, ValueError):
                    pass
                process.terminate()
                process.wait(timeout=10)
    print('PASS: packaged runtime, native simplification, Unicode STL, frozen child worker, HTTP assets, external cache and unchanged original.')


if __name__=='__main__':
    main()
