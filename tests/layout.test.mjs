import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DEFAULT_STATE} from '../web/core.js';
import {exampleLayout,fromSingleBuild,sanitizeLayout,layoutInstances,instancePlacement,buildLayoutPlan,layoutManifest,makeRow} from '../web/layout.js';
const catalog=JSON.parse(fs.readFileSync(new URL('../web/data/catalog.json',import.meta.url)));
const previews=Object.fromEntries(catalog.filter(p=>p.type==='stl').map(p=>[p.id,{previewAvailable:true,printSize:[100,100,10]}]));
const status={connected:true,available:Object.fromEntries(catalog.map(p=>[p.id,true]))};
const plan=()=>exampleLayout({...structuredClone(DEFAULT_STATE),height:1,baseplate:false});

test('one L with two S modules above has matching nominal widths and independent level heights',()=>{
 const p=plan();p.rows[0].height=4;p.rows[1].height=2;
 const instances=layoutInstances(p);assert.equal(instances.length,3);
 assert.deepEqual(instances.map(i=>i.position),[[0,0,0],[-82.4,192,0],[82.4,192,0]]);
 assert.equal(instances[1].width+instances[2].width,instances[0].width);
 const placement=instancePlacement(instances[1]);assert(placement.every(r=>r.rowId===p.rows[1].id));
 const module=placement.find(r=>r.key==='module');assert.equal(module.position[0],-82.4);assert.equal(module.position[1],192+(96+9.009)/2);
 const exploded=layoutInstances(p,{exploded:true});assert.equal(exploded[1].position[1],282);
});
test('mixed BOM aggregates whole STL identities and counts per-facade hardware, roofs and paired files',()=>{
 const p=plan();p.rows[0].height=2;const r=buildLayoutPlan(p,catalog,previews,status);
 assert(r.catalogComplete);assert.equal(r.description.modules,3);assert.equal(r.bolts,14);
 assert.equal(r.parts.find(i=>i.name==='Key (Turn On Supports).stl').quantity,3);
 assert.equal(r.parts.find(i=>i.name==='Springs.stl').quantity,3,'paired spring STL is one file per drawer');
 assert.equal(r.parts.find(i=>i.name==='Runner Stopper.stl').quantity,6);
 assert.equal(r.parts.find(i=>i.name==='Facade Cap.stl').quantity,14);
 assert.equal(r.parts.find(i=>i.name==='S3 Grid Roof.stl').quantity,2);
 assert(!r.parts.some(i=>i.name==='L3 Grid Roof.stl'),'no unselected transition roof may be invented');
 assert(r.issues.some(i=>i.type==='interface'));assert.equal(new Set(r.parts.map(p=>p.id)).size,r.parts.length);
 p.rows[0].roof='grid';assert.equal(buildLayoutPlan(p,catalog,previews,status).parts.find(i=>i.name==='L3 Grid Roof.stl').quantity,1);
});
test('missing previews preserve original IDs and quantities while missing catalog files block incomplete exports',()=>{
 const p=plan(),source=catalog.find(i=>i.name==='S3 Box 1F.stl'&&i.category==='Drawers'),copy=structuredClone(previews);copy[source.id].previewAvailable=false;
 const r=buildLayoutPlan(p,catalog,copy,status);assert(r.catalogComplete);assert.equal(r.parts.find(i=>i.id===source.id).quantity,2);
 assert.equal(r.parts.find(i=>i.id===source.id).previewAvailable,false);assert(r.issues.some(i=>i.type==='preview'));assert(r.canPackage);
 const absent=buildLayoutPlan(p,catalog.filter(i=>i.id!==source.id),previews,status);assert(!absent.catalogComplete);assert(!absent.canPackage);assert.throws(()=>layoutManifest(p,absent));
});
test('printer checks each source rather than the overall tower; filament stays incomplete until every STL is sliced',()=>{
 const p=plan(),first=catalog.find(i=>i.name==='L3 Module 1F.stl'&&i.category==='Drawers'),copy=structuredClone(previews);copy[first.id].printSize=[400,350,10];
 let r=buildLayoutPlan(p,catalog,copy,status);assert(!r.parts.find(i=>i.id===first.id).fit.fits);assert.equal(r.filament.plannedGrams,null);
 for(const part of r.parts)p.usage[part.id]=10;
 r=buildLayoutPlan(p,catalog,copy,status);assert(r.filament.complete);assert.equal(r.filament.totalGrams,r.totalCopies*10);assert.equal(r.filament.plannedGrams,r.totalCopies*11);
 p.printed[first.id]=100;assert.equal(buildLayoutPlan(p,catalog,copy,status).printedFiles,1);
});
test('layout JSON roundtrips levels, colors, file-keyed weights and progress; old single-size plans import without changing the originals',()=>{
 const current=structuredClone(DEFAULT_STATE);current.family='S';current.height=2;current.layers.push({label:'second'});current.colors.front='#123456';
 const original=JSON.stringify(current),p=fromSingleBuild(current);assert.equal(p.rows.length,2);assert.equal(p.rows[0].roof,'none');assert.equal(p.rows[1].roof,'grid');assert.equal(p.colors.front,'#123456');assert.equal(JSON.stringify(current),original);
 const r=buildLayoutPlan(p,catalog,previews,status),id=r.parts[0].id;p.usage[id]=23.5;p.printed[id]=1;
 assert.deepEqual(sanitizeLayout(JSON.parse(JSON.stringify(layoutManifest(p,buildLayoutPlan(p,catalog,previews,status))))),sanitizeLayout(p));
});
test('unsupported mixed widths, duplicate IDs, invalid heights and oversized layouts are rejected',()=>{
 for(const mutate of [p=>p.depth=8,p=>p.rows[1].layout='M',p=>p.rows[1].height=3,p=>p.rows[1].id=p.rows[0].id,p=>p.rows=[],p=>p.rows=Array.from({length:7},()=>makeRow())]){
  const p=plan();mutate(p);assert.throws(()=>sanitizeLayout(p));
 }
 const p=plan();p.usage={['a'.repeat(16)]:NaN,['b'.repeat(16)]:-1,['c'.repeat(16)]:12};p.printed={['a'.repeat(16)]:1.2};
 assert.deepEqual(sanitizeLayout(p).usage,{['c'.repeat(16)]:12});assert.deepEqual(sanitizeLayout(p).printed,{});
});
