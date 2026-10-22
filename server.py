"""VAULT Workbench: standard-library-only, read-only original-file access."""
import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote
import webbrowser
import zipfile
from importer import PreviewImporter
from version import APP_VERSION

BASE = Path(__file__).resolve().parent
WEB = BASE / 'web'
CATALOG = json.loads((WEB / 'data/catalog.json').read_text(encoding='utf-8'))
LIBRARY = None
IMPORTER = None
IMPORTER_LOCK = threading.Lock()

def get_importer():
    global IMPORTER
    with IMPORTER_LOCK:
        if IMPORTER is None:
            IMPORTER = PreviewImporter(CATALOG, resolve_original)
            IMPORTER.connect(LIBRARY)
        return IMPORTER

def resolve_original(item, root=None):
    root = root or LIBRARY
    if root is None:
        return None
    root = Path(root).resolve()
    path = (root / item['path']).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        return None
    return path

def inventory_status(root=None):
    return {item['id']: bool(resolve_original(item, root)) for item in CATALOG}

def category_for(rel):
    return ('Pegboard' if rel.startswith('PEGBOARD/') else
            'Drawers' if '/01. DRAWERS/' in rel else
            'Sustainers' if '/02. SUSTAINERS/' in rel else
            'Modifications' if '/03. MODIFICATIONS/' in rel else 'Guides')

def scan_catalog(root, baseline):
    """Keep stable known IDs, but take names, byte counts and membership from disk."""
    root = Path(root).resolve()
    known = {i['path']: i.copy() for i in baseline}
    live = set()
    for file in root.rglob('*'):
        if file.suffix.lower() not in {'.stl','.pdf','.png','.jpg'} or not file.is_file():
            continue
        if not file.resolve().is_relative_to(root):
            continue
        rel = file.relative_to(root).as_posix()
        lossy = rel.encode('ascii', errors='replace').decode('ascii')
        if rel not in known and lossy in known:
            entry = known.pop(lossy)
            known[rel] = entry
        elif rel not in known:
            known[rel] = {'id':hashlib.sha256(rel.encode()).hexdigest()[:16]}
        known[rel].update(path=rel, name=file.name, bytes=file.stat().st_size,
                          category=category_for(rel), type=file.suffix[1:].lower())
        live.add(rel)
    return [item for rel, item in known.items() if rel in live]

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.js':'text/javascript', '.mjs':'text/javascript',
                      '.glb':'model/gltf-binary', '.stl':'model/stl'}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def log_message(self, format, *args):
        # Frequent status polling must not grow Docker's console logs. Relevant
        # import/viewer events are recorded in the bounded appdata logger.
        pass

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        # Keep an extracted update from reusing old model/material code.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def json_response(self, data, status=200):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(payload)))
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(payload)

    def send_file(self, path, filename=None):
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream' if filename else self.guess_type(str(path)))
        self.send_header('Content-Length',str(path.stat().st_size))
        if filename:
            from urllib.parse import quote
            self.send_header('Content-Disposition',"attachment; filename*=UTF-8''"+quote(filename))
        self.end_headers()
        with path.open('rb') as stream:
            while data := stream.read(1024*1024):
                self.wfile.write(data)

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == '/api/status':
            status = inventory_status()
            return self.json_response({'connected':bool(LIBRARY), 'available':status,
                'matched':sum(status.values()), 'total':len(CATALOG),
                'version':APP_VERSION, 'writeAccess':False})
        if path == '/api/catalog':
            return self.json_response(CATALOG)
        if path == '/api/importer':
            return self.json_response(get_importer().snapshot())
        if path == '/api/previews':
            return self.json_response(get_importer().available())
        if path == '/api/importer/report':
            return self.json_response(get_importer().report())
        if path == '/api/support':
            importer = get_importer()
            out = io.BytesIO()
            with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('report.json', json.dumps(importer.support_report(), indent=2))
                archive.writestr('events.jsonl', '\n'.join(json.dumps(event) for event in importer.diagnostics.events())+'\n')
                archive.writestr('README.txt', 'Local diagnostics only. Nothing was uploaded automatically.\nIncludes relative part filenames, import status, dependency versions, cache disk capacity and recent structured events.\nDoes not include STL/GLB geometry, browser URL, environment variables, hostname or absolute library/cache paths. Review before sharing.\nA worker exit code can indicate termination but does not prove an out-of-memory kill.\n')
            payload = out.getvalue()
            self.send_response(200)
            self.send_header('Content-Type','application/zip')
            self.send_header('Content-Disposition','attachment; filename="VAULT-support-bundle.zip"')
            self.send_header('Content-Length',str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if path.startswith('/api/preview/'):
            preview = get_importer().preview_path(path.removeprefix('/api/preview/'))
            if preview is None:
                return self.json_response({'error':'Preview unavailable. Run the local importer first.'},404)
            return self.send_file(preview)
        if path.startswith('/api/original/'):
            key = path.removeprefix('/api/original/')
            item = next((i for i in CATALOG if i['id']==key), None)
            source = resolve_original(item) if item else None
            if source is None:
                return self.json_response({'error':'Original not available. Connect your USSA VAULT folder.'},404)
            return self.send_file(source, item['name'])
        if path.startswith('/api/'):
            return self.json_response({'error':'Unknown endpoint'},404)
        # No directory listings or paths outside the packaged web root.
        target = (WEB / path.lstrip('/')).resolve()
        if not target.is_relative_to(WEB.resolve()) or target.is_dir() and path!='/':
            return self.send_error(404)
        return super().do_GET()

    def do_POST(self):
        endpoint = urlsplit(self.path).path
        if endpoint not in {'/api/package', '/api/importer/start', '/api/importer/cancel', '/api/diagnostics/event'}:
            return self.json_response({'error':'Unknown endpoint'},404)
        # Reject requests initiated from other web sites.
        origin = self.headers.get('Origin')
        if origin and urlsplit(origin).netloc != self.headers.get('Host'):
            return self.json_response({'error':'Cross-origin request rejected'},403)
        try:
            length = int(self.headers.get('Content-Length','0'))
            if not 0 < length <= 200000:
                raise ValueError('Invalid request size')
            manifest = json.loads(self.rfile.read(length))
            if not isinstance(manifest, dict):
                raise ValueError('Expected a JSON object')
            if endpoint == '/api/diagnostics/event':
                return self.json_response({'recorded':get_importer().diagnostics.frontend(manifest)})
            if endpoint == '/api/importer/start':
                try:
                    return self.json_response(get_importer().start(manifest.get('category','Drawers'), manifest.get('maxMB',128), manifest.get('workers',2)),202)
                except (ValueError, OSError) as error:
                    return self.json_response({'error':str(error)},409)
            if endpoint == '/api/importer/cancel':
                return self.json_response(get_importer().cancel())
            files = manifest['files']
            if not isinstance(files,list) or not 1 <= len(files) <= 50:
                raise ValueError('Select between 1 and 50 unique files')
            by_id = {i['id']:i for i in CATALOG}
            selected=[]; seen=set()
            for record in files:
                key = record['id']; qty = record['quantity']
                if key in seen or key not in by_id or type(qty) is not int or not 1 <= qty <= 100:
                    raise ValueError('Invalid part selection')
                seen.add(key); selected.append((by_id[key],qty))
            missing=[i['name'] for i,q in selected if not resolve_original(i)]
            if missing:
                return self.json_response({'error':'Connect the original USSA VAULT folder to export STLs.', 'missing':missing},409)
            if sum(resolve_original(i).stat().st_size for i,q in selected)>600*1024*1024:
                raise ValueError('This package exceeds the 600 MB limit. Export fewer unique files.')
            with tempfile.TemporaryDirectory() as tmp:
                output=Path(tmp)/'VAULT-print-package.zip'
                with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=1) as z:
                    z.writestr('build.json',json.dumps(manifest,indent=2))
                    out=io.StringIO(); writer=csv.writer(out)
                    writer.writerow(['File','Copies of this file','Filament','Color HEX','Grams per complete STL','Total grams','Notes'])
                    specifications={r['id']:r for r in files}
                    for item,qty in selected:
                        source=resolve_original(item)
                        z.write(source, 'originals/'+item['path'])
                        record=specifications[item['id']]
                        grams=record.get('gramsPerFile')
                        if type(grams) not in (int,float) or not 0 <= grams <= 100000:
                            grams=None
                        writer.writerow([item['path'],qty,str(record.get('filament',''))[:120],str(record.get('color',''))[:30],
                                         grams if grams is not None else '',grams*qty if grams is not None else '',
                                         'Some STLs contain paired parts; see assembly guide.'])
                    z.writestr('parts.csv',out.getvalue())
                    z.writestr('filament-plan.json',json.dumps(manifest.get('filament',{'complete':False,'basis':'No slicer usage supplied.'}),indent=2))
                    z.writestr('README.txt','Original STL bytes are unchanged. Preview GLBs are not included for printing.\nQuantity means copies of the complete file, including any paired parts.\nColors, filament names and sliced usage are in build.json, parts.csv and filament-plan.json. STL format does not store filament colors. Assign them in your slicer.\nFilament figures use the supplied per-file slicer weights and design quantities; the app does not slice the STLs. Any planning allowance is separate from simulated purge waste.\nConsult the assembly guides before printing.\n')
                return self.send_file(output,output.name)
        except (KeyError,ValueError,TypeError,json.JSONDecodeError) as error:
            return self.json_response({'error':str(error)},400)

def main(argv=None):
    global LIBRARY, CATALOG
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host',default=os.getenv('HOST','127.0.0.1'))
    parser.add_argument('--port',type=int,default=int(os.getenv('PORT','8787')))
    parser.add_argument('--library',default=os.getenv('VAULT_ROOT'))
    parser.add_argument('--open',action='store_true')
    args=parser.parse_args(argv)
    candidate=Path(args.library).expanduser() if args.library else Path.home()/'Desktop'/'USSA VAULT'
    if candidate.is_dir():
        LIBRARY=candidate.resolve()
        CATALOG=scan_catalog(LIBRARY, CATALOG)
    server=ThreadingHTTPServer((args.host,args.port),Handler)
    get_importer().diagnostics.event('app_started', version=APP_VERSION, connected=bool(LIBRARY), catalogFiles=len(CATALOG))
    print(f'VAULT Workbench: http://localhost:{args.port}',flush=True)
    print(f'Original folder: {LIBRARY or "not connected (preview and planning still work)"}',flush=True)
    if args.open:
        threading.Timer(0.8,lambda:webbrowser.open(f'http://localhost:{args.port}')).start()
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        if IMPORTER:
            IMPORTER.cancel()
            if IMPORTER.thread:
                IMPORTER.thread.join(timeout=3)
        server.server_close()

if __name__=='__main__':main()
