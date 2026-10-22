export const DRAWER_WIDTHS={S:164.8,M:254,L:329.6};
export const familyCode=s=>(s.family||'M')+(s.depth||3);
export const drawerHeight=s=>s.height||4;
export const boltCount=s=>drawerHeight(s)===1?4:6;
export const legacyAssembly=s=>familyCode(s)==='M3'&&drawerHeight(s)===4&&s.roof!=='table';

// Resolve exact whole-file identities. A sustainer or split L² chassis must never
// silently stand in for the drawer selected in the configurator.
export function resolveDrawerModels(state,catalog,previews,bundled,{useBundled=true}={}){
  const code=familyCode(state),f=drawerHeight(state),depth=state.depth||3,family=state.family||'M';
  const names={module:`${code} Module ${f}F.stl`,box:`${code} Box ${f}F.stl`,
    facade:`${family}${f}F (Turn On Supports).stl`,roof:`${code} ${state.roof==='table'?'Table':'Grid'} Roof.stl`,
    baseplate:`${code} Baseplate.stl`,key:'Key (Turn On Supports).stl','key-cap':'Key Cap.stl',
    'facade-cap':'Facade Cap.stl',springs:'Springs.stl',latch:'Latch.stl',label:'Label.stl',
    stopper:'Runner Stopper.stl',guides:`x${depth} Runner Guides.stl`,slides:`x${depth} Runner Slides.stl`,rails:`${family} Rails.stl`};
  const models={};
  for(const [key,name] of Object.entries(names)){
    const item=catalog.find(i=>i.category==='Drawers'&&i.name.toLowerCase()===name.toLowerCase());
    if(!item)throw new Error('Required drawer file is missing from the catalog: '+name);
    const sample=Object.values(bundled).find(m=>m.catalogId===item.id),cached=previews[item.id];
    models[key]={...sample,...cached,catalogId:item.id,name:item.name,path:item.path,bytes:item.bytes,
      url:cached?.previewAvailable?'api/preview/'+item.id+(cached.previewRevision?'?v='+encodeURIComponent(cached.previewRevision):''):(useBundled?sample?.url:null)||null,
      printSize:cached?.printSize||(useBundled?sample?.printSize:null)||null,
      title:key==='module'?`${code} / ${f}F module`:key==='box'?`${code} / ${f}F drawer box`:
        key==='facade'?`${family} / ${f}F facade`:key==='roof'?`${code} ${state.roof==='table'?'table':'grid'} roof`:
        key==='baseplate'?`${code} Gridfinity baseplate`:key==='guides'?`x${depth} runner guides · paired STL`:
        key==='slides'?`x${depth} runner slides · paired STL`:key==='rails'?`${family} geared rails · paired STL`:null};
  }
  return models;
}

export function requiredPreviewKeys(state){
  return ['module','box','facade','guides','slides','key','key-cap','facade-cap','latch','label','stopper','springs',...(state.roof==='none'?[]:['roof']),
    ...(state.baseplate?['baseplate']:[]),...(state.rails?['rails']:[])];
}

export function missingGeometry(state,models){
  return requiredPreviewKeys(state).filter(key=>!models[key]?.url).map(key=>models[key]?.name||key);
}
