import {DEFAULT_STATE,sanitizeState,billOfMaterials} from './core.js';
import {DRAWER_WIDTHS,boltCount,resolveDrawerModels,requiredPreviewKeys} from './families.js';
import {fitRectangle,sanitizeFilament,PART_SLOTS} from './manufacturing.js';
import {assemblyLayout} from './assembly.js';
export const LAYOUTS={S:['S'],M:['M'],L:['L','SS']};
export const MAX_ROWS=6;
export const LAYOUT_VERSION=1;
export const NEUTRAL_COLORS={body:'#e7e8ea',front:'#e7e8ea',box:'#bac0c8',accent:'#ff8038'};
const freshId=()=>globalThis.crypto?.randomUUID?.()||'row-'+Math.random().toString(36).slice(2,12);
const validColor=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
export function makeRow(layout='L',height=1,roof='none'){return {id:freshId(),layout,height,roof,label:'',baseplate:false,rails:false}}
export function exampleLayout(current=DEFAULT_STATE){
  const s=sanitizeState(current);
  return {kind:'vault-layout',version:LAYOUT_VERSION,name:'Large + two small',footprint:'L',depth:s.depth,
    rows:[makeRow('L',s.height),makeRow('SS',1,'grid')],colors:{...s.colors},printer:{...s.printer},
    filament:sanitizeFilament(s.filament),usage:{},printed:{}};
}
export function fromSingleBuild(raw){
  const s=sanitizeState(raw),plan=exampleLayout(s);plan.name='Imported '+s.family+s.depth+' stack';plan.footprint=s.family;
  plan.rows=s.layers.map((r,i)=>({...makeRow(s.family,s.height,i===s.layers.length-1?s.roof:'none'),label:r.label,baseplate:s.baseplate,rails:s.rails}));
  return plan;
}
export function sanitizeLayout(raw){
  if(raw?.application==='VAULT Workbench'&&raw.configuration?.version===1)return fromSingleBuild(raw.configuration);
  if(raw?.version===1&&raw.layers)return fromSingleBuild(raw);
  raw=raw?.layout||raw;
  if(raw?.kind!=='vault-layout'||raw.version!==LAYOUT_VERSION||!LAYOUTS[raw.footprint]||![3,4,5,6,7].includes(raw.depth)||!Array.isArray(raw.rows)||!raw.rows.length||raw.rows.length>MAX_ROWS)throw new Error('Choose a supported S/M/L layout with 1–6 levels and depth 3–7.');
  const base=sanitizeState({...structuredClone(DEFAULT_STATE),colors:raw.colors,printer:raw.printer,filament:raw.filament});
  const ids=new Set(),rows=raw.rows.map((r,i)=>{
    if(!r||!LAYOUTS[raw.footprint].includes(r.layout)||![1,2,4].includes(r.height)||!['none','grid','table'].includes(r.roof))throw new Error('Every level must match the footprint and use height 1F, 2F or 4F.');
    const id=typeof r.id==='string'&&/^[\w-]{1,50}$/.test(r.id)?r.id:'row-'+i;
    if(ids.has(id))throw new Error('Duplicate level IDs in this layout.');ids.add(id);
    return {id,layout:r.layout,height:r.height,roof:r.roof,label:String(r.label||'').slice(0,60),baseplate:r.baseplate===true,rails:r.rails===true};
  });
  const numericMap=(value,integer=false)=>Object.fromEntries(Object.entries(value&&typeof value==='object'?value:{}).filter(([id,n])=>/^[a-f0-9]{16}$/.test(id)&&typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=(integer?1000:100000)&&(!integer||Number.isInteger(n))));
  return {kind:'vault-layout',version:LAYOUT_VERSION,name:String(raw.name||'My layout').slice(0,80),footprint:raw.footprint,depth:raw.depth,rows,
    colors:base.colors,printer:base.printer,filament:base.filament,usage:numericMap(raw.usage),printed:numericMap(raw.printed,true)};
}
export function rowState(plan,row){return {...structuredClone(DEFAULT_STATE),family:row.layout==='SS'?'S':row.layout,depth:plan.depth,height:row.height,
  layers:[{label:row.label}],roof:row.roof,baseplate:row.baseplate,rails:row.rails,colors:plan.colors,printer:plan.printer,filament:plan.filament}}
export function layoutInstances(plan,{exploded=false}={}){
  let bottom=0;const instances=[];
  plan.rows.forEach((row,level)=>{
    const state=rowState(plan,row),width=DRAWER_WIDTHS[state.family],copies=row.layout==='SS'?2:1;
    for(let column=0;column<copies;column++)instances.push({id:row.id+'-'+column,rowId:row.id,level,column,state,
      position:[copies===2?(column===0?-width/2:width/2):0,bottom,0],width,height:row.height*48});
    bottom+=row.height*48+(exploded?90:0);
  });return instances;
}
export function instancePlacement(instance,options={}){
  return assemblyLayout({...instance.state,normalizedAssets:true},options).map(r=>({...r,rowId:instance.rowId,instanceId:instance.id,
    position:r.position.map((v,i)=>v+instance.position[i])}));
}
export function describeLayout(plan){return {width:DRAWER_WIDTHS[plan.footprint],nominalDepth:146+(plan.depth-3)*42,
  stackPitch:plan.rows.reduce((n,r)=>n+48*r.height,0),modules:plan.rows.reduce((n,r)=>n+(r.layout==='SS'?2:1),0),
  mixed:plan.rows.some(r=>r.layout!==plan.rows[0].layout),heightUnits:plan.rows.reduce((n,r)=>n+r.height,0)}}
export function buildLayoutPlan(plan,catalog,previews,status={available:{}}){
  const files=new Map(),issues=[],resolved=new Map();let bolts=0;
  for(const row of plan.rows){
    const state=rowState(plan,row),copies=row.layout==='SS'?2:1;bolts+=boltCount(state)*copies;
    try{
      const models=resolveDrawerModels(state,catalog,previews,{}, {useBundled:false});resolved.set(row.id,models);
      for(const part of billOfMaterials(state,models)){
        const model=models[part.key],slot=PART_SLOTS[part.key],previous=files.get(part.id),quantity=part.quantity*copies;
        if(previous){previous.quantity+=quantity;previous.levels.push(row.id);continue}
        const fit=model.printSize?fitRectangle(...model.printSize,plan.printer):null;
        files.set(part.id,{...part,quantity,levels:[row.id],printSize:model.printSize,previewAvailable:!!model.url,reasonCode:model.reasonCode,
          originalAvailable:!!status.available?.[part.id],filamentSlot:slot,color:plan.colors[slot],filament:plan.filament.spools[slot].name,
          gramsPerFile:plan.usage[part.id]??null,fit});
      }
      const missing=requiredPreviewKeys(state).filter(k=>!models[k].url);
      if(missing.length)issues.push({rowId:row.id,type:'preview',message:`${row.layout==='SS'?'S + S':row.layout}${plan.depth}: ${missing.map(k=>models[k].name).join(', ')} need previews.`});
    }catch(e){issues.push({rowId:row.id,type:'catalog',message:e.message})}
  }
  const parts=[...files.values()],catalogComplete=resolved.size===plan.rows.length;
  const complete=catalogComplete&&parts.length>0&&parts.every(p=>p.gramsPerFile!==null);
  const knownGrams=parts.reduce((n,p)=>n+(p.gramsPerFile??0)*p.quantity,0),allowance=plan.filament.allowancePercent;
  const knownCost=parts.reduce((n,p)=>n+(p.gramsPerFile??0)*p.quantity*plan.filament.spools[p.filamentSlot].pricePerKg/1000,0);
  const description=describeLayout(plan);
  if(description.mixed)issues.push({type:'interface',message:'Nominal widths match. Mixed-size stacking interfaces, roofs and connectors still need verification against your original parts and manuals.'});
  const missingOriginals=parts.filter(p=>!p.originalAvailable);
  const totalSourceBytes=parts.reduce((n,p)=>n+(p.bytes||0),0);
  return {parts,issues,resolved,catalogComplete,description,bolts,missingOriginals,totalSourceBytes,
    canPackage:catalogComplete&&parts.length>0&&!missingOriginals.length&&parts.length<=50&&totalSourceBytes<=600*1024*1024,
    filament:{complete,knownGrams,totalGrams:complete?knownGrams:null,plannedGrams:complete?knownGrams*(1+allowance/100):null,
      totalCost:complete?knownCost*(1+allowance/100):null,currency:plan.filament.currency,allowancePercent:allowance},
    printedFiles:parts.reduce((n,p)=>n+Math.min(p.quantity,plan.printed[p.id]||0),0),totalCopies:parts.reduce((n,p)=>n+p.quantity,0)};
}
export function layoutManifest(plan,result){
  if(!result.catalogComplete)throw new Error('Required files are missing from the catalog. Fix the listed issues before exporting a parts plan.');
  return {application:'VAULT Workbench',applicationVersion:'0.5.0-dev',createdAt:new Date().toISOString(),layout:sanitizeLayout(plan),
    files:result.parts.map(({id,name,path,quantity,color,filamentSlot,filament,gramsPerFile})=>({id,name,path,quantity,color,filamentSlot,filament,gramsPerFile})),
    hardware:[{name:'M4 × 14 mm bolts',quantity:result.bolts,source:'Drawer manual page 18; 4 per 1F facade, 6 per 2F/4F facade.'}],
    filament:result.filament,notes:['Layout positions are illustrative. Matching nominal widths does not certify mechanical stacking compatibility.',
      'Only the roofs, inserts and rails explicitly selected per level are included. Verify transitions and mounting hardware in your original manuals.',
      'Each quantity counts complete STL files, including paired pieces. Print originals, not simplified preview meshes.',
      'Envelope figures are nominal layout dimensions. Printer fit is checked separately against each original STL bounding rectangle.',
      'Filament totals require slicer-reported grams per complete STL. No print time or purge simulation is performed.']};
}
