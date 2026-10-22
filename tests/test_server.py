import hashlib
import http.client
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
import zipfile
from importer import PreviewImporter
from test_importer import write_cube

BASE=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('vault_server',BASE/'server.py')
server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)

class ServerTests(unittest.TestCase):
    def test_replacement_scan_updates_sizes_preserves_ids_and_drops_deleted_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'same.stl').write_bytes(b'new corrected source')
            (root/'new.stl').write_bytes(b'new part')
            (root/'Unicode².stl').write_bytes(b'unicode part')
            baseline=[dict(id='same-id',path='same.stl',name='same.stl',bytes=1,type='stl',category='Drawers'),
                      dict(id='gone-id',path='gone.stl',name='gone.stl',bytes=1,type='stl',category='Drawers'),
                      dict(id='unicode-id',path='Unicode?.stl',name='Unicode?.stl',bytes=1,type='stl',category='Drawers')]
            result={i['path']:i for i in server.scan_catalog(root,baseline)}
            self.assertEqual(set(result),{'same.stl','new.stl','Unicode².stl'})
            self.assertEqual(result['same.stl']['id'],'same-id')
            self.assertEqual(result['same.stl']['bytes'],len(b'new corrected source'))
            self.assertEqual(result['Unicode².stl']['id'],'unicode-id')
            self.assertEqual(baseline[0]['bytes'],1)
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();server.LIBRARY=Path(cls.tmp.name)
        cls.item=next(c for c in server.CATALOG if c.get('preview')=='module')
        cls.bytes=b'unchanged original bytes\x00\xff'
        target=server.LIBRARY/cls.item['path'];target.parent.mkdir(parents=True);target.write_bytes(cls.bytes)
        server.IMPORTER=PreviewImporter(server.CATALOG,server.resolve_original,Path(cls.tmp.name)/'preview-cache')
        server.IMPORTER.connect(server.LIBRARY)
        cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close();cls.thread.join();cls.tmp.cleanup()
    def request(self,method,path,body=None,headers=None):
        c=http.client.HTTPConnection('127.0.0.1',self.http.server_port)
        c.request(method,path,body=body,headers=headers or {});r=c.getresponse();result=(r.status,r.read());c.close();return result
    def test_missing_original_is_reported_and_package_never_substitutes_a_preview(self):
        missing=next(c for c in server.CATALOG if c.get('preview')=='box')
        code,data=self.request('POST','/api/package',json.dumps({'files':[{'id':missing['id'],'quantity':1}]}))
        self.assertEqual(code,409);self.assertIn('original',json.loads(data)['error'])
    def test_layout_assets_are_served_and_mixed_layout_metadata_survives_packaging(self):
        for path in ('/layout.html','/layout.js','/layout-ui.js','/layout-viewer.js','/layout.css'):
            code,data=self.request('GET',path)
            self.assertEqual(code,200,path)
            self.assertTrue(data)
        manifest={'layout':{'kind':'vault-layout','version':1,'rows':[{'layout':'L'},{'layout':'SS'}]},
                  'files':[{'id':self.item['id'],'quantity':3}], 'filament':{'complete':False,'totalGrams':None}}
        code,data=self.request('POST','/api/package',json.dumps(manifest))
        self.assertEqual(code,200)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            self.assertEqual(json.loads(z.read('build.json')),manifest)
            self.assertEqual(z.read('originals/'+self.item['path']),self.bytes)

    def test_package_preserves_original_bytes_and_records_copies(self):
        manifest={'files':[{'id':self.item['id'],'quantity':3,'filament':'PLA Cream','color':'#e5e7de','gramsPerFile':123.4}],
                  'filament':{'complete':True,'totalGrams':370.2}}
        code,data=self.request('POST','/api/package',json.dumps(manifest));self.assertEqual(code,200)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            self.assertEqual(z.read('originals/'+self.item['path']),self.bytes)
            self.assertEqual(json.loads(z.read('build.json')),manifest)
            self.assertIn(',3,',z.read('parts.csv').decode())
            self.assertIn('PLA Cream,#e5e7de,123.4,370.2',z.read('parts.csv').decode())
            self.assertEqual(json.loads(z.read('filament-plan.json')),manifest['filament'])
            self.assertNotIn('.glb',' '.join(z.namelist()))
    def test_traversal_and_cross_origin_package_requests_are_rejected(self):
        self.assertIsNone(server.resolve_original({'path':'../../server.py'}))
        code,_=self.request('GET','/api/original/../../server.py');self.assertEqual(code,404)
        code,_=self.request('GET','/%2e%2e/server.py');self.assertEqual(code,404)
        code,_=self.request('POST','/api/package','{}',{'Origin':'https://unrelated.example'});self.assertEqual(code,403)
    def test_invalid_selections_and_unknown_endpoints(self):
        for files in [[],[{'id':self.item['id'],'quantity':0}],[{'id':'unknown','quantity':1}]]:
            code,_=self.request('POST','/api/package',json.dumps({'files':files}));self.assertEqual(code,400)
        code,_=self.request('GET','/api/no-such-endpoint');self.assertEqual(code,404)
    def test_support_bundle_contains_local_diagnostics_without_originals_or_absolute_paths(self):
        code,_=self.request('POST','/api/diagnostics/event',json.dumps({'event':'assembly_missing','partIds':[self.item['id']],
                            'message':'/home/private/SECRET','url':'http://private/?token=SECRET'}))
        self.assertEqual(code,200)
        code,data=self.request('GET','/api/support');self.assertEqual(code,200)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            self.assertEqual(set(archive.namelist()),{'report.json','events.jsonl','README.txt'})
            report=json.loads(archive.read('report.json'))
            self.assertTrue(report['environment']['packages']['scipy'])
            joined=b''.join(archive.read(n) for n in archive.namelist()).decode()
            self.assertNotIn(str(self.tmp.name),joined);self.assertNotIn('SECRET',joined)
            self.assertIn('assembly_missing',joined)
        code,_=self.request('POST','/api/diagnostics/event',json.dumps({'event':'arbitrary'}));self.assertEqual(code,400)
        code,_=self.request('POST','/api/diagnostics/event','{}',{'Origin':'https://unrelated.example'});self.assertEqual(code,403)
    def test_importer_api_is_local_scoped_and_preview_paths_are_isolated(self):
        for path in ['/api/importer','/api/previews','/api/importer/report']:
            code,data=self.request('GET',path);self.assertEqual(code,200);json.loads(data)
        for key in ['unknown','../index.json','a'*16]:
            code,_=self.request('GET','/api/preview/'+key);self.assertEqual(code,404)
        for endpoint in ['/api/importer/start','/api/importer/cancel']:
            code,_=self.request('POST',endpoint,'{}',{'Origin':'https://unrelated.example'});self.assertEqual(code,403)
        code,_=self.request('POST','/api/importer/start',json.dumps({'category':'bad','maxMB':128}));self.assertEqual(code,409)
        code,data=self.request('POST','/api/importer/cancel','{}');self.assertEqual(code,200)
    def test_bundle_and_catalog_can_be_served_without_external_dependencies(self):
        for p in ['/','/app.js','/vendor/build/three.module.js','/api/catalog']:
            code,data=self.request('GET',p);self.assertEqual(code,200,p);self.assertTrue(data)
        code,data=self.request('GET','/api/status');self.assertEqual(json.loads(data)['matched'],1)

    @unittest.skipIf(bool(PreviewImporter.dependencies()), 'Optional importer packages not installed')
    def test_start_real_import_and_serve_the_cached_glb_via_http(self):
        source=server.resolve_original(self.item)
        try:
            write_cube(source)
            code,data=self.request('POST','/api/importer/start',json.dumps({'category':'Drawers','maxMB':128}))
            self.assertEqual(code,202)
            server.IMPORTER.thread.join(20)
            self.assertFalse(server.IMPORTER.thread.is_alive())
            code,data=self.request('GET','/api/previews')
            self.assertTrue(json.loads(data)[self.item['id']]['previewAvailable'])
            code,data=self.request('GET','/api/preview/'+self.item['id'])
            self.assertEqual(code,200);self.assertEqual(data[:4],b'glTF')
            code,data=self.request('GET','/api/importer/report')
            records=json.loads(data)['records'];self.assertEqual(records[0]['printSize'],[30,20,10])
            self.assertNotIn(str(server.LIBRARY),data.decode())
        finally:
            source.write_bytes(self.bytes)

if __name__=='__main__':unittest.main()
