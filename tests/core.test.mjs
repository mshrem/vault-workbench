import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DEFAULT_STATE,sanitizeState,billOfMaterials,checkFit,makeManifest} from '../web/core.js';
const models=JSON.parse(fs.readFileSync(new URL('./fixtures/models.json',import.meta.url)));
test('stacking shares one roof and multiplies individual drawers and small parts',()=>{
  const s=structuredClone(DEFAULT_STATE);s.layers.push({label:'Second'},{label:'Third'});
  const bom=Object.fromEntries(billOfMaterials(s,models).map(p=>[p.key,p.quantity]));
  assert.equal(bom.roof,1);assert.equal(bom.box,3);assert.equal(bom.guides,3);assert.equal(bom.stopper,6);
  assert.equal(makeManifest(s,models).hardware[0].quantity,18);
  s.roof='none';s.baseplate=false;s.rails=true;
  const changed=billOfMaterials(s,models);assert(!changed.some(p=>p.key==='roof'||p.key==='baseplate'));assert.equal(changed.find(p=>p.key==='rails').quantity,3);
});
test('printer fit checks the original geometry, includes margins, and supports X/Y swapping',()=>{
  const s=structuredClone(DEFAULT_STATE);assert(checkFit(s,models).fits);
  s.printer.clearance=2;assert(!checkFit(s,models).fits);
  s.printer={name:'Rectangular',x:210,y:260,z:190,clearance:0};assert(checkFit(s,models).fits);
  s.printer.z=145;assert(!checkFit(s,models).fits);
  assert(checkFit(s,models).failures.some(p=>p.key==='module'));
});
test('import bounds unsupported configurations and sanitizes editable fields',()=>{
  assert.throws(()=>sanitizeState({version:999,layers:[]}));
  assert.throws(()=>sanitizeState({...DEFAULT_STATE,layers:Array(7).fill({})}));
  const raw=structuredClone(DEFAULT_STATE);raw.colors.body='url(bad)';raw.printer.x=-2;raw.layers[0].label='a'.repeat(100);
  const safe=sanitizeState(raw);assert.equal(safe.colors.body,DEFAULT_STATE.colors.body);assert.equal(safe.printer.x,256);assert.equal(safe.layers[0].label.length,24);
  assert.deepEqual(sanitizeState(makeManifest(safe,models).configuration),safe);
});
test('all selected files resolve uniquely to the inventory',()=>{
  const catalog=JSON.parse(fs.readFileSync(new URL('../web/data/catalog.json',import.meta.url)));
  assert.equal(catalog.filter(p=>p.type==='stl'&&p.category!=='Pegboard').length,723);
  assert.equal(catalog.filter(p=>p.type==='stl'&&p.category==='Pegboard').length,254);
  for(const part of billOfMaterials(DEFAULT_STATE,models)){
    const original=catalog.find(c=>c.id===part.id);assert(original);assert.equal(original.path,part.path);

  }
});
