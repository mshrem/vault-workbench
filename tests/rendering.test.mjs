import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../web/vendor/build/three.module.js';
import {ensureSurfaceNormals,prepareDisplayGeometry,STUDIO_MATERIAL} from '../web/rendering.js';
import {mergeVertices} from '../web/vendor/utils/BufferGeometryUtils.js';

test('synthetic geometry without normals receives usable lighting directions',()=>{
  const geometry=new THREE.BoxGeometry(10,20,30);geometry.deleteAttribute('normal');
  const normals=ensureSurfaceNormals(geometry);
  assert.equal(normals.count,geometry.attributes.position.count);
  for(let i=0;i<normals.count;i++){
    const n=new THREE.Vector3().fromBufferAttribute(normals,i);
    assert(Number.isFinite(n.length())&&Math.abs(n.length()-1)<.001);
  }
  const material=new THREE.MeshStandardMaterial({...STUDIO_MATERIAL,color:'#efcf60'});
  assert.equal(material.color.getHexString(),'efcf60');
  assert.strictEqual(ensureSurfaceNormals(geometry),normals);
  geometry.dispose();material.dispose();
});

test('crease-aware shading keeps flat faces flat across triangulation and hard corners',()=>{
  const cube=new THREE.BoxGeometry(10,10,10);cube.deleteAttribute('normal');cube.deleteAttribute('uv');
  const welded=mergeVertices(cube),prepared=prepareDisplayGeometry(welded);
  assert.strictEqual(prepareDisplayGeometry(welded),prepared,'preparation is cached for stacks and slider updates');
  const normals=prepared.getAttribute('normal'),positions=prepared.getAttribute('position');
  for(let i=0;i<positions.count;i+=3){
    const a=new THREE.Vector3().fromBufferAttribute(positions,i),b=new THREE.Vector3().fromBufferAttribute(positions,i+1),c=new THREE.Vector3().fromBufferAttribute(positions,i+2);
    const face=b.sub(a).cross(c.sub(a)).normalize();
    for(let j=0;j<3;j++)assert(face.dot(new THREE.Vector3().fromBufferAttribute(normals,i+j))>.99999,'adjacent side walls must not create diagonal shading on a plane');
  }
  cube.dispose();welded.dispose();prepared.dispose();
});
