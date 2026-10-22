import * as THREE from 'three';
import {OrbitControls} from './vendor/controls/OrbitControls.js';
import {GLTFLoader} from './vendor/loaders/GLTFLoader.js';
import {STLLoader} from './vendor/loaders/STLLoader.js';
import {ensureSurfaceNormals,prepareDisplayGeometry,STUDIO_MATERIAL} from './rendering.js';
import {assemblyLayout,fitCameraToBox} from './assembly.js';
import {DEFAULT_STATE,PRESETS,TITLES,sanitizeState,billOfMaterials,checkFit,makeManifest,prettyBytes} from './core.js';
import {createManufacturingUI} from './manufacturing-ui.js';
import {PART_SLOTS} from './manufacturing.js';
import {DRAWER_WIDTHS,familyCode,drawerHeight,boltCount,legacyAssembly,resolveDrawerModels,requiredPreviewKeys,missingGeometry} from './families.js';
import {orientPart,splitPair} from './assembly-geometry.js';
import {sanitizeLayout,buildLayoutPlan,layoutManifest} from './layout.js';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,6500)}
function readSaved(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
function saveLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{toast('Browser storage is unavailable. Export your build plan to keep a copy.')}}
let state;
try{state=sanitizeState(readSaved('vault-current-v1',DEFAULT_STATE))}catch{state=structuredClone(DEFAULT_STATE)}
let projects=readSaved('vault-projects-v1',[]);if(!Array.isArray(projects))projects=[];
let bundledModels={},modelSignature='',buildRequest=0;
const sourceCache=new Map();
let models={},catalog=[],status={available:{},matched:0,connected:false};
let importedPreviews={},importerStatus={},importTimer,importRefreshBusy=false,externalInspection=null,inspectionRequest=0;
let scene,camera,renderer,controls,groundGrid,assembly,inspector,inspectItem=null;
let exploded=false,openFraction=0,pageNumber=0,webglReady=false,assetsReady=false;
const assets=new Map(),loader=new GLTFLoader();
let projection='isometric',displayMode='studio';
const edgeCache=new WeakMap();
let renderPending=false;
const diagnosticTimes=new Map();
function recordDiagnostic(event,details={}){
  const payload={event,family:state?.family,height:state?.height,depth:state?.depth,...details};
  const signature=JSON.stringify(payload),now=Date.now();
  if(now-(diagnosticTimes.get(signature)||0)<30000||diagnosticTimes.size>=100)return;
  diagnosticTimes.set(signature,now);
  fetch('api/diagnostics/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});
}
window.addEventListener('error',e=>recordDiagnostic('javascript_error',{errorType:e.error?.name||'Error'}));
window.addEventListener('unhandledrejection',e=>recordDiagnostic('promise_rejection',{errorType:e.reason?.name||'Error'}));
const reasonLabel=code=>({source_size_limit:'Dimensions only: source exceeds the selected size limit.',
  mesh_too_complex:'Dimensions only: mesh is still too complex after simplification.',
  conversion_failed:'Preview conversion failed. Download diagnostics for the error details.',
  missing_dependency:'Preview conversion needs a missing dependency.',worker_timeout:'Preview conversion timed out.',
  worker_exit:'Preview worker stopped unexpectedly.'}[code]||'');

function download(filename,data,type='application/json'){
  const blob=data instanceof Blob?data:new Blob([data],{type});const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
function switchPage(page){
  if(page==='configurator'){document.querySelector('#open-configurator').click();return}
  document.body.classList.toggle('part-inspection',page==='inspection');
  const surface=page==='inspection'?'configurator':page;
  $$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  $$('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+surface));
  const titles={inspection:['Inspect an original part.','Return to the configurator to edit your drawer system.'],home:['Welcome to your workbench.','Prepare your library once. Come back and make something.'],configurator:['Build your own system.','Choose your parts. Find your colors. Plan your next print.'],catalog:['Every part, in its place.','Browse your actual file inventory. Choose S, M or L drawers in the configurator using your imported previews.'],filament:['Your workshop filaments.','Edit spool names, prices and colors for your active configurator plan.'],projects:['Your workshop, in progress.','Save a configuration now. Come back to it when you’re ready.'],guides:['From parts to possibilities.','The original assembly manuals, right where you need them.'],settings:['Made to fit your workshop.','Check bed fit and connect your original files.']};
  $('#page-title').textContent=titles[page][0];$('#page-subtitle').textContent=titles[page][1];
  if(page==='home'){renderSetup();refreshImporter()}if(page==='catalog')renderCatalog();if(page==='projects')renderProjects();if(page==='inspection')resizeViewer();if(page==='settings')refreshImporter();
  if(page==='filament'||page==='settings')manufacturingUI.render();
}
$$('.nav').forEach(b=>b.onclick=()=>switchPage(b.dataset.page));
$('.brand').onclick=e=>{e.preventDefault();switchPage('home')};
function openSetupPage(page,anchor){
  switchPage(page);
  if(anchor)document.getElementById(anchor)?.scrollIntoView?.({behavior:'smooth',block:'start'});
}
$$('[data-setup-page]').forEach(button=>button.onclick=()=>openSetupPage(button.dataset.setupPage,button.dataset.setupAnchor));
$('#setup-support').onclick=()=>$('#download-support').click();
$('#setup-next').onclick=()=>{
  if(!readSaved('vault-printer-confirmed-v1',false))return openSetupPage('settings','printer-settings');
  if(!status.connected)return openSetupPage('settings','library-connection');
  if(!importerStatus.previews||['running','stopping'].includes(importerStatus.state))return openSetupPage('settings','library-import');
  openSetupPage('configurator');
};
function renderSetup(){
  const s=importerStatus,reasons=s.reasonCounts||{},running=['running','stopping'].includes(s.state);
  $('#setup-printer-status').textContent=`${state.printer.name} · ${state.printer.x} × ${state.printer.y} × ${state.printer.z} mm`;
  $('#setup-connection-status').textContent=status.connected?`${status.matched} accessible inventory files`:'Original folder not connected';
  $('#setup-library-status').textContent=status.connected?'Library connected · originals read-only':'Connect your original folder to begin importing.';
  $('#setup-cache-status').textContent=`${s.previews||0} previews cached`;
  $('#setup-preview-count').textContent=`${s.previews||0} previews ready`;
  $('#setup-progress').max=Math.max(1,s.total||0);$('#setup-progress').value=s.processed||0;
  $('#setup-progress').hidden=!s.total;
  $('#setup-import-status').textContent=running?`${s.processed||0} / ${s.total||0} · ${s.state}`:s.state==='complete'?'Last import finished. Existing previews will be reused.':s.state==='cancelled'?'Import stopped. Resume when you’re ready.':s.state==='error'?'Import needs attention. Open the importer for details.':'Generate previews to use your library in the configurator.';
  const attention=[];
  if(reasons.source_size_limit)attention.push(`${reasons.source_size_limit} over the selected size limit`);
  if(reasons.mesh_too_complex)attention.push(`${reasons.mesh_too_complex} too complex for previews`);
  if(s.failed)attention.push(`${s.failed} failed in the last run`);
  $('#setup-attention').textContent=attention.join(' · ');
  $('#setup-next').textContent=!readSaved('vault-printer-confirmed-v1',false)?'Choose my printer →':!status.connected?'Connect my library →':running?'View import progress →':!s.previews?'Generate previews →':'Continue my design →';
}
function bindTabs(selector,dataKey,panePrefix){
  $$(selector).forEach(b=>b.onclick=()=>{$$(selector).forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',String(x===b))});$$('.'+(panePrefix==='config'?'config-pane':'build-pane')).forEach(p=>p.classList.toggle('active',p.id===panePrefix+'-'+b.dataset[dataKey]))});
  $$(selector).forEach(b=>b.setAttribute('aria-selected',String(b.classList.contains('active'))));
}
bindTabs('[data-config-tab]','configTab','config');bindTabs('[data-build-tab]','buildTab','build');

function syncPlanSettings(fields){
  try{const saved=readSaved('vault-layout-v1',null);if(!saved)return;const plan=sanitizeLayout(saved);for(const field of fields)plan[field]=structuredClone(state[field]);saveLocal('vault-layout-v1',plan)}catch{}
}
function persist(){saveLocal('vault-current-v1',state);if($('#page-filament').classList.contains('active'))syncPlanSettings(['filament','colors'])}
const resolveBuildModels=s=>resolveDrawerModels(s,catalog,importedPreviews,bundledModels,{useBundled:!status.connected});
const selectionSignature=()=>JSON.stringify([state.family,state.depth,state.height,state.roof,state.baseplate,state.rails]);
function changed({rebuild=true}={}){persist();if(catalog.length&&selectionSignature()!==modelSignature){loadBuild();return}renderBuild();if(rebuild&&assetsReady&&webglReady)rebuildAssembly(false)}
function syncInputs(){
  $('#drawer-depth').value=state.depth;$('#drawer-height').value=state.height;
  $$('[data-family]').forEach(b=>{b.classList.toggle('selected',b.dataset.family===state.family);b.setAttribute('aria-pressed',String(b.dataset.family===state.family))});
  $('#roof').value=state.roof;$('#baseplate').checked=state.baseplate;$('#rails').checked=state.rails;$('#label-text').value=state.label;
  for(const k of Object.keys(state.colors))$('#color-'+k).value=state.colors[k];
  $('#printer-name').value=state.printer.name;for(const k of ['x','y','z'])$('#printer-'+k).value=state.printer[k];$('#clearance').value=state.printer.clearance;
  manufacturingUI.sync();
}
function renderLevels(){
  const el=$('#levels');el.innerHTML='';
  state.layers.forEach((layer,i)=>{
    const card=document.createElement('div');card.className='level-card';
    card.innerHTML=`<div class="level-title"><span class="index">${String(i+1).padStart(2,'0')}</span><strong>${familyCode(state)}</strong><small>${drawerHeight(state)}F drawer</small><button aria-label="Remove level ${i+1}" title="Remove level" ${state.layers.length===1?'disabled':''}>×</button></div><div class="level-label"><input aria-label="Level ${i+1} name" maxlength="24" value="${esc(layer.label)}"></div>`;
    card.querySelector('button').onclick=()=>{state.layers.splice(i,1);changed();resetCamera()};
    card.querySelector('input').oninput=e=>{state.layers[i].label=e.target.value;persist()};el.append(card);
  });
  $('#add-level').disabled=state.layers.length>=6;$('#level-badge').textContent=state.layers.length+' level'+(state.layers.length>1?'s':'');
}
$('#add-level').onclick=()=>{if(state.layers.length>=6)return;state.layers.push({label:'Drawer '+(state.layers.length+1)});changed();resetCamera()};
function selectConfiguration(change){
  const previous=models;change();
  const next=resolveBuildModels(state);
  for(const key of Object.keys(state.filament.usage))if(previous[key]?.catalogId!==next[key]?.catalogId)delete state.filament.usage[key];
  syncInputs();changed();
}
$$('[data-family]').forEach(b=>b.onclick=()=>selectConfiguration(()=>{state.family=b.dataset.family}));
$('#drawer-depth').onchange=e=>selectConfiguration(()=>{state.depth=Number(e.target.value)});
$('#drawer-height').onchange=e=>selectConfiguration(()=>{state.height=Number(e.target.value)});
$('#roof').onchange=e=>selectConfiguration(()=>{state.roof=e.target.value});
$('#plain-drawer').onclick=()=>{state.baseplate=false;syncInputs();changed();toast('Plain drawer selected. Gridfinity insert removed from the preview and print list.')};
$('#baseplate').onchange=e=>{state.baseplate=e.target.checked;changed()};
$('#rails').onchange=e=>{state.rails=e.target.checked;changed()};
$('#label-text').oninput=e=>{state.label=e.target.value;persist()};
for(const key of Object.keys(state.colors))$('#color-'+key).oninput=e=>{state.colors[key]=e.target.value;changed({rebuild:false});recolor()};
$$('[data-preset]').forEach(b=>b.onclick=()=>{state.colors={...PRESETS[b.dataset.preset]};syncInputs();changed({rebuild:false});recolor()});
$('#reset-build').onclick=()=>{const printer=state.printer;state={...structuredClone(DEFAULT_STATE),printer};openFraction=0;exploded=false;$('#drawer-open').value=0;$('#drawer-percent').textContent='0%';$('#toggle-explode').classList.remove('active');syncInputs();changed();backToAssembly();resetCamera()};
$('#open-filament').onclick=()=>switchPage('filament');

function renderBuild(){
  if(!models.module)return;
  syncFamilyButtons();renderLevels();const n=state.layers.length;
  $('#build-name').textContent=`${familyCode(state)} · ${n===1?drawerHeight(state)+'F drawer':n+' × '+drawerHeight(state)+'F drawers'}`;
  $('#model-title').innerHTML=`${familyCode(state)} <span>/</span> ${n===1?drawerHeight(state)+'F':n+' × '+drawerHeight(state)+'F'}`;
  $('#height-stat').textContent=(48*drawerHeight(state)-1)+' mm / facade';$('#family-stat').textContent=familyCode(state);$('#plan-family').textContent=familyCode(state)+' / '+drawerHeight(state)+'F';$('#family-description').textContent=state.family+' · '+state.depth+' units deep';$('#module-stat').textContent=n;
  const bom=billOfMaterials(state,models),fit=checkFit(state,models);
  $('#unique-count').textContent=bom.length;$('#copy-count').textContent=bom.reduce((n,p)=>n+p.quantity,0);$('#hardware-count').textContent=1;
  $('#fit-box').classList.toggle('warning',!fit.fits);$('.fit-icon').textContent=fit.fits?'✓':'!';
  $('#fit-title').textContent=fit.fits?'Fits the entered print volume':fit.parts.some(p=>p.unknown)?'Some STL dimensions are not imported':'Some parts exceed the volume';
  $('#fit-description').textContent=`${state.printer.name} · ${state.printer.x} × ${state.printer.y} × ${state.printer.z} mm`;
  $('#fit-box').title=fit.fits?'Source bounding rectangles fit; angled placement may be required. See Printer & files.':fit.failures.map(p=>p.name).join('\n');
  $('#fit-box').onclick=()=>switchPage('settings');
  $('#parts-list').innerHTML='';
  bom.forEach(p=>{
    const b=document.createElement('button');b.className='part-row';const size=models[p.key].printSize?.map(n=>n.toFixed(1)).join(' × ')||'Not measured';
    b.innerHTML=`<span class="part-icon">◇</span><span><strong>${esc(p.title)}</strong><small>${size} mm · ${prettyBytes(p.bytes)}</small></span><span class="qty">×${p.quantity}</span>`;
    b.onclick=()=>inspectModel(p.key);$('#parts-list').append(b);
  });
  $('#build-hardware').innerHTML=`<div class="hardware-row">M4 × 14 mm bolts<strong>×${boltCount(state)*n}</strong><small>${boltCount(state)} per ${drawerHeight(state)}F drawer facade · manual, page 18</small></div><p class="field-help">The general table on page 3 lists four bolts per floor. The specific note on page 18 lists six for 2F/4F facades; this build uses that note.</p><p class="field-help">Facade cap quantities are inferred from those fastener positions. Verify their use on the original facade before printing.</p><a class="text-button" href="https://www.ussadesign.com/pages/vault" target="_blank" rel="noopener">USSA VAULT resources ↗</a>`;
  const steps=[['Prepare the facade','Insert the key and key cap. Push the paired springs into their recesses, flat side up.'],['Build the drawer','Remove the built-in manual supports. Fit the optional geared rails, then slide the runners into the box.'],['Finish the front','Attach the facade with the M4 × 14 mm bolts. Fit the label and fastener caps.'],['Insert & retain','Install runner guides, slide the drawer into its module, then fit the stoppers and module latch.']];
  $('#build-assembly').innerHTML=steps.map(([title,body],i)=>`<div class="assembly-step"><span>${i+1}</span><div><strong>${esc(title)}</strong><p>${esc(body)}</p></div></div>`).join('')+'<p class="field-help">See all original views and orientation details in the manual.</p><a class="text-button" href="https://www.ussadesign.com/pages/vault" target="_blank" rel="noopener">USSA VAULT resources ↗</a>';
  const missing=bom.filter(p=>!status.available[p.id]).length;
  $('#originals-note').textContent=missing?`${missing} required original file${missing>1?'s':''} not connected. See Printer & files.`:'Original files connected. The ZIP includes unchanged STLs, quantities and your build plan.';
  manufacturingUI.render();
}

async function refreshStatus(){
  try{const r=await fetch('api/status');if(!r.ok)throw new Error();status=await r.json();
    $('#connection-detail').textContent=status.connected?`${status.matched} of ${status.total} inventory files are accessible. Originals are read-only.`:'Connect your purchased USSA VAULT folder, then import previews in Printer & files. This public app includes no USSA meshes or manuals.';
  }catch{status={available:{},matched:0,connected:false};$('#connection-detail').textContent='Cannot reach the local server. Launch the app using start-windows.cmd or Docker.'}
  renderBuild();renderCatalog();
  renderImporter();
}
$('#refresh-status').onclick=async()=>{await refreshStatus();toast('File availability refreshed. Restart the server to scan newly added folder names.')};

function renderImporter(){
  renderSetup();
  const s=importerStatus,running=['running','stopping'].includes(s.state),missing=s.missingDependencies?.length;
  $('#import-setup').hidden=!missing;
  $('#import-start').disabled=running||!status.connected||!s.state||!!missing;
  $('#import-cancel').disabled=s.state!=='running';
  $('#import-category').disabled=running;$('#import-limit').disabled=running;$('#import-workers').disabled=running;
  if(running){$('#import-category').value=s.category;$('#import-limit').value=s.maxMB;$('#import-workers').value=s.workers||1}
  $('#import-report').disabled=!s.indexed;
  $('#import-progress').max=Math.max(1,s.total||0);$('#import-progress').value=s.processed||0;
  $('#import-progress-label').textContent=s.total?`${s.processed} / ${s.total} files · ${s.state}`:'Ready to import';
  $('#import-message').textContent=missing?'Complete the one-time setup below, then restart the app.':!status.connected?'Connect your original folder before importing.':s.message||'Cannot reach the local importer.';
  $('#import-current').textContent=s.current?'Active: '+s.current:'';
  $('#import-counts').textContent=`${s.previews||0} cached previews · ${s.indexed||0} indexed files`+(s.total?` · This run: ${s.converted||0} new previews, ${s.reused||0} reused, ${s.dimensionsOnly||0} dimensions only, ${s.failed||0} failed`:'');
  const reasons=s.reasonCounts||{};
  $('#import-reasons').textContent=`Indexed outcomes: ${reasons.source_size_limit||0} over the source-size limit · ${reasons.mesh_too_complex||0} too complex after simplification. A larger source-size limit does not resolve the complexity limit.`;
  const duration=seconds=>seconds<60?Math.round(seconds)+'s':seconds<3600?Math.ceil(seconds/60)+' min':(seconds/3600).toFixed(1)+' hr';
  $('#import-timing').textContent=s.total?`${s.workers||1} worker${s.workers===1?'':'s'} · Elapsed ${duration(s.elapsedSeconds||0)}`+(s.etaSeconds!==null&&s.etaSeconds!==undefined?` · Rough time remaining ${duration(s.etaSeconds)} (varies by mesh complexity)`:''):'';
}
async function loadImportedPreviews(){
  const r=await fetch('api/previews');if(!r.ok)throw new Error('Cannot read imported previews.');importedPreviews=await r.json();renderCatalog();if(models.module)await loadBuild();
}
async function refreshImporter(){
  clearTimeout(importTimer);if(importRefreshBusy)return;
  importRefreshBusy=true;
  try{
    const r=await fetch('api/importer');if(!r.ok)throw new Error(r.status===404?'This server is an older version. Stop its console with Ctrl+C and launch start-windows.cmd from the updated folder.':'Importer request failed ('+r.status+'). Check the app console.');const previous=importerStatus;importerStatus=await r.json();
    if(previous.indexed!==importerStatus.indexed||previous.state!==importerStatus.state)await loadImportedPreviews();
  }catch(error){importerStatus.message=error.message==='Failed to fetch'?'Cannot reach the local importer. Keep the app console open.':error.message}
  finally{importRefreshBusy=false;renderImporter();importTimer=setTimeout(refreshImporter,['running','stopping'].includes(importerStatus.state)?1500:10000)}
}
async function importerAction(action,body={}){
  try{
    $('#import-start').disabled=true;
    const r=await fetch('api/importer/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await r.json();if(!r.ok)throw new Error(result.error);importerStatus=result;renderImporter();await refreshImporter();
  }catch(e){recordDiagnostic('import_action_failed',{errorType:e.name});toast(e.message);renderImporter()}
}
$('#import-start').onclick=()=>importerAction('start',{category:$('#import-category').value,maxMB:Number($('#import-limit').value),workers:Number($('#import-workers').value)});
$('#import-cancel').onclick=()=>importerAction('cancel');
$('#import-report').onclick=async()=>{
  try{const r=await fetch('api/importer/report');if(!r.ok)throw new Error('Cannot download the report.');download('VAULT-dimensions-report.json',JSON.stringify(await r.json(),null,2));toast('Report downloaded. It contains relative part names and measurements; no STL geometry.')}catch(e){toast(e.message)}
};
$('#download-support').onclick=async()=>{
  try{const r=await fetch('api/support');if(!r.ok)throw new Error('Cannot download diagnostics. Check that the app server was updated.');download('VAULT-support-bundle.zip',await r.blob(),'application/zip');toast('Diagnostics downloaded. Review the relative filenames and logs before sharing. Nothing was uploaded automatically.')}catch(e){toast(e.message)}
};

function initViewer(){
  try{
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    $('#viewer').append(renderer.domElement);scene=new THREE.Scene();
    camera=new THREE.OrthographicCamera(-300,300,300,-300,.1,12000);
    controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.minDistance=40;controls.maxDistance=6000;controls.maxPolarAngle=Math.PI*.49;controls.addEventListener('change',requestRender);
    scene.add(new THREE.HemisphereLight(0xffffff,0x929b90,1.6));
    scene.add(new THREE.AmbientLight(0xffffff,.25));
    const light=new THREE.DirectionalLight(0xfffdf6,2.2);light.position.set(-350,700,500);light.castShadow=true;light.shadow.mapSize.set(2048,2048);light.shadow.camera.left=-900;light.shadow.camera.right=900;light.shadow.camera.top=1100;light.shadow.camera.bottom=-900;light.shadow.camera.far=3000;light.shadow.bias=-.00015;light.shadow.normalBias=.35;scene.add(light);
    const fill=new THREE.DirectionalLight(0xf1f4ff,1);fill.position.set(400,200,300);scene.add(fill);
    const rim=new THREE.DirectionalLight(0xf4f7ff,.6);rim.position.set(350,450,-500);scene.add(rim);
    groundGrid=new THREE.GridHelper(2400,80,0x8995a5,0xb5beca);groundGrid.position.y=-5;groundGrid.material.transparent=true;groundGrid.material.opacity=.6;scene.add(groundGrid);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(4000,4000),new THREE.ShadowMaterial({opacity:.1}));floor.rotation.x=-Math.PI/2;floor.position.y=-4;floor.receiveShadow=true;scene.add(floor);
    assembly=new THREE.Group();inspector=new THREE.Group();inspector.visible=false;scene.add(assembly,inspector);
    new ResizeObserver(resizeViewer).observe($('#viewer'));webglReady=true;applyViewerTheme();resizeViewer();
  }catch(e){recordDiagnostic('webgl_unavailable',{errorType:e.name});webglReady=false;$('#loading-model').textContent='3D preview needs WebGL. Enable hardware acceleration in your browser. Parts lists and exports still work.';console.error(e)}
}
function requestRender(){if(!webglReady||renderPending)return;renderPending=true;requestAnimationFrame(()=>{renderPending=false;renderer.render(scene,camera)})}
function darkTheme(){return document.documentElement.dataset.theme==='dark'}
function edgeColor(){return darkTheme()?0xb6c0cf:0x526172}
function applyViewerTheme(){
  if(!scene||!groundGrid)return;
  const previous=groundGrid,dark=darkTheme();
  groundGrid=new THREE.GridHelper(2400,80,dark?0x566171:0x8995a5,dark?0x343c48:0xb5beca);
  groundGrid.position.copy(previous.position);groundGrid.visible=previous.visible;
  groundGrid.material.transparent=true;groundGrid.material.opacity=dark?.38:.6;
  scene.remove(previous);previous.geometry.dispose();previous.material.dispose();scene.add(groundGrid);
  for(const group of [assembly,inspector])group?.traverse(object=>{if(object.isLineSegments)object.material.color.set(edgeColor())});
  requestRender();
}
window.addEventListener('vault-theme-change',applyViewerTheme);
function resizeViewer(){if(!webglReady)return;const {width,height}=$('#viewer').getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height,false);if(camera.isPerspectiveCamera)camera.aspect=width/height;else{camera.left=-camera.top*width/height;camera.right=camera.top*width/height}camera.updateProjectionMatrix();if(assetsReady)resetCamera();requestRender()}
function resetCamera(preserveAngle=false){
  if(!webglReady)return;
  const obj=inspectItem?inspector:assembly;
  const box=new THREE.Box3().setFromObject(obj);if(box.isEmpty())return;
  const {width,height}=$('#viewer').getBoundingClientRect();
  const viewDirection=preserveAngle===true?camera.position.clone().sub(controls.target):null;
  fitCameraToBox(THREE,camera,controls,box,width/height,{viewDirection});requestRender();
}
$('#projection').onchange=e=>{projection=e.target.value;if(!webglReady)return;camera=projection==='isometric'?new THREE.OrthographicCamera(-300,300,300,-300,.1,12000):new THREE.PerspectiveCamera(34,1,.1,12000);controls.object=camera;resetCamera()};
$('#display-mode').onchange=e=>{displayMode=e.target.value;if(webglReady){if(externalInspection)inspectExternal(externalInspection.item,externalInspection.cached);else if(inspectItem&&models[inspectItem])inspectModel(inspectItem);else{rebuildAssembly();recolor()}}};
$('#reset-camera').onclick=resetCamera;
$('#toggle-grid').onclick=()=>{if(!webglReady)return;groundGrid.visible=!groundGrid.visible;$('#toggle-grid').classList.toggle('active',groundGrid.visible);requestRender()};
$('#toggle-explode').onclick=()=>{exploded=!exploded;$('#toggle-explode').classList.toggle('active',exploded);if(inspectItem)backToAssembly();else if(assetsReady&&webglReady){rebuildAssembly();resetCamera()}};
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('.viewer-panel').requestFullscreen();resizeViewer()}catch{toast('Fullscreen is not available in this browser.')}};
$('#drawer-open').oninput=e=>{openFraction=Number(e.target.value)/100;$('#drawer-percent').textContent=e.target.value+'%';if(assetsReady&&webglReady&&!inspectItem){rebuildAssembly();resetCamera(true)}};
$('#back-assembly').onclick=()=>switchPage('catalog');
function clearGroup(group){
  while(group.children.length){const child=group.children.pop();child.parent=null;child.traverse(obj=>{if((obj.isMesh||obj.isLineSegments)&&obj.material){if(Array.isArray(obj.material))obj.material.forEach(m=>m.dispose());else obj.material.dispose();if(obj.userData.disposableGeometry)obj.geometry.dispose()}})}
}
function colorFor(slot){return displayMode==='clay'?'#d5dce0':state.colors[slot]||slot}
function addPart(parent,key,position,slot,rotation=null){
  const source=assets.get(key);if(!source)return null;
  const obj=source.clone(true);obj.position.set(...position);if(rotation)obj.rotation.set(...rotation);
  const meshes=[];obj.traverse(mesh=>{if(mesh.isMesh)meshes.push(mesh)});
  for(const mesh of meshes){
    mesh.geometry=prepareDisplayGeometry(mesh.geometry);
    mesh.material=new THREE.MeshStandardMaterial({...STUDIO_MATERIAL,color:colorFor(slot),side:THREE.DoubleSide});mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.colorSlot=slot;
    if(displayMode==='edges'){
      if(!edgeCache.has(mesh.geometry))edgeCache.set(mesh.geometry,new THREE.EdgesGeometry(mesh.geometry,35));
      mesh.add(new THREE.LineSegments(edgeCache.get(mesh.geometry),new THREE.LineBasicMaterial({color:edgeColor(),transparent:true,opacity:.25})));
    }
  }
  parent.add(obj);return obj;
}
function recolor(){if(!webglReady)return;for(const group of [assembly,inspector])group.traverse(o=>{if(o.isMesh&&o.userData.colorSlot)o.material.color.set(colorFor(o.userData.colorSlot))});requestRender()}
function rebuildAssembly(fitCamera=false){
  if(!webglReady||!assetsReady)return;
  clearGroup(assembly);
  const plate=assets.get('baseplate'),baseplateHeight=plate?new THREE.Box3().setFromObject(plate,true).getSize(new THREE.Vector3()).z:4;
  for(const record of assemblyLayout({...state,normalizedAssets:status.connected||!legacyAssembly(state)},{open:openFraction,exploded,baseplateHeight}))addPart(assembly,record.key,record.position,record.slot,record.rotation);
  if(fitCamera)resetCamera();requestRender();
}

async function inspectModel(key){
  inspectionRequest++;externalInspection=null;
  switchPage('inspection');
  if(!webglReady||!assetsReady){toast('The 3D preview is not ready yet.');return}
  $('#loading-model').style.display='none';
  clearGroup(inspector);assembly.visible=false;inspector.visible=true;inspectItem=key;
  const obj=addPart(inspector,key,[0,0,0],PART_SLOTS[key]||'body');
  if(!obj)return;
  const b=new THREE.Box3().setFromObject(obj);obj.position.y=-b.min.y+3;
  $('#inspector-banner').hidden=false;const m=models[key];
  $('#inspector-name').textContent=`${m.name} · ${m.printSize?.map(x=>x.toFixed(1)).join(' × ')||'Not measured'} mm · source bounds`;
  $('#drawer-open').disabled=true;resetCamera();
}
function backToAssembly(){
  inspectionRequest++;externalInspection=null;
  if(!webglReady)return;$('#loading-model').style.display=assetsReady?'none':'grid';inspectItem=null;inspector.visible=false;assembly.visible=true;clearGroup(inspector);$('#inspector-banner').hidden=true;$('#drawer-open').disabled=false;rebuildAssembly();resetCamera();
}

function renderCatalog(){
  if(!catalog.length)return;
  const q=$('#search').value.trim().toLowerCase(),category=$('#category').value;
  const filtered=catalog.filter(c=>(!$('#stl-only').checked||c.type==='stl')&&(!category||c.category===category)&&(!q||c.path.toLowerCase().includes(q)));
  const totalPages=Math.max(1,Math.ceil(filtered.length/60));pageNumber=Math.min(pageNumber,totalPages-1);
  $('#library-summary').textContent=`${filtered.length.toLocaleString()} matching files · ${prettyBytes(filtered.reduce((n,c)=>n+c.bytes,0))} · ${status.matched||0} originals connected`;
  $('#catalog-body').innerHTML='';
  for(const item of filtered.slice(pageNumber*60,(pageNumber+1)*60)){
    const imported=importedPreviews[item.id];
    const tr=document.createElement('tr');tr.innerHTML=`<td><strong>${esc(item.name)}</strong><small>${esc(item.path.slice(0,item.path.lastIndexOf('/')))}</small>${imported?.printSize?`<small>${imported.printSize.map(n=>n.toFixed(1)).join(' × ')} mm · source bounds</small>`:''}</td><td>${esc(item.category)}</td><td>${prettyBytes(item.bytes)}</td><td></td>`;
    const cell=tr.lastElementChild;
    if(imported?.previewAvailable){const b=document.createElement('button');b.className='table-action';b.textContent='Preview';b.onclick=()=>inspectExternal(item,true);cell.append(b)}
    else if(!status.connected&&item.preview&&models[item.preview]?.url&&models[item.preview]?.catalogId===item.id){const b=document.createElement('button');b.className='table-action';b.textContent='Preview';b.onclick=()=>inspectModel(item.preview);cell.append(b)}
    if(imported&&!imported.previewAvailable){const note=document.createElement('small');note.textContent=reasonLabel(imported.reasonCode)||imported.note||'No preview geometry available.';cell.append(note)}
    if(status.available[item.id]){
      const a=document.createElement('a');a.className='table-action';a.href='api/original/'+encodeURIComponent(item.id);a.textContent='Download';cell.append(a);
      if(item.type==='stl'&&!imported?.previewAvailable){const b=document.createElement('button');b.className='table-action';b.textContent='Inspect STL';b.onclick=()=>inspectExternal(item,false);cell.append(b)}
    }else{const s=document.createElement('small');s.textContent='Original folder not connected';cell.append(s)}
    $('#catalog-body').append(tr);
  }
  $('#pagination-label').textContent=`Page ${pageNumber+1} of ${totalPages}`;$('#previous-page').disabled=pageNumber===0;$('#next-page').disabled=pageNumber>=totalPages-1;
}
$('#search').oninput=()=>{pageNumber=0;renderCatalog()};$('#category').onchange=()=>{pageNumber=0;renderCatalog()};$('#stl-only').onchange=()=>{pageNumber=0;renderCatalog()};$('#previous-page').onclick=()=>{pageNumber--;renderCatalog()};$('#next-page').onclick=()=>{pageNumber++;renderCatalog()};
async function inspectExternal(item,cached){
  if(!webglReady)return toast('The 3D viewer needs WebGL.');
  if(!cached&&item.bytes>100*1024*1024)return toast('This STL exceeds the 100 MB browser limit. Use the local importer in Printer & files to make a lightweight preview.');
  const request=++inspectionRequest;
  switchPage('inspection');$('#loading-model').hidden=false;$('#loading-model').style.display='grid';$('#loading-model').textContent='Reading '+item.name+'…';
  try{
    let object;
    if(cached)object=(await loader.loadAsync('api/preview/'+encodeURIComponent(item.id)+(importedPreviews[item.id]?.previewRevision?'?v='+encodeURIComponent(importedPreviews[item.id].previewRevision):''))).scene;
    else{
      const response=await fetch('api/original/'+encodeURIComponent(item.id));if(!response.ok)throw new Error('Cannot read this original. Check the folder connection.');
      object=new THREE.Group();object.add(new THREE.Mesh(new STLLoader().parse(await response.arrayBuffer()),new THREE.MeshBasicMaterial()));
    }
    const disposeObject=()=>{const group=new THREE.Group();group.add(object);clearGroup(group)};
    object.traverse(mesh=>{if(!mesh.isMesh)return;
      const source=mesh.geometry;mesh.geometry=prepareDisplayGeometry(source);if(source!==mesh.geometry)source.dispose();
      if(Array.isArray(mesh.material))mesh.material.forEach(m=>m.dispose());else mesh.material?.dispose();
      mesh.material=new THREE.MeshStandardMaterial({...STUDIO_MATERIAL,color:colorFor('body'),side:THREE.DoubleSide});mesh.userData.disposableGeometry=true;mesh.userData.colorSlot='body';
      if(displayMode==='edges'){
        const edges=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry,35),new THREE.LineBasicMaterial({color:edgeColor(),transparent:true,opacity:.25}));edges.userData.disposableGeometry=true;mesh.add(edges);
      }
    });
    if(request!==inspectionRequest){disposeObject();return}
    clearGroup(inspector);assembly.visible=false;inspector.visible=true;inspectItem=item.id;
    const box=new THREE.Box3().setFromObject(object),center=box.getCenter(new THREE.Vector3());object.position.sub(center);object.position.y+=box.getSize(new THREE.Vector3()).y/2+3;inspector.add(object);externalInspection={item,cached};
    const dimensions=importedPreviews[item.id]?.printSize;
    $('#inspector-banner').hidden=false;$('#inspector-name').textContent=item.name+(cached?' · imported preview':' · original STL')+(dimensions?' · '+dimensions.map(n=>n.toFixed(1)).join(' × ')+' mm':'');$('#drawer-open').disabled=true;resetCamera();
  }catch(e){recordDiagnostic('inspection_failed',{errorType:e.name,partIds:[item.id]});if(request===inspectionRequest)toast(e.message)}finally{if(request===inspectionRequest)$('#loading-model').style.display='none'}
}

function openProject(raw){
  const plan=sanitizeLayout(raw);saveLocal('vault-builder-open-v1',plan);switchPage('configurator');
}
function renderProjects(){
  projects=readSaved('vault-projects-v1',[]);if(!Array.isArray(projects))projects=[];
  $('#project-count').textContent=projects.length;$('#project-grid').innerHTML='';
  if(!projects.length){$('#project-grid').innerHTML='<div class="project-card"><h3>Your first build starts here.</h3><p>Open Configurator, then select Save project.</p></div>';return}
  projects.forEach((p,index)=>{
    let plan;try{plan=sanitizeLayout(p.state)}catch{return}
    const card=document.createElement('article');card.className='project-card';card.innerHTML=`<p class="eyebrow">${esc(plan.footprint+plan.depth)} · ${plan.rows.length} LEVELS</p><h3>${esc(p.name)}</h3><p>${esc(new Date(p.savedAt).toLocaleString())}</p><button class="button primary">Open</button><button class="button secondary">Export</button><button class="text-button">Delete</button>`;
    const buttons=card.querySelectorAll('button');buttons[0].onclick=()=>{try{openProject(p.state)}catch(e){toast(e.message)}};
    buttons[1].onclick=()=>{try{download('VAULT-build-plan.json',JSON.stringify(layoutManifest(plan,buildLayoutPlan(plan,catalog,importedPreviews,status)),null,2))}catch(e){toast(e.message)}};
    buttons[2].onclick=()=>{projects.splice(index,1);saveLocal('vault-projects-v1',projects);renderProjects();toast('Project removed from this browser.')};$('#project-grid').append(card);
  });
}
$('#save-project').onclick=()=>{
  const name=prompt('Project name',`${familyCode(state)} · ${state.layers.length} drawer${state.layers.length>1?'s':''}`);if(!name?.trim())return;
  projects.unshift({name:name.trim().slice(0,80),savedAt:new Date().toISOString(),state:structuredClone(state)});saveLocal('vault-projects-v1',projects);renderProjects();toast('Project saved in this browser. Export the build plan for a portable backup.');
};
$('#import-project').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{if(file.size>200000)throw new Error('This file is too large for a build plan.');const raw=JSON.parse(await file.text());openProject(raw)}catch(error){toast(error.message)}finally{e.target.value=''}
};
$('#export-plan').onclick=()=>download('VAULT-build-plan.json',JSON.stringify(makeManifest(state,models),null,2));
$('#export-csv').onclick=()=>{
  const manifest=makeManifest(state,models);
  const rows=[['File','Copies of complete STL','Filament','Color HEX','Grams per complete STL','Total grams'],...manifest.files.map(p=>[p.path,p.quantity,p.filament,p.color,p.gramsPerFile??'',p.gramsPerFile===null?'':p.gramsPerFile*p.quantity]),['M4 x 14 mm bolts',boltCount(state)*state.layers.length,'Hardware: manual page 18','','','']];
  const csv=rows.map(row=>row.map(c=>'"'+String(c).replaceAll('"','""')+'"').join(',')).join('\r\n');
  download('VAULT-parts-list.csv','\ufeff'+csv,'text/csv;charset=utf-8');
};
$('#export-stls').onclick=async()=>{
  const bom=billOfMaterials(state,models),missing=bom.filter(p=>!status.available[p.id]);
  if(missing.length){switchPage('settings');toast('Connect the original USSA VAULT folder first. Your preview models are not print files.');return}
  const b=$('#export-stls');b.disabled=true;b.textContent='Packaging originals…';
  try{const r=await fetch('api/package',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(makeManifest(state,models))});if(!r.ok){const error=await r.json();throw new Error(error.error)}download('VAULT-print-package.zip',await r.blob());toast('Print package ready. Check quantities and your slicer settings before printing.')}catch(error){toast(error.message)}finally{b.disabled=false;b.innerHTML='Package original STLs <span>↓</span>'}
};

function renderGuides(){
  $('#guide-grid').innerHTML='<article class="guide-card"><h3>Your original assembly guides</h3><p>Use the manuals supplied with your purchased USSA VAULT package. This public app does not redistribute them.</p><a class="button secondary" href="https://www.ussadesign.com/pages/vault" target="_blank" rel="noopener">USSA VAULT resources ↗</a></article>';
}

function syncFamilyButtons(){
  $$('[data-family]').forEach(b=>{b.classList.toggle('selected',b.dataset.family===state.family);b.setAttribute('aria-pressed',String(b.dataset.family===state.family))});
}
async function sourceObject(url){
  if(!sourceCache.has(url)){
    const pending=loader.loadAsync(url).then(g=>g.scene).catch(e=>{sourceCache.delete(url);throw e});sourceCache.set(url,pending);
    if(sourceCache.size>16)sourceCache.delete(sourceCache.keys().next().value);
  }
  return sourceCache.get(url);
}
async function loadBuild(){
  if(!catalog.length)return;
  const request=++buildRequest,selected=structuredClone(state);
  modelSignature=selectionSignature();assetsReady=false;
  try{
    const selectedModels=resolveBuildModels(selected);models=selectedModels;renderBuild();
    const missing=missingGeometry(selected,models);
    if(missing.length)recordDiagnostic('assembly_missing',{partIds:requiredPreviewKeys(selected).filter(key=>!models[key]?.url).map(key=>models[key]?.catalogId).filter(Boolean)});
    $('#configuration-note').textContent=missing.length?'Preview incomplete: '+missing.join(', ')+'. These files have no cached mesh. Parts lists and original STL exports remain available.':'Imported original meshes · illustrative assembly positions. Same size and height on every level.';
    $('#inventory-summary').textContent=`${catalog.filter(c=>c.type==='stl').length} STL files · ${Object.values(importedPreviews).filter(p=>p.previewAvailable).length} imported previews · previews generated locally`;
    if(!webglReady)return;
    clearGroup(assembly);clearGroup(inspector);inspectItem=null;externalInspection=null;assembly.visible=true;inspector.visible=false;$('#inspector-banner').hidden=true;
    $('#drawer-open').disabled=!!missing.length;
    $('#loading-model').style.display='grid';$('#loading-model').textContent=missing.length?'Preview incomplete. Missing cached geometry: '+missing.join(', ')+'. Use Start / resume import in Printer & files; see the note beside the controls.':'Loading '+familyCode(selected)+' / '+drawerHeight(selected)+'F…';
    if(missing.length)return;
    const next=new Map();
    if(!status.connected&&legacyAssembly(selected)){
      for(const key of requiredPreviewKeys(selected))next.set(key,await sourceObject(bundledModels[key].url));
      for(const role of ['springs','guides','slides',...(selected.rails?['rails']:[])])for(const side of [0,1])next.set(role+'-'+side,await sourceObject('models/'+role+'-'+side+'.glb'));
    }else{
      const width=DRAWER_WIDTHS[selected.family],extra=(selected.depth-3)*42;
      const dims={module:{width,height:selected.height*48+9.009,uprightShell:true},
        box:{width:width-30.6,height:143.8+extra,heavySideBelow:true},facade:{width,height:selected.height*48-1},
        roof:{width},baseplate:{width:width-39.3,height:134+extra},
        guides:{width:55.65,height:143.5+extra},slides:{width:38.6,height:118+extra},rails:{width:width-88.35}};
      await Promise.all(requiredPreviewKeys(selected).map(async key=>{
        const raw=await sourceObject(selectedModels[key].url),object=dims[key]?orientPart(raw,dims[key]):raw.clone(true);next.set(key,object);
        if(['guides','slides','rails','springs'].includes(key))splitPair(object,['rails','springs'].includes(key)?'y':'x').forEach((part,i)=>next.set(key+'-'+i,part));
      }));
    }
    if(request!==buildRequest)return;
    assets.clear();for(const [key,value] of next)assets.set(key,value);
    assetsReady=true;$('#loading-model').style.display='none';rebuildAssembly();resizeViewer();resetCamera();
  }catch(error){recordDiagnostic('assembly_load_failed',{errorType:error.name});if(request!==buildRequest)return;$('#loading-model').style.display='grid';$('#loading-model').textContent='Could not load this assembly: '+error.message;toast(error.message)}
}

async function start(){
  try{const plan=sanitizeLayout(readSaved('vault-layout-v1',null));state.printer=plan.printer;state.filament=plan.filament;state.colors=plan.colors;saveLocal('vault-current-v1',state)}catch{}
  syncInputs();renderSetup();renderGuides();renderProjects();initViewer();
  const requested=window.location.hash.slice(1);if(['settings','filament','projects','catalog','guides'].includes(requested))switchPage(requested);
  try{
    const [m,c]=await Promise.all([fetch('data/models.json').then(r=>{if(!r.ok)throw new Error('Model metadata unavailable');return r.json()}),fetch('api/catalog').then(r=>{if(!r.ok)throw new Error('Local server unavailable');return r.json()})]);bundledModels=m;catalog=c;
    const stls=catalog.filter(c=>c.type==='stl').length;$('#catalog-count').textContent=stls;$('#inventory-summary').textContent=`${stls} STL files · import your library to generate previews · previews generated locally`;
    renderBuild();renderCatalog();await refreshStatus();await refreshImporter();
    await loadBuild();
  }catch(error){$('#loading-model').textContent='Could not load the workbench: '+error.message+'. Run start-windows.cmd or Docker; do not open index.html directly.';toast(error.message);console.error(error)}
}
const manufacturingUI=createManufacturingUI({getState:()=>state,getModels:()=>models,getParts:()=>billOfMaterials(state,models),esc,persist,
  onPrinterChange:()=>{saveLocal('vault-printer-confirmed-v1',true);syncPlanSettings(['printer']);renderBuild();renderSetup()},onColorChange:()=>recolor(),download,toast,
  showPreview:()=>{displayMode='studio';$('#display-mode').value='studio';switchPage('configurator');backToAssembly();recolor()}});
start();
