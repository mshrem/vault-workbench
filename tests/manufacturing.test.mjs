import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fitRectangle,summarizeFilament,parseUsageCSV,PART_SLOTS} from '../web/manufacturing.js';
import {DEFAULT_STATE,sanitizeState,billOfMaterials,makeManifest} from '../web/core.js';
import {assemblyLayout} from '../web/assembly.js';
const models=JSON.parse(fs.readFileSync(new URL('./fixtures/models.json',import.meta.url)));
const near=(a,b)=>assert(Math.abs(a-b)<1e-6,`${a} != ${b}`);

test('bed rotation finds angled fits and retains Z and clearance constraints',()=>{
  const p={x:250,y:210,z:220,clearance:0};
  const angled=fitRectangle(254,47,146,p);assert(angled.fits);assert(angled.angle>0&&angled.angle<90);
  assert(angled.footprint[0]<=250&&angled.footprint[1]<=210);
  assert(!fitRectangle(254,95,146,p).fits);
  assert(!fitRectangle(254,47,221,p).fits);
  assert(!fitRectangle(254,47,146,{...p,clearance:25}).fits);
  assert(fitRectangle(250,210,220,p).fits);
  const swapped=fitRectangle(210,250,220,p);assert(swapped.fits);near(swapped.angle,90);
  assert(!fitRectangle(10,10,10,{...p,x:50,clearance:30}).fits);
});
test('critical-angle solver agrees with dense feasible examples and never reports an oversized rectangle as fitting',()=>{
  let seed=7;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
  for(let i=0;i<300;i++){
    const x=20+random()*400,y=10+random()*250,p={x:100+random()*250,y:100+random()*200,z:250,clearance:random()*6};
    const fit=fitRectangle(x,y,100,p);
    if(fit.fits){assert(fit.footprint[0]<=p.x-2*p.clearance+1e-7);assert(fit.footprint[1]<=p.y-2*p.clearance+1e-7)}
    else for(let step=0;step<=720;step++){
      const a=step*Math.PI/1440,w=x*Math.cos(a)+y*Math.sin(a),h=x*Math.sin(a)+y*Math.cos(a);
      assert(!(w<=p.x-2*p.clearance&&h<=p.y-2*p.clearance),'Must not miss a feasible sampled angle');
    }
  }
});
test('unknown sliced weights stay incomplete and are not advertised as a zero-gram total',()=>{
  const state=structuredClone(DEFAULT_STATE),parts=billOfMaterials(state,models);
  state.filament.usage.module=100;
  const result=summarizeFilament(state,parts);
  assert(!result.complete);assert.equal(result.totalGrams,null);assert.equal(result.totalCost,null);
  assert.equal(result.knownGrams,100);assert.equal(result.missing.length,parts.length-1);
});
test('filament totals use complete-file copies, one shared roof, group colors, reserve, cost and diameter',()=>{
  const state=structuredClone(DEFAULT_STATE);state.layers.push({label:'second'});state.rails=true;
  const parts=billOfMaterials(state,models);
  for(const p of parts)state.filament.usage[p.key]=10;
  for(const spool of Object.values(state.filament.spools))Object.assign(spool,{density:1.25,diameter:1.75,pricePerKg:400,availableGrams:0});
  const summary=summarizeFilament(state,parts),total=parts.reduce((n,p)=>n+10*p.quantity,0);
  assert(summary.complete);near(summary.totalGrams,total);near(summary.plannedGrams,total*1.1);near(summary.totalCost,total*1.1*.4);
  near(summary.groups.reduce((n,g)=>n+g.plannedGrams,0),summary.plannedGrams);
  for(const g of summary.groups){near(g.lengthMetres,g.plannedGrams/(1.25*Math.PI*(1.75/2)**2));near(g.shortfallGrams,g.plannedGrams);assert.equal(g.color,state.colors[g.slot])}
  assert.equal(summary.rows.find(p=>p.key==='roof').totalGrams,10);
  assert.equal(summary.rows.find(p=>p.key==='springs').totalGrams,20,'paired STL is counted once per drawer');
  assert.equal(summary.rows.find(p=>p.key==='facade-cap').totalGrams,120);
  const manifest=makeManifest(state,models);assert.equal(manifest.filament.totalGrams,total);
  for(const file of manifest.files){assert.match(file.color,/^#[a-f0-9]{6}$/i);assert.equal(file.gramsPerFile,10);assert(file.filament)}
  for(const record of assemblyLayout(state))assert.equal(PART_SLOTS[record.key.replace(/-[01]$/,'')],record.slot,'preview and bill must use the same color group');
});
test('older projects migrate safely, usage survives JSON export, and invalid values are discarded',()=>{
  const raw=structuredClone(DEFAULT_STATE);delete raw.filament;
  assert.deepEqual(sanitizeState(raw).filament.usage,{});
  raw.filament={currency:'<bad>',profile:'a'.repeat(150),allowancePercent:Infinity,usage:{module:NaN,box:-1,key:12},spools:{body:{density:0,diameter:-3,pricePerKg:Infinity}}};
  const safe=sanitizeState(raw);assert.deepEqual(safe.filament.usage,{key:12});assert.equal(safe.filament.currency,'MXN');assert.equal(safe.filament.profile.length,120);
  assert.equal(safe.filament.spools.body.density,1.24);
  assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(makeManifest(safe,models))).configuration),safe);
});
test('usage CSV accepts quoted paths and explicit grams, rejects ambiguous or invalid records',()=>{
  const parts=billOfMaterials(DEFAULT_STATE,models),id=parts[0].id;
  const head='Catalog ID,File,Grams per complete STL\r\n';
  assert.deepEqual(parseUsageCSV('\ufeff'+head+`${id},"name, with ""quotes"".stl",123.45\r\n`,parts),{module:123.45});
  for(const body of [`unknown,file,10`,`${id},file,-3`,`${id},file,NaN`,`${id},file,2\n${id},file,3`,`${id},"file,12`,`${id},file,`])assert.throws(()=>parseUsageCSV(head+body,parts));
  assert.throws(()=>parseUsageCSV('wrong,headers\n1,2',parts));
});
