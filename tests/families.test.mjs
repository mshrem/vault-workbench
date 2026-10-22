import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../web/vendor/build/three.module.js';
import {DEFAULT_STATE,sanitizeState,billOfMaterials,makeManifest} from '../web/core.js';
import {resolveDrawerModels,missingGeometry} from '../web/families.js';
import {orientPart,splitPair} from '../web/assembly-geometry.js';
import {assemblyLayout} from '../web/assembly.js';
import {readGeometry} from './geometry-utils.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../web/data/catalog.json',import.meta.url)));
const bundled=JSON.parse(fs.readFileSync(new URL('./fixtures/models.json',import.meta.url)));
const cached=Object.fromEntries(catalog.filter(i=>i.type==='stl').map(i=>[i.id,{previewAvailable:true,printSize:[100,100,10]}]));

test('all 45 S/M/L drawer combinations resolve exact original files, with both roofs',()=>{
  for(const family of ['S','M','L'])for(const depth of [3,4,5,6,7])for(const height of [1,2,4])for(const roof of ['grid','table']){
    const s=sanitizeState({...DEFAULT_STATE,family,depth,height,roof,baseplate:false});
    const models=resolveDrawerModels(s,catalog,cached,bundled),plan=makeManifest(s,models);
    assert.equal(models.module.name.toLowerCase(),`${family}${depth} Module ${height}F.stl`.toLowerCase());
    assert.equal(models.box.name,`${family}${depth} Box ${height}F.stl`);
    assert.equal(models.facade.name,`${family}${height}F (Turn On Supports).stl`);
    assert.equal(models.guides.name,`x${depth} Runner Guides.stl`);
    assert.equal(models.roof.name,`${family}${depth} ${roof==='table'?'Table':'Grid'} Roof.stl`);
    assert(!plan.files.some(p=>p.path.includes('SUSTAINERS')||p.path.includes('²')||p.path.includes('Baseplate')));
    assert.equal(plan.hardware[0].quantity,height===1?4:6);
    assert.deepEqual(sanitizeState(plan.configuration),s);
    assert.deepEqual(missingGeometry(s,models),[]);
    assert.equal(plan.files.find(p=>p.id===models.module.catalogId).quantity,1);
  }
});

test('dimensions-only parts remain selectable without substituting sample geometry',()=>{
  const s=sanitizeState({...DEFAULT_STATE,family:'L',depth:7,height:4,roof:'table'});
  const previews=structuredClone(cached),item=catalog.find(i=>i.name==='L7 Module 4F.stl');
  previews[item.id].previewAvailable=false;
  const models=resolveDrawerModels(s,catalog,previews,bundled);
  assert.equal(models.module.url,null);assert.deepEqual(missingGeometry(s,models),[item.name]);
  assert(makeManifest(s,models).files.some(p=>p.id===item.id));
});

test('connected replacement libraries never fall back to old bundled meshes or dimensions',()=>{
  const models=resolveDrawerModels(DEFAULT_STATE,catalog,{},bundled,{useBundled:false});
  for(const key of ['module','box','facade','key','springs']){
    assert.equal(models[key].url,null);assert.equal(models[key].printSize,null);
    assert(missingGeometry(DEFAULT_STATE,models).includes(models[key].name));
  }
  const previews=structuredClone(cached),id=models.module.catalogId;
  previews[id].previewRevision='revision-one';
  const first=resolveDrawerModels(DEFAULT_STATE,catalog,previews,bundled,{useBundled:false});
  previews[id].previewRevision='revision-two';
  const next=resolveDrawerModels(DEFAULT_STATE,catalog,previews,bundled,{useBundled:false});
  assert.notEqual(first.module.url,next.module.url);assert(next.module.url.endsWith('?v=revision-two'));
});

test('auto orientation restores synthetic chassis dimensions after printing rotations',()=>{
  const original=readGeometry('module'),before=Array.from(original.attributes.position.array);
  for(const degrees of [0,45,135,-45,180]){
    const g=original.clone().rotateZ(degrees*Math.PI/180),source=new THREE.Group();source.add(new THREE.Mesh(g));
    const object=orientPart(source,{width:254,height:201.009,uprightShell:false});
    const size=new THREE.Box3().setFromObject(object,true).getSize(new THREE.Vector3());
    assert(Math.abs(size.x-254)<.2);assert(Math.abs(size.y-201.009)<.2);assert(Math.abs(size.z-146.1)<.1);

  }
  assert.deepEqual(Array.from(original.attributes.position.array),before);
});

test('paired splitting preserves every triangle and centers synthetic components',()=>{
  for(const key of ['guides','slides']){
    const group=new THREE.Group();group.add(new THREE.Mesh(readGeometry(key)));
    const parts=splitPair(group),triangles=parts.reduce((n,p)=>n+p.children[0].geometry.attributes.position.count/3,0);
    assert.equal(triangles,readGeometry(key).index.count/3);
    for(const p of parts){const b=new THREE.Box3().setFromObject(p,true);assert(b.getCenter(new THREE.Vector3()).length()<1e-4)}
  }
});

test('L3 two-floor stack uses 96 mm pitch, a shared table roof and complete drawer movement',()=>{
  const s={...DEFAULT_STATE,family:'L',depth:3,height:2,roof:'table',baseplate:false,normalizedAssets:true,layers:[{},{}]};
  const closed=assemblyLayout(s),open=assemblyLayout(s,{open:1});
  const modules=closed.filter(r=>r.key==='module');assert.equal(modules[1].position[1]-modules[0].position[1],96);
  assert.equal(closed.filter(r=>r.key==='roof').length,1);
  assert(!closed.some(r=>r.key==='baseplate'));assert.equal(closed.filter(r=>r.key==='facade-cap').length,12);
  closed.forEach((r,i)=>assert.equal(Math.round(open[i].position[2]-r.position[2]),r.group==='drawer'?105:0));
});
