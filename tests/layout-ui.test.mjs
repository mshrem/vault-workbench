import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
import {createLayoutUI} from '../web/layout-ui.js';import {DEFAULT_STATE} from '../web/core.js';
const require=createRequire(import.meta.url);const {JSDOM}=process.env.VAULT_TEST_NODE_MODULES?require(require.resolve('jsdom',{paths:[process.env.VAULT_TEST_NODE_MODULES]})):require('jsdom');
const catalog=JSON.parse(fs.readFileSync(new URL('../web/data/catalog.json',import.meta.url)));

test('mixed layout controls edit, duplicate, reorder, undo, total sliced weights and package unique original files',async()=>{
 const dom=new JSDOM(fs.readFileSync(new URL('../web/layout.html',import.meta.url),'utf8'),{url:'http://localhost:8787/layout.html'}),document=dom.window.document,$=s=>document.querySelector(s),downloads=[],requests=[];
 const current={...structuredClone(DEFAULT_STATE),family:'L',height:1,baseplate:false};dom.window.localStorage.setItem('vault-current-v1',JSON.stringify(current));
 const previews=Object.fromEntries(catalog.filter(i=>i.type==='stl').map(i=>[i.id,{previewAvailable:true,printSize:[100,100,10]}]));
 const fakeViewer={async update(p,r){return {webgl:true,schematic:0}},select(){},setView(){},fit(){},motion(){}};
 const fetch=async(path,args)=>{requests.push({path,args});return {ok:true,json:async()=>path==='api/catalog'?catalog:path==='api/previews'?previews:{connected:true,available:Object.fromEntries(catalog.map(i=>[i.id,true]))},blob:async()=>new Blob(['zip'])}};
 const ui=createLayoutUI({document,fetch,storage:dom.window.localStorage,viewer:fakeViewer,download:(...args)=>downloads.push(args)});await ui.ready;
 $('#layout-example').click();
 const change=(selector,value)=>{const input=$(selector);input.value=value;input.dispatchEvent(new dom.window.Event('change',{bubbles:true}))};
 assert.equal(ui.getPlan().rows.length,2);assert.equal(ui.getResult().description.modules,3);assert.equal(ui.getResult().bolts,12);
 change('[data-field="height"]','2');assert.equal(ui.getPlan().rows[1].height,2);assert.equal(ui.getPlan().rows[0].height,1);assert.equal(ui.getResult().bolts,16);
 $('[data-action="duplicate"]').click();assert.equal(ui.getPlan().rows.length,3);assert.equal(ui.getResult().description.modules,5);
 $('[data-action="down"]').click();assert.equal(ui.getPlan().rows[1].height,2);
 $('#layout-undo').click();$('#layout-undo').click();assert.equal(ui.getPlan().rows.length,2);
 change('[data-field="layout"]','L');assert.equal(ui.getResult().description.modules,2);$('#layout-undo').click();
 assert.equal(ui.getResult().description.modules,3);
 for(const input of document.querySelectorAll('#layout-filament-inputs input')){input.value='10';input.dispatchEvent(new dom.window.Event('input'))}
 assert(ui.getResult().filament.complete);assert.equal(ui.getResult().filament.totalGrams,ui.getResult().totalCopies*10);
 $('#layout-parts input[type=checkbox]').click();assert(ui.getResult().printedFiles>0);
 $('#layout-save').click();const manifest=JSON.parse(downloads.at(-1)[1]);assert.equal(manifest.layout.rows.length,2);assert.equal(manifest.files.length,new Set(manifest.files.map(p=>p.id)).size);
 await $('#layout-package').onclick();const packaged=JSON.parse(requests.find(r=>r.path==='api/package').args.body);assert.equal(packaged.layout.kind,'vault-layout');assert.equal(packaged.files.find(p=>p.name==='Key (Turn On Supports).stl').quantity,3);
 assert.equal(downloads.at(-1)[0],'VAULT-layout-originals.zip');assert.equal(JSON.parse(dom.window.localStorage.getItem('vault-current-v1')).family,'L');
 dom.window.localStorage.setItem('vault-current-v1',JSON.stringify({...current,printer:{...current.printer,name:'Voron 350',x:350,y:350,z:330}}));$('#layout-refresh-printer').click();assert.equal(ui.getPlan().printer.x,350);assert.equal(ui.getPlan().printer.z,330);
 // A second controller must restore the layout instead of resetting it to a template.
 const stored=JSON.parse(dom.window.localStorage.getItem('vault-layout-v1'));assert.equal(stored.rows[1].height,2);assert(Object.keys(stored.usage).length>0);
 ui.destroy();
 const restored=createLayoutUI({document,fetch,storage:dom.window.localStorage,viewer:fakeViewer,download:(...args)=>downloads.push(args)});await restored.ready;assert.equal(restored.getPlan().rows[1].height,2);assert(restored.getResult().filament.complete);restored.destroy();
 dom.window.close();
});

test('one configurator restores legacy projects, distinguishes roof from insert and saves the whole mixed project',async()=>{
 const dom=new JSDOM(fs.readFileSync(new URL('../web/layout.html',import.meta.url),'utf8'),{url:'http://localhost:8787/layout.html#filament'}),document=dom.window.document,$=s=>document.querySelector(s),storage=dom.window.localStorage,motions=[];
 const legacy={...structuredClone(DEFAULT_STATE),family:'L',height:1,roof:'grid',baseplate:false,colors:{...DEFAULT_STATE.colors,front:'#aabbcc'}};
 storage.setItem('vault-current-v1',JSON.stringify(legacy));storage.setItem('vault-projects-v1',JSON.stringify([{name:'Old project',savedAt:'2026-10-22',state:legacy}]));
 const viewer={async update(){return {webgl:true,schematic:0}},select(){},setView(){},fit(){},motion(options){motions.push(options)}};
 const fetch=async path=>({ok:true,json:async()=>path==='api/catalog'?catalog:path==='api/previews'?{}:{connected:true,available:Object.fromEntries(catalog.map(i=>[i.id,true]))}});
 let ui=createLayoutUI({document,fetch,storage,viewer,download(){}});await ui.ready;
 assert.equal(ui.getPlan().rows.length,1);assert.equal(ui.getPlan().colors.front,'#aabbcc');assert.equal($('#layout-tab-filament').hidden,false);
 assert(ui.getResult().parts.some(p=>p.name==='L3 Grid Roof.stl'));assert(!ui.getResult().parts.some(p=>p.key==='baseplate'));
 $('[data-field=baseplate]').click();assert(ui.getResult().parts.some(p=>p.name==='L3 Baseplate.stl'));assert(ui.getResult().parts.some(p=>p.name==='L3 Grid Roof.stl'));
 const roof=$('[data-field=roof]');roof.value='table';roof.dispatchEvent(new dom.window.Event('change'));assert(ui.getResult().parts.some(p=>p.name==='L3 Table Roof.stl'));assert(ui.getResult().parts.some(p=>p.name==='L3 Baseplate.stl'));
 $('[data-show-interior]').click();assert.equal(motions.at(-1).open,1);
 $('#layout-single').click();assert.equal(ui.getPlan().rows.length,1);assert.equal(ui.getPlan().rows[0].baseplate,false);assert.equal(ui.getPlan().rows[0].roof,'table');assert(!ui.getResult().parts.some(p=>p.key==='baseplate'||p.name.includes('Grid Roof')));
 $('#layout-example').click();$('#layout-project-save').click();const projects=JSON.parse(storage.getItem('vault-projects-v1'));assert.equal(projects.length,2);assert.equal(projects[0].state.rows.length,2);assert.deepEqual(projects[1].state,legacy);
 ui.destroy();storage.setItem('vault-builder-open-v1',JSON.stringify(legacy));
 ui=createLayoutUI({document,fetch,storage,viewer,download(){}});await ui.ready;assert.equal(ui.getPlan().rows.length,1);assert.equal(ui.getPlan().rows[0].roof,'grid');assert.equal(storage.getItem('vault-builder-open-v1'),null);assert.equal(JSON.parse(storage.getItem('vault-layout-v1')).rows.length,1);
 ui.destroy();dom.window.close();
});
