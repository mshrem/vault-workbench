import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/build/three.module.js';
import {assemblyLayout,M3,fitCameraToBox} from '../web/assembly.js';
import {DEFAULT_STATE} from '../web/core.js';
import {readGeometry} from './geometry-utils.mjs';
// Simplified preview vertices can move by a few hundredths of a millimetre.
const close=(a,b,tolerance=.1)=>assert(Math.abs(a-b)<tolerance,`${a} differs from ${b}`);
function meshFor(record){const mesh=new THREE.Mesh(readGeometry(record.key));mesh.rotation.set(...record.rotation);mesh.position.set(...record.position);mesh.updateMatrixWorld();return mesh}
function bounds(record){return new THREE.Box3().setFromObject(meshFor(record))}

test('opening translates the complete drawer while the shell, guides and roof stay fixed',()=>{
  const closed=assemblyLayout(DEFAULT_STATE),opened=assemblyLayout(DEFAULT_STATE,{open:1});
  assert.equal(closed.length,opened.length);
  closed.forEach((c,i)=>{
    assert.equal(c.key,opened[i].key);close(c.position[0],opened[i].position[0]);close(c.position[1],opened[i].position[1]);
    close(opened[i].position[2]-c.position[2],c.group==='drawer'?105:0);
  });
  const closedBox=bounds(closed.find(r=>r.key==='box')),openedBox=bounds(opened.find(r=>r.key==='box'));
  assert(openedBox.min.z<closedBox.max.z,'drawer retains overlap at the end of its travel');
});
test('stacks use the connector pitch and one roof at the top',()=>{
  const state=structuredClone(DEFAULT_STATE);state.layers.push({label:'Second'},{label:'Third'});
  const records=assemblyLayout(state),shells=records.filter(r=>r.key==='module');
  close(shells[1].position[1]-shells[0].position[1],192);close(shells[2].position[1]-shells[1].position[1],192);
  assert.equal(records.filter(r=>r.key==='roof').length,1);assert.equal(records.find(r=>r.key==='roof').level,2);
});
test('closed, open and stacked assembly bounds fit both projections at wide and narrow viewport sizes',()=>{
  for(const count of [1,3])for(const open of [0,1])for(const aspect of [.6,1.3,2])for(const perspective of [false,true]){
    const state=structuredClone(DEFAULT_STATE);state.layers=Array.from({length:count},()=>({label:'Drawer'}));
    const group=new THREE.Group();for(const r of assemblyLayout(state,{open}))group.add(meshFor(r));group.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(group),camera=perspective?new THREE.PerspectiveCamera(34,aspect,.1,12000):new THREE.OrthographicCamera(-1,1,1,-1,.1,12000);
    const controls={target:new THREE.Vector3(),update(){camera.lookAt(this.target)}};
    fitCameraToBox(THREE,camera,controls,box,aspect);
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const p=new THREE.Vector3(x,y,z).project(camera);assert(Math.abs(p.x)<.86&&Math.abs(p.y)<.86,'model must remain centered inside the viewport');
    }
  }
});
