// Synthetic test geometry only. No USSA model triangles are distributed.
import fs from 'node:fs';
import * as THREE from '../web/vendor/build/three.module.js';
import {mergeGeometries} from '../web/vendor/utils/BufferGeometryUtils.js';
const metadata=JSON.parse(fs.readFileSync(new URL('./fixtures/models.json',import.meta.url)));
const cache=new Map();
export function readGeometry(key){
  if(cache.has(key))return cache.get(key);
  const role=key.replace(/-[01]$/,''),size=metadata[role]?.printSize||[10,10,10];
  let geometry;
  if(['guides','slides','rails','springs'].includes(key)){
    const left=new THREE.BoxGeometry(5,20,5).translate(-15,0,0);
    const right=new THREE.BoxGeometry(5,20,5).translate(15,0,0);
    geometry=mergeGeometries([left,right]);left.dispose();right.dispose();
  }else geometry=new THREE.BoxGeometry(...size);
  cache.set(key,geometry);return geometry;
}
