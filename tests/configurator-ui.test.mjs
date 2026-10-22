import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import * as THREE from '../web/vendor/build/three.module.js';
import * as core from '../web/core.js';
import * as families from '../web/families.js';
import * as geometry from '../web/assembly-geometry.js';
import * as rendering from '../web/rendering.js';
import * as assembly from '../web/assembly.js';
import * as layout from '../web/layout.js';
import {createManufacturingUI} from '../web/manufacturing-ui.js';
import {PART_SLOTS} from '../web/manufacturing.js';
import {readGeometry} from './geometry-utils.mjs';
const require=createRequire(import.meta.url);
const {JSDOM}=process.env.VAULT_TEST_NODE_MODULES?require(require.resolve('jsdom',{paths:[process.env.VAULT_TEST_NODE_MODULES]})):require('jsdom');
const catalog=JSON.parse(fs.readFileSync(new URL('../web/data/catalog.json',import.meta.url)));
const bundled=JSON.parse(fs.readFileSync(new URL('./fixtures/models.json',import.meta.url)));

for(const connected of [true,false])test(connected?'configurator controls export a plain L3/2F build with synthetic previews':'fresh public install guides the user to import without requesting proprietary assets',async()=>{
  const dom=new JSDOM(fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8'),{url:'http://localhost:8787'});
  const oldDocument=globalThis.document;globalThis.document=dom.window.document;
  try{
    const $=s=>document.querySelector(s),previews=Object.fromEntries(catalog.filter(i=>i.type==='stl').map(i=>[i.id,{previewAvailable:true,printSize:[100,100,10]}]));
    for(const m of Object.values(bundled))previews[m.catalogId].printSize=m.printSize;
    const requests=[],downloads=[],errors=[];
    class Renderer{
      constructor(){this.domElement=document.createElement('canvas');this.shadowMap={}}
      setPixelRatio(){}setSize(){}render(){}
    }
    class Controls{constructor(camera){this.object=camera;this.target=new THREE.Vector3()}addEventListener(){}update(){this.object.lookAt(this.target)}}
    class Loader{
      async loadAsync(url){
        requests.push(url);let g;
        if(url.startsWith('models/'))g=readGeometry(url.slice(7,-4)).clone();
        else{
          const item=catalog.find(i=>i.id===url.split('/').at(-1).split('?')[0]);assert(item,'known cache ID requested');
          const sample=Object.entries(bundled).find(([,m])=>m.catalogId===item.id);
          if(sample)g=readGeometry(sample[0]).clone();
          else if(item.name.includes('Module'))g=new THREE.BoxGeometry(329.6,48*Number(item.name.match(/([124])F/i)[1])+9.009,146.1).rotateZ(Math.PI/4);
          else if(item.name.includes('Box'))g=new THREE.BoxGeometry(298.997,143.8,48*Number(item.name.match(/([124])F/i)[1])-10.5);
          else if(item.name.includes('Roof'))g=new THREE.BoxGeometry(329.6,10,145.97).rotateZ(Math.PI/4);
          else if(/^L[124]F/.test(item.name))g=new THREE.BoxGeometry(329.6,48*Number(item.name[1])-1,10.26);
          else if(item.name.includes('Baseplate'))g=new THREE.BoxGeometry(290.4,134,4);
          else throw new Error('Unexpected preview '+item.name);
        }
        const scene=new THREE.Group();scene.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial()));return {scene};
      }
    }
    $('#viewer').getBoundingClientRect=()=>({width:800,height:700});
    dom.window.HTMLAnchorElement.prototype.click=function(){};
    const fetch=async url=>({ok:true,json:async()=>url==='data/models.json'?{}:url==='api/catalog'?catalog:url==='api/previews'?(connected?previews:{}):
      url==='api/status'?{connected,matched:connected?992:0,total:992,available:Object.fromEntries(catalog.map(i=>[i.id,true]))}:
      {state:'complete',indexed:977,previews:944,total:977,processed:977,failed:0,missingDependencies:[]}});
    const args={...core,...families,...geometry,...rendering,...assembly,...layout,createManufacturingUI,PART_SLOTS,
      THREE:{...THREE,WebGLRenderer:Renderer},OrbitControls:Controls,GLTFLoader:Loader,STLLoader:class{},
      document,window:dom.window,localStorage:dom.window.localStorage,fetch,devicePixelRatio:1,
      ResizeObserver:class{observe(){}},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:fn=>{fn();return 1},
      URL:{createObjectURL:b=>{downloads.push(b);return 'blob:test'},revokeObjectURL(){}},prompt:()=> 'Plain L3',
      console:{error:e=>errors.push(e),warn(){},log(){}}};
    const source=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/start\(\);\s*$/,'await start();');
    const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
    await new AsyncFunction(...Object.keys(args),source)(...Object.values(args));
    const settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve))};
    assert($('#page-home').classList.contains('active'));
    assert.equal($('#setup-preview-count').textContent,'944 previews ready');
    if(connected){
      $('#setup-next').click();assert($('#page-settings').classList.contains('active'));
      $('#printer-preset').value='1';$('#printer-preset').dispatchEvent(new dom.window.Event('change'));
      $('[data-page="home"]').click();await settle();assert.equal($('#setup-next').textContent,'Continue my design →');
      $('#setup-next').click();assert.equal($('#open-configurator').getAttribute('href'),'layout.html');
    }else{
      $('[data-setup-anchor="library-connection"]').click();assert($('#page-settings').classList.contains('active'));
      $('[data-page="home"]').click();await settle();assert($('#setup-library-status').textContent.includes('Connect your original folder'));
    }

    if(!connected){
      assert($('#connection-detail').textContent.includes('Connect your purchased'));
      assert.equal($('#loading-model').style.display,'grid');
      assert($('#loading-model').textContent.includes('Missing cached geometry'));
      assert.equal($('#import-start').disabled,true);
      assert.equal(requests.length,0);
      assert($('#parts-list').textContent.includes('M3 / 4F module'));
      assert.equal(document.querySelectorAll('a[href^="guides/"]').length,0);
      assert.deepEqual(errors,[]);
      return;
    }
    assert.equal($('#loading-model').style.display,'none');
    $('[data-family="L"]').click();await settle();assert.equal($('#loading-model').style.display,'none');
    $('#drawer-height').value='2';$('#drawer-height').dispatchEvent(new dom.window.Event('change'));await settle();assert.equal($('#loading-model').style.display,'none');
    $('#roof').value='table';$('#roof').dispatchEvent(new dom.window.Event('change'));await settle();assert.equal($('#loading-model').style.display,'none');
    $('#plain-drawer').click();await settle();
    assert.equal($('#family-stat').textContent,'L3');assert.equal($('#baseplate').checked,false);
    assert($('#parts-list').textContent.includes('L3 / 2F module'));
    assert($('#parts-list').textContent.includes('L3 table roof'));
    assert(!$('#parts-list').textContent.includes('Gridfinity'));
    assert.equal($('#loading-model').style.display,'none');assert.equal($('#drawer-open').disabled,false);
    $('#drawer-open').value='100';$('#drawer-open').dispatchEvent(new dom.window.Event('input'));
    $('#export-plan').click();let plan=JSON.parse(await downloads.at(-1).text());
    assert.equal(plan.configuration.family,'L');assert.equal(plan.configuration.height,2);assert.equal(plan.configuration.baseplate,false);
    const module=catalog.find(i=>i.name==='L3 Module 2F.stl');assert(plan.files.some(i=>i.id===module.id));
    assert(requests.includes('api/preview/'+module.id));
    assert(requests.every(url=>url.startsWith('api/preview/')),'connected builds must load fresh cached meshes, including universal parts');
    assert(!plan.files.some(i=>i.path.includes('M Families')||i.path.includes('Gridfinity Baseplate')));
    $('#save-project').click();assert(JSON.parse(dom.window.localStorage.getItem('vault-projects-v1'))[0].state.family==='L');
    // An existing weight must not be applied to a different original STL.
    const input=document.querySelector('#filament-usage input');input.value='100';input.dispatchEvent(new dom.window.Event('input'));
    $('#drawer-height').value='1';$('#drawer-height').dispatchEvent(new dom.window.Event('change'));await settle();
    $('#export-plan').click();plan=JSON.parse(await downloads.at(-1).text());assert.equal(plan.files.find(i=>i.path.includes('/Modules/')).gramsPerFile,null);
    // A missing preview keeps the true original in the plan and clears the old scene.
    previews[module.id].previewAvailable=false;
    $('#drawer-height').value='2';$('#drawer-height').dispatchEvent(new dom.window.Event('change'));await settle();
    assert.equal($('#loading-model').style.display,'grid');assert($('#loading-model').textContent.includes('L3 Module 2F.stl'));
    assert.equal($('#drawer-open').disabled,true);$('#export-plan').click();plan=JSON.parse(await downloads.at(-1).text());
    assert(plan.files.some(i=>i.id===module.id));
    // Late results from a prior selection cannot replace the latest choice.
    previews[module.id].previewAvailable=true;
    $('#drawer-height').value='4';$('#drawer-height').dispatchEvent(new dom.window.Event('change'));
    $('#drawer-height').value='2';$('#drawer-height').dispatchEvent(new dom.window.Event('change'));await settle();
    assert.equal($('#loading-model').style.display,'none');assert.equal($('#plan-family').textContent,'L3 / 2F');
    const key=catalog.find(i=>i.name==='Key (Turn On Supports).stl'&&i.category==='Drawers');previews[key.id].previewAvailable=false;
    $('#baseplate').click();await settle();
    assert.equal($('#loading-model').style.display,'grid');assert($('#loading-model').textContent.includes(key.name));
    // A cached part can be inspected even while another required assembly mesh is absent.
    $('#search').value='L3 Box 2F.stl';$('#search').dispatchEvent(new dom.window.Event('input'));
    const previewButton=[...document.querySelectorAll('#catalog-body button')].find(b=>b.textContent==='Preview');
    assert(previewButton);previewButton.click();await settle();
    assert($('#inspector-name').textContent.includes('L3 Box 2F.stl'));
    assert.equal($('#loading-model').style.display,'none');
    assert.deepEqual(errors,[]);
  }finally{globalThis.document=oldDocument;dom.window.close()}
});
