import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
import * as THREE from '../web/vendor/build/three.module.js';import {orientPart,splitPair} from '../web/assembly-geometry.js';import {prepareDisplayGeometry,STUDIO_MATERIAL} from '../web/rendering.js';import {DRAWER_WIDTHS,requiredPreviewKeys} from '../web/families.js';import {fitCameraToBox} from '../web/assembly.js';import {layoutInstances,instancePlacement,exampleLayout,buildLayoutPlan} from '../web/layout.js';import {DEFAULT_STATE} from '../web/core.js';
const require=createRequire(import.meta.url);const {JSDOM}=process.env.VAULT_TEST_NODE_MODULES?require(require.resolve('jsdom',{paths:[process.env.VAULT_TEST_NODE_MODULES]})):require('jsdom');
const catalog=JSON.parse(fs.readFileSync(new URL('../web/data/catalog.json',import.meta.url)));

test('3D path loads exact preview IDs, positions mixed modules, reuses geometry and renders missing rows as placeholders',async()=>{
 const dom=new JSDOM('<div id="stage"></div>'),document=dom.window.document,element=document.getElementById('stage');element.getBoundingClientRect=()=>({width:800,height:600,left:0,top:0});const requested=[];
 class Renderer{constructor(){this.domElement=document.createElement('canvas')}setPixelRatio(){}setSize(){}render(){}dispose(){}}
 class Controls{constructor(camera){this.object=camera;this.target=new THREE.Vector3()}addEventListener(){}update(){this.object.lookAt(this.target)}}
 class Loader{async loadAsync(url){requested.push(url);const item=catalog.find(i=>i.id===url.split('/').at(-1).split('?')[0]);assert(item);const width=DRAWER_WIDTHS[item.name[0]]||254,h=Number(item.name.match(/([124])F/)?.[1]||1);let g;
   if(item.name.includes('Module'))g=new THREE.BoxGeometry(width,48*h+9.009,146).rotateZ(Math.PI/4);
   else if(item.name.includes('Box'))g=new THREE.BoxGeometry(width-30.6,143.8,48*h-10.5);
   else if(item.name.includes('Baseplate'))g=new THREE.BoxGeometry(width-39.3,134,25.9);
   else if(item.name.includes('Roof'))g=new THREE.BoxGeometry(width,5,146).rotateZ(Math.PI/4);
   else if(item.name.includes('Turn On Supports')&&/^[SML][124]F/.test(item.name))g=new THREE.BoxGeometry(width,48*h-1,10);
   else g=new THREE.BoxGeometry(40,40,5);
   const scene=new THREE.Group();scene.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial()));return {scene};}}
 const args={THREE:{...THREE,WebGLRenderer:Renderer},OrbitControls:Controls,GLTFLoader:Loader,orientPart,splitPair,prepareDisplayGeometry,STUDIO_MATERIAL,DRAWER_WIDTHS,requiredPreviewKeys,fitCameraToBox,layoutInstances,instancePlacement,window:dom.window,ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>{fn();return 1}};
 const source=fs.readFileSync(new URL('../web/layout-viewer.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export class LayoutViewer','class LayoutViewer')+'\nreturn LayoutViewer;';
 const Viewer=new Function(...Object.keys(args),source)(...Object.values(args)),viewer=new Viewer(element),p=exampleLayout({...DEFAULT_STATE,height:1});assert(viewer.ready);
 const previews=Object.fromEntries(catalog.filter(i=>i.type==='stl').map(i=>[i.id,{previewAvailable:true,printSize:[100,100,10]}]));let result=buildLayoutPlan(p,catalog,previews);
 const ready=await viewer.update(p,result,p.rows[1].id);assert.equal(ready.schematic,0);assert.equal(viewer.root.children.length,3);assert(requested.every(url=>url.startsWith('api/preview/')));
 const module=viewer.root.children[1].getObjectByName('module'),bounds=new THREE.Box3().setFromObject(module);assert(Math.abs(bounds.getCenter(new THREE.Vector3()).x+82.4)<1e-3);
 assert(Math.abs(module.position.y-(48+(48+9.009)/2))<1e-5);
 const count=requested.length;await viewer.update(structuredClone(p),result,p.rows[1].id);assert.equal(requested.length,count,'unchanged configurations reuse prepared meshes');
 // Reproduce the user's imported tall baseplate; measure real rendered
 // world bounds after all rotations, level offsets and drawer travel.
 p.rows[1].baseplate=true;result=buildLayoutPlan(p,catalog,previews);await viewer.update(p,result,p.rows[1].id);
 const inserted=viewer.root.children[1].getObjectByName('baseplate');
 let plateBounds=new THREE.Box3().setFromObject(inserted,true);
 assert(Math.abs(plateBounds.min.y-(48+11.3))<1e-4,'25.9 mm plate rests above the floor, rather than intersecting it');
 const closedPlateZ=plateBounds.min.z;viewer.motion({open:1});plateBounds=new THREE.Box3().setFromObject(viewer.root.children[1].getObjectByName('baseplate'),true);
 assert(Math.abs(plateBounds.min.y-(48+11.3))<1e-4);assert(Math.abs(plateBounds.min.z-closedPlateZ-105)<1e-4);
 viewer.motion({open:0});
 const before=viewer.root.children[1].getObjectByName('facade').position.z;viewer.motion({open:1});assert.equal(viewer.root.children[1].getObjectByName('facade').position.z,before+105);
 const facade=result.resolved.get(p.rows[1].id).facade.catalogId;previews[facade].previewAvailable=false;result=buildLayoutPlan(p,catalog,previews);
 const missing=await viewer.update(p,result,p.rows[1].id);assert.equal(missing.schematic,2);assert.equal(viewer.root.children.length,3);assert.equal(viewer.root.children[1].children[0].material.wireframe,true);
 viewer.clear();dom.window.close();
});
