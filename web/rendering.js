import {toCreasedNormals} from './vendor/utils/BufferGeometryUtils.js';

// glTF permits missing normals: its loader enables derivative/flat shading on
// the original material. A replacement material must supply that behavior or
// create normals first, otherwise StandardMaterial can render as solid black.
export function ensureSurfaceNormals(geometry){
  if(!geometry.getAttribute('normal'))geometry.computeVertexNormals();
  return geometry.getAttribute('normal');
}

const displayCache=new WeakMap();
export function prepareDisplayGeometry(geometry){
  if(displayCache.has(geometry))return displayCache.get(geometry);
  // Preserve smooth bevels, but don't average a large flat panel with its sides.
  // The old averaged normals produced the diagonal "dents" seen in screenshots.
  const prepared=toCreasedNormals(geometry.index?geometry:geometry.clone(),Math.PI/6);
  displayCache.set(geometry,prepared);return prepared;
}

export const STUDIO_MATERIAL = Object.freeze({
  roughness:0.82,
  metalness:0,
  // Front and back faces use physically consistent illumination.
  flatShading:false
});
