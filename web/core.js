import {familyCode,drawerHeight,boltCount,DRAWER_WIDTHS} from './families.js';
import {fitRectangle,defaultFilament,sanitizeFilament,summarizeFilament,PART_SLOTS} from './manufacturing.js';
export const PRESETS = {
  sunny:{body:'#e5e7de',front:'#efcf60',accent:'#cf5638',box:'#444d43'},
  studio:{body:'#e7e8ea',front:'#e7e8ea',accent:'#ff8038',box:'#bac0c8'},
  forest:{body:'#dfe2d3',front:'#687b58',accent:'#dfb763',box:'#3c493b'},
  night:{body:'#454b49',front:'#303b36',accent:'#c99458',box:'#232a27'}
};
export const DEFAULT_STATE = {
  version:1, family:'M',depth:3,height:4, layers:[{label:'Tools & spares'}], roof:'grid', baseplate:false, rails:false,
  label:'Tools & spares', colors:{...PRESETS.studio},
  printer:{name:'Custom 256 mm printer',x:256,y:256,z:256,clearance:0},filament:defaultFilament()
};
export const TITLES={module:'M3 / 4F module',box:'M3 / 4F drawer box',facade:'M / 4F facade',roof:'M3 grid roof',
  baseplate:'M3 Gridfinity baseplate',key:'Key lock','key-cap':'Key cap','facade-cap':'Facade cap',springs:'Springs · paired STL',
  latch:'Module latch',label:'Label',stopper:'Runner stopper',guides:'x3 runner guides · paired STL',slides:'x3 runner slides · paired STL',rails:'M geared rails · paired STL'};

export function sanitizeState(raw){
  if(!raw || raw.version!==1 || !Array.isArray(raw.layers) || raw.layers.length<1 || raw.layers.length>6) throw new Error('This is not a supported VAULT build plan.');
  const s=structuredClone(DEFAULT_STATE);
  s.family=raw.family??'M';s.depth=raw.depth??3;s.height=raw.height??4;
  if(!DRAWER_WIDTHS[s.family]||![3,4,5,6,7].includes(s.depth)||![1,2,4].includes(s.height))throw new Error('Choose an S, M or L drawer, depth 3–7 and height 1F, 2F or 4F.');
  s.layers=raw.layers.map(l=>({label:String(l?.label||'Drawer').slice(0,24)}));
  s.roof=['none','table'].includes(raw.roof)?raw.roof:'grid';s.baseplate=raw.baseplate===true;s.rails=raw.rails===true;
  s.label=String(raw.label||'').slice(0,24);
  for(const k of Object.keys(s.colors))if(/^#[0-9a-f]{6}$/i.test(raw.colors?.[k]))s.colors[k]=raw.colors[k];
  for(const k of ['x','y','z']){
    const n=Number(raw.printer?.[k]);if(Number.isFinite(n)&&n>=50&&n<=1000)s.printer[k]=n;
  }
  const n=Number(raw.printer?.clearance);if(Number.isFinite(n)&&n>=0&&n<=30)s.printer.clearance=n;
  s.printer.name=String(raw.printer?.name||s.printer.name).slice(0,60);
  s.filament=sanitizeFilament(raw.filament);
  return s;
}

export function billOfMaterials(state, models){
  const n=state.layers.length;
  const quantities={module:n,box:n,facade:n,key:n,'key-cap':n,'facade-cap':boltCount(state)*n,
    springs:n,latch:n,label:n,stopper:2*n,guides:n,slides:n};
  if(state.roof!=='none')quantities.roof=1;
  if(state.baseplate)quantities.baseplate=n;
  if(state.rails)quantities.rails=n;
  const order=['module','box','facade','roof','baseplate','key','key-cap','facade-cap','springs','latch','label','guides','slides','stopper','rails'];
  return order.filter(k=>quantities[k]).map(key=>({key,id:models[key].catalogId, name:models[key].name,
    path:models[key].path,quantity:quantities[key],bytes:models[key].bytes,title:models[key].title||TITLES[key]}));
}

export function checkFit(state,models){
  const p=state.printer;
  const parts=billOfMaterials(state,models).map(item=>{
    if(!models[item.key].printSize)return {key:item.key,name:item.name,fits:false,unknown:true};
    const [x,y,z]=models[item.key].printSize;
    return {key:item.key,name:item.name,...fitRectangle(x,y,z,p)};
  });
  return {fits:parts.every(p=>p.fits),parts,failures:parts.filter(p=>!p.fits)};
}

export function makeManifest(state,models){
  const safe=sanitizeState(state),parts=billOfMaterials(safe,models);
  return {application:'VAULT Workbench',applicationVersion:'0.5.0-dev',createdAt:new Date().toISOString(),
    configuration:safe,files:parts.map(({key,id,name,path,quantity})=>({id,name,path,quantity,filamentSlot:PART_SLOTS[key],color:safe.colors[PART_SLOTS[key]],filament:safe.filament.spools[PART_SLOTS[key]].name,gramsPerFile:safe.filament.usage[key]??null})),
    filament:summarizeFilament(safe,parts),
    hardware:[{name:'M4 × 14 mm bolts',quantity:boltCount(state)*state.layers.length,source:'01 Instructions Manual, page 18 (4 for 1F; 6 for 2F/4F)'}],
    notes:[`${familyCode(safe)} / ${drawerHeight(safe)}F drawer assembly. Positions are illustrative, not mechanical verification.`,
      'Quantities refer to whole STL files, including paired pieces.',
      'Facade cap quantities follow the manual fastener count; verify against the original facade. New-family small part placements are illustrative.',
      'Use original STLs for printing. Simplified GLB previews are not print files.',
      'Printer checks rotate source STL bounding rectangles in the bed plane. Slicer exclusions and non-rectangular contours are not simulated.',
      'Colors and filament assignments are in this plan and CSV. STL format does not carry these settings.',
      'Filament totals require slicer-reported grams per complete STL. Allowance is a separate planning reserve, not a simulated purge calculation.',
      'The manual page 3 gives a general drawer fastener summary; page 18 explicitly lists six bolts for 2F/4F.',
      'Projects are stored in this browser. Export this plan for backup.']};
}

export function prettyBytes(n){return n>=1e9?(n/1e9).toFixed(2)+' GB':n>=1e6?(n/1e6).toFixed(1)+' MB':(n/1000).toFixed(0)+' KB'}
