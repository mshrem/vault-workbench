import {DEFAULT_STATE,sanitizeState} from './core.js';
import {LAYOUTS,MAX_ROWS,NEUTRAL_COLORS,makeRow,exampleLayout,fromSingleBuild,sanitizeLayout,buildLayoutPlan,layoutManifest,describeLayout} from './layout.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decimal=n=>Number(n).toLocaleString(undefined,{maximumFractionDigits:1});
export function createLayoutUI({document,fetch,storage,viewer,download}){
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const read=(key,fallback)=>{try{return JSON.parse(storage.getItem(key))??fallback}catch{return fallback}};
  function current(){try{return sanitizeState(read('vault-current-v1',DEFAULT_STATE))}catch{return structuredClone(DEFAULT_STATE)}}
  let plan;try{const saved=read('vault-layout-v1',null);plan=saved?sanitizeLayout(saved):fromSingleBuild(current())}catch{plan=exampleLayout(current())}
  try{const pending=read('vault-builder-open-v1',null);if(pending){plan=sanitizeLayout(pending);storage.setItem('vault-layout-v1',JSON.stringify(plan));storage.removeItem('vault-builder-open-v1')}}catch{}
  let selected=plan.rows.at(-1).id,catalog=[],previews={},status={connected:false,available:{}},connectionError='',result,history=[],renderToken=0,toastTimer,disposed=false;
  function toast(text){if(disposed)return;$('#layout-toast').textContent=text;$('#layout-toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{if(!disposed)$('#layout-toast').hidden=true},6000)}
  function persist(){try{storage.setItem('vault-layout-v1',JSON.stringify(plan))}catch{toast('Browser storage is unavailable. Save your plan file to keep a copy.')}}
  function commit(change){history.push(structuredClone(plan));if(history.length>40)history.shift();change(plan);plan=sanitizeLayout(plan);if(!plan.rows.some(r=>r.id===selected))selected=plan.rows.at(-1).id;persist();render()}
  function select(id){if(!plan.rows.some(r=>r.id===id))return;selected=id;renderLevels();renderSchematic();viewer.select(id)}
  function compute(){result=buildLayoutPlan(plan,catalog,previews,status)}
  function renderLevels(){
    $('#layout-levels').innerHTML='';
    [...plan.rows].reverse().forEach((row,reverse)=>{
      const i=plan.rows.length-1-reverse,card=document.createElement('section');card.className='layout-level'+(row.id===selected?' selected':'');
      card.innerHTML=`<button class="layout-level-heading" data-select><span>${String(i+1).padStart(2,'0')}</span><strong>${row.layout==='SS'?'S'+plan.depth+' + S'+plan.depth:row.layout+plan.depth} · ${row.height}F</strong><small>${i===plan.rows.length-1?'TOP':i===0?'BOTTOM':'LEVEL'}</small></button>`;
      card.querySelector('[data-select]').onclick=()=>select(row.id);
      if(row.id===selected){
        const details=document.createElement('div');details.className='layout-level-details';details.innerHTML=`<label>Level layout<select data-field="layout" aria-label="Level ${i+1} layout">${LAYOUTS[plan.footprint].map(v=>`<option value="${v}" ${v===row.layout?'selected':''}>${v==='SS'?'Two S modules side by side':v+' · one full-width module'}</option>`).join('')}</select></label><label>Height<select data-field="height" aria-label="Level ${i+1} height">${[1,2,4].map(n=>`<option value="${n}" ${n===row.height?'selected':''}>${n}F · ${48*n} mm stack pitch</option>`).join('')}</select></label><label>Outside · top of each module<select data-field="roof" aria-label="Level ${i+1} roof">${[['none','No separate roof'],['grid','Gridfinity roof · on top'],['table','Flat table roof']].map(([v,t])=>`<option value="${v}" ${v===row.roof?'selected':''}>${t}</option>`).join('')}</select></label><p class="field-help">The Gridfinity roof is the visible grid on top. Choose Flat table roof for a plain top.</p><label>Level name<input data-field="label" maxlength="60" value="${esc(row.label)}" aria-label="Level ${i+1} name"></label><label><input data-field="baseplate" type="checkbox" ${row.baseplate?'checked':''}>Gridfinity baseplate · inside drawer</label><p class="field-help">Optional floor insert for Gridfinity bins. It is separate from the top roof. Bins are not added to this plan.</p><button class="text-button" data-show-interior>Open drawers to see inside</button><label><input data-field="rails" type="checkbox" ${row.rails?'checked':''}>Geared rails</label><div class="layout-level-actions"><button data-action="up" ${i===plan.rows.length-1?'disabled':''}>Move up</button><button data-action="down" ${i===0?'disabled':''}>Move down</button><button data-action="duplicate" ${plan.rows.length===MAX_ROWS?'disabled':''}>Duplicate</button><button data-action="remove" ${plan.rows.length===1?'disabled':''}>Remove</button></div>`;
        details.querySelectorAll('[data-field]').forEach(el=>el.onchange=()=>commit(()=>{const field=el.dataset.field;row[field]=el.type==='checkbox'?el.checked:field==='height'?Number(el.value):el.value}));
        details.querySelector('[data-show-interior]').onclick=()=>{$('#layout-open').value=100;$('#layout-open-percent').textContent='100%';viewer.motion({open:1})};
        details.querySelectorAll('[data-action]').forEach(button=>button.onclick=()=>commit(p=>{
          const action=button.dataset.action;
          if(action==='up'&&i<p.rows.length-1)[p.rows[i],p.rows[i+1]]=[p.rows[i+1],p.rows[i]];
          if(action==='down'&&i>0)[p.rows[i],p.rows[i-1]]=[p.rows[i-1],p.rows[i]];
          if(action==='duplicate'&&p.rows.length<MAX_ROWS){const copy={...row,id:makeRow().id};p.rows.splice(i+1,0,copy);selected=copy.id}
          if(action==='remove'&&p.rows.length>1)p.rows.splice(i,1);
        }));card.append(details);
      }$('#layout-levels').append(card);
    });$('#layout-add').disabled=plan.rows.length>=MAX_ROWS;$('#layout-undo').disabled=!history.length;
  }
  function renderSchematic(){
    $('#layout-schematic').innerHTML=[...plan.rows].reverse().map(r=>`<div class="layout-schematic-row ${selected===r.id?'selected':''}" style="grid-template-columns:repeat(${r.layout==='SS'?2:1},1fr);aspect-ratio:${describeLayout(plan).width}/${48*r.height}">${Array.from({length:r.layout==='SS'?2:1},()=>`<button data-row-id="${r.id}" >${r.layout==='SS'?'S':r.layout}${plan.depth} · ${r.height}F</button>`).join('')}</div>`).join('');
    $$('#layout-schematic [data-row-id]').forEach(b=>b.onclick=()=>select(b.dataset.rowId));
  }
  function renderTotals(){
    const r=result,d=r.description;
    $('#layout-summary').innerHTML=`<div><strong>${d.modules}</strong><small>drawer modules</small></div><div><strong>${r.parts.length}</strong><small>unique STL files</small></div><div><strong>${r.bolts}</strong><small>M4 × 14 mm bolts</small></div>`;
    $('#layout-checklist-summary').textContent=`${r.printedFiles} / ${r.totalCopies} complete STL copies marked printed`;
    $('#layout-metrics').innerHTML=`<div><strong>${decimal(d.width)} × ${decimal(d.nominalDepth)} mm</strong><small>NOMINAL FOOTPRINT</small></div><div><strong>${d.stackPitch} mm · ${d.heightUnits}F</strong><small>NOMINAL STACK PITCH · EXCLUDES FIT DETAILS</small></div><div><strong>${r.filament.complete?decimal(r.filament.plannedGrams)+' g':'Weights needed'}</strong><small>SLICER FILAMENT + ${r.filament.allowancePercent}% ALLOWANCE</small></div>`;
    $('#layout-filament-summary').textContent=!r.catalogComplete?'Incomplete: required catalog files are missing.':r.filament.complete?`${decimal(r.filament.totalGrams)} g sliced · ${decimal(r.filament.plannedGrams)} g with allowance · ${new Intl.NumberFormat(undefined,{style:'currency',currency:r.filament.currency}).format(r.filament.totalCost)}`:`Incomplete: ${r.parts.filter(p=>p.gramsPerFile===null).length} STL weights missing. ${decimal(r.filament.knownGrams)} g currently accounted for.`;
    for(const part of r.parts){const total=$('[data-total-id="'+part.id+'"]');if(total)total.textContent=part.gramsPerFile===null?'Not entered':decimal(part.gramsPerFile*part.quantity)+' g total'}
  }
  function renderParts(){
    $('#layout-parts').innerHTML='';
    for(const part of result.parts){
      const el=document.createElement('div');el.className='layout-part';const printed=Math.min(part.quantity,plan.printed[part.id]||0);
      el.innerHTML=`<input type="checkbox" aria-label="Mark all ${esc(part.name)} printed" ${printed>=part.quantity?'checked':''}><div><strong>${part.quantity}× ${esc(part.title||part.name)}</strong><small>${esc(part.path)}</small><small>${part.previewAvailable?'Cached preview ready':'Preview missing · original can still be printed'}</small>${part.originalAvailable?`<a href="api/original/${part.id}">Download original STL ↓</a>`:'<small>Original not connected</small>'}<label class="layout-part-progress">Printed copies<input type="number" min="0" max="${part.quantity}" value="${printed}" aria-label="Printed copies of ${esc(part.name)}"></label></div>`;
      const check=el.querySelector('[type=checkbox]'),number=el.querySelector('[type=number]');
      check.onchange=()=>{plan.printed[part.id]=check.checked?part.quantity:0;number.value=plan.printed[part.id];persist();compute();renderTotals()};
      number.oninput=()=>{const n=Number(number.value);if(number.value===''||!Number.isInteger(n)||n<0||n>part.quantity)return;plan.printed[part.id]=n;check.checked=n===part.quantity;persist();compute();renderTotals()};$('#layout-parts').append(el);
    }
  }
  function renderFilament(){
    $('#layout-allowance').value=plan.filament.allowancePercent;$('#layout-filament-inputs').innerHTML='';
    for(const part of result.parts){
      const el=document.createElement('div');el.className='layout-filament-row';el.innerHTML=`<label>${esc(part.name)}<small>×${part.quantity} · ${esc(part.filament)}</small><small data-total-id="${part.id}"></small></label><input type="number" min="0" max="100000" step="0.01" aria-label="Grams per ${esc(part.name)}" placeholder="g / STL" value="${part.gramsPerFile??''}">`;
      const input=el.querySelector('input');input.oninput=()=>{const n=Number(input.value);if(input.value==='')delete plan.usage[part.id];else{if(!Number.isFinite(n)||n<0||n>100000)return;plan.usage[part.id]=n}persist();compute();renderTotals()};$('#layout-filament-inputs').append(el);
    }
  }
  function renderChecks(){
    const p=plan.printer;$('#layout-printer-detail').textContent=`${p.name} · ${p.x} × ${p.y} × ${p.z} mm · ${p.clearance} mm clearance / side`;
    $('#layout-checks').innerHTML=result.parts.map(part=>`<div class="layout-check"><strong>${esc(part.name)}</strong><small>${part.printSize?.map(decimal).join(' × ')||'Dimensions not imported'} mm</small><span class="${part.fit?.fits?'':'not-fit'}">${!part.fit?'Fit not measured':part.fit.fits?`Bounding rectangle fits · ${decimal(part.fit.angle)}°`:'Exceeds entered bed or Z volume'}</span></div>`).join('');
  }
  function renderWarnings(){
    const catalogIssues=result.issues.filter(i=>i.type==='catalog'),previewIssues=result.issues.filter(i=>i.type==='preview'),interfaces=result.issues.filter(i=>i.type==='interface');
    $('#layout-warnings').innerHTML=(connectionError?`<p>${esc(connectionError)}</p>`:'')+interfaces.map(i=>`<p>${esc(i.message)} Only selected roofs are counted.</p>`).join('')+(catalogIssues.length?`<p>${catalogIssues.length} levels have missing catalog files. Exports are unavailable until resolved.</p>`:'')+((previewIssues.length||catalogIssues.length)?`<details><summary>View missing geometry / files</summary>${[...catalogIssues,...previewIssues].map(i=>`<p>${esc(i.message)}</p>`).join('')}</details>`:'');
    $('#layout-package').disabled=!result.canPackage;
    $('#layout-package-note').textContent=!result.catalogComplete?'Resolve the missing catalog files before exporting.':result.missingOriginals.length?'Connect the original library to package STLs.':result.parts.length>50?'This layout exceeds the 50 unique file package limit. Download originals individually or split the design.':result.totalSourceBytes>600*1024*1024?'This layout exceeds the 600 MB package limit. Download individual originals or split the design.':'Downloads unchanged originals with quantities and your layout plan. Check stacking interfaces in the original manuals.';
    $('#layout-save').disabled=!result.catalogComplete;$('#layout-export-csv').disabled=!result.catalogComplete;
  }
  async function updateViewer(){
    const token=++renderToken;$('#layout-preview-status').textContent='Loading cached previews…';
    try{const info=await viewer.update(plan,result,selected);if(disposed||token!==renderToken||!info)return;
      $('#layout-schematic').hidden=info.webgl!==false;$('#layout-viewer').hidden=info.webgl===false;
      $('#layout-open').disabled=info.webgl===false;$('#layout-explode').disabled=info.webgl===false;$('#layout-reset-view').disabled=info.webgl===false;
      if(info.webgl===false)$$('[data-layout-view]').forEach(b=>{b.disabled=b.dataset.layoutView!=='front';b.classList.toggle('active',b.dataset.layoutView==='front')});
      $('#layout-preview-status').textContent=info.webgl===false?'3D unavailable in this browser. Showing a nominal front layout drawing.':info.schematic?`${result.description.modules-info.schematic} modules with original previews · ${info.schematic} wireframe placeholders. See missing geometry below.`:'All modules use cached original geometry · click a module to select its level.';
      if(info.errors?.length){toast('Some previews could not load. Their modules are shown as wireframes.');fetch('api/diagnostics/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'assembly_load_failed',errorType:info.errors[0].errorType})}).catch(()=>{})}
    }catch(e){if(disposed||token!==renderToken)return;$('#layout-viewer').hidden=true;$('#layout-schematic').hidden=false;$('#layout-preview-status').textContent='Preview could not load. Showing the nominal front layout drawing.'}
  }
  function render(){
    compute();$('#layout-name').value=plan.name;$('#layout-headline').textContent=plan.name;$('#layout-footprint').value=plan.footprint;$('#layout-depth').value=plan.depth;
    for(const slot of Object.keys(plan.colors))$('#layout-color-'+slot).value=plan.colors[slot];
    renderLevels();renderSchematic();renderParts();renderFilament();renderChecks();renderWarnings();renderTotals();updateViewer();
  }
  async function refresh(){
    $('#layout-refresh').disabled=true;
    try{
      const readJSON=async path=>{const r=await fetch(path);if(!r.ok)throw new Error('Local library request failed.');return r.json()};
      [catalog,previews,status]=await Promise.all(['api/catalog','api/previews','api/status'].map(readJSON));
      if(!Array.isArray(catalog)||!previews||typeof previews!=='object'||!status||typeof status!=='object')throw new Error('Unexpected library response.');
      connectionError=status.connected?'':'Original library is not connected. You can plan a layout; connect files in Workbench to generate previews and download STLs.';
    }catch(e){connectionError='Cannot reach the local app server. Open this page through your running Docker/Windows app, then refresh the library.'}
    finally{$('#layout-refresh').disabled=false;render()}
  }
  $('#layout-name').oninput=e=>{plan.name=e.target.value.slice(0,80);$('#layout-headline').textContent=plan.name;persist()};
  $('#layout-footprint').onchange=e=>commit(p=>{p.footprint=e.target.value;for(const r of p.rows)if(!LAYOUTS[p.footprint].includes(r.layout))r.layout=p.footprint});
  $('#layout-depth').onchange=e=>commit(p=>{p.depth=Number(e.target.value)});
  $('#layout-add').onclick=()=>{if(plan.rows.length>=MAX_ROWS)return;commit(p=>{const row=makeRow(p.footprint,1,'none');p.rows.push(row);selected=row.id})};
  $('#layout-undo').onclick=()=>{if(!history.length)return;plan=history.pop();selected=plan.rows.at(-1).id;persist();render()};
  $('#layout-single').onclick=()=>commit(()=>{const p=plan;plan=fromSingleBuild({...current(),family:p.footprint,depth:p.depth,height:1,layers:[{label:''}],roof:'table',baseplate:false,rails:false,colors:p.colors,printer:p.printer,filament:p.filament});plan.name='My plain drawer';selected=plan.rows[0].id});
  $('#layout-project-save').onclick=()=>{try{const projects=read('vault-projects-v1',[]);if(!Array.isArray(projects))throw new Error('Saved projects could not be read. Save a plan file instead.');projects.unshift({name:plan.name,savedAt:new Date().toISOString(),state:structuredClone(plan)});storage.setItem('vault-projects-v1',JSON.stringify(projects));toast('Project saved. Open My projects to return to it.')}catch(e){toast(e.message)}};
  $('#layout-example').onclick=()=>commit(()=>{plan=exampleLayout(current());selected=plan.rows.at(-1).id});
  $('#layout-current').onclick=()=>commit(()=>{plan=fromSingleBuild(current());selected=plan.rows.at(-1).id});
  for(const slot of Object.keys(plan.colors))$('#layout-color-'+slot).oninput=e=>{plan.colors[slot]=e.target.value;persist();compute();viewer.update(plan,result,selected)};
  $('#layout-neutral').onclick=()=>commit(p=>{p.colors={...NEUTRAL_COLORS}});
  $('#layout-refresh').onclick=refresh;
  $('#layout-use-printer').onclick=()=>commit(p=>{const s=current();p.printer=s.printer;p.filament=s.filament});
  $('#layout-refresh-printer').onclick=$('#layout-use-printer').onclick;
  $('#layout-allowance').oninput=e=>{const n=Number(e.target.value);if(e.target.value===''||!Number.isFinite(n)||n<0||n>100)return;plan.filament.allowancePercent=n;persist();compute();renderTotals()};
  $$('#layout-tab-parts,#layout-tab-filament,#layout-tab-checks').forEach(p=>p.hidden=p.id!=='layout-tab-parts');
  $$('[data-layout-tab]').forEach(b=>b.onclick=()=>{
    $$('[data-layout-tab]').forEach(t=>{t.classList.toggle('active',t===b);t.setAttribute('aria-selected',String(t===b))});
    for(const name of ['parts','filament','checks'])$('#layout-tab-'+name).hidden=name!==b.dataset.layoutTab;
  });
  $$('[data-layout-view]').forEach(b=>b.onclick=()=>{viewer.setView(b.dataset.layoutView);$$('[data-layout-view]').forEach(t=>t.classList.toggle('active',t===b))});
  $('#layout-reset-view').onclick=()=>viewer.fit();$('#layout-explode').onclick=e=>{const pressed=e.currentTarget.getAttribute('aria-pressed')!=='true';e.currentTarget.setAttribute('aria-pressed',String(pressed));viewer.motion({exploded:pressed})};
  $('#layout-open').oninput=e=>{$('#layout-open-percent').textContent=e.target.value+'%';viewer.motion({open:Number(e.target.value)/100})};
  $('#layout-save').onclick=()=>{try{download('VAULT-layout-plan.json',JSON.stringify(layoutManifest(plan,result),null,2),'application/json');toast('Layout plan saved. It includes all levels and combined quantities.')}catch(e){toast(e.message)}};
  $('#layout-load').onclick=()=>$('#layout-load-file').click();
  $('#layout-load-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>250000)throw new Error('Layout plan exceeds 250 KB.');const parsed=sanitizeLayout(JSON.parse(await file.text()));commit(()=>{plan=parsed;selected=plan.rows.at(-1).id});toast('Layout loaded.')}catch(error){toast(error.message)}finally{e.target.value=''}};
  $('#layout-export-csv').onclick=()=>{
    const manifest=layoutManifest(plan,result),rows=[['File','Copies of complete STL','Printed copies','Filament','Color HEX','Grams per complete STL','Total grams'],...manifest.files.map(p=>[p.path,p.quantity,Math.min(p.quantity,plan.printed[p.id]||0),p.filament,p.color,p.gramsPerFile??'',p.gramsPerFile===null?'':p.gramsPerFile*p.quantity]),['M4 x 14 mm bolts',result.bolts,'','','','','']];
    download('VAULT-layout-parts.csv','\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n'),'text/csv;charset=utf-8');
  };
  $('#layout-package').onclick=async()=>{
    if(!result.canPackage)return;const button=$('#layout-package');button.disabled=true;button.textContent='Packaging originals…';
    try{const manifest=layoutManifest(plan,result),r=await fetch('api/package',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(manifest)});if(!r.ok){const error=await r.json();throw new Error(error.error||'Could not create the package.')}download('VAULT-layout-originals.zip',await r.blob(),'application/zip');toast('Original STL package downloaded. Check the plan quantities and stacking interfaces before printing.')}catch(e){toast(e.message)}finally{button.textContent='Package original STLs ↓';button.disabled=!result.canPackage}
  };
  const initialTab=document.defaultView?.location.hash.slice(1);if(['parts','filament','checks'].includes(initialTab))$('[data-layout-tab="'+initialTab+'"]').click();
  persist();render();const ready=refresh();return {ready,select,refresh,getPlan:()=>structuredClone(plan),getResult:()=>result,destroy(){disposed=true;renderToken++;clearTimeout(toastTimer)}};
}
