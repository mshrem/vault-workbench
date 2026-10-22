import * as THREE from './vendor/build/three.module.js';

function hull2(points){
  const sorted=[...new Map(points.map(p=>[p.map(x=>x.toFixed(3)).join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=list=>{const result=[];for(const p of list){while(result.length>1&&cross(result.at(-2),result.at(-1),p)<=0)result.pop();result.push(p)}return result};
  return [...half(sorted).slice(0,-1),...half(sorted.slice().reverse()).slice(0,-1)];
}

// Source STLs include 45-degree printing rotations. Determine the actual
// rectangular axes from mesh vertices, not the inflated source AABB.
export function planarAngle(points,width,height=null){
  const hull=hull2(points);let best={score:Infinity,angle:0};
  const candidates=[0];
  for(let i=0;i<hull.length;i++){const a=hull[i],b=hull[(i+1)%hull.length],t=-Math.atan2(b[1]-a[1],b[0]-a[0]);candidates.push(t,t+Math.PI/2)}
  for(let angle of candidates){
    angle=((angle+Math.PI/2)%Math.PI+Math.PI)%Math.PI-Math.PI/2;
    const c=Math.cos(angle),s=Math.sin(angle),xs=hull.map(p=>c*p[0]-s*p[1]),ys=hull.map(p=>s*p[0]+c*p[1]);
    const w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys);
    const score=Math.abs(w-width)+(height===null?h*.005:Math.abs(h-height));
    if(score<best.score-1e-4||Math.abs(score-best.score)<1e-4&&Math.abs(angle)<Math.abs(best.angle))best={score,angle};
  }
  return best.angle;
}

function eachMesh(object,fn){object.traverse(mesh=>{if(mesh.isMesh)fn(mesh)})}
function apply(object,matrix){eachMesh(object,m=>m.geometry.applyMatrix4(matrix))}
export function centerObject(object){
  const b=new THREE.Box3().setFromObject(object,true),c=b.getCenter(new THREE.Vector3());
  apply(object,new THREE.Matrix4().makeTranslation(-c.x,-c.y,-c.z));return object;
}

export function orientPart(source,{width,height=null,heavySideBelow=false,uprightShell=false}={}){
  const result=new THREE.Group();source.updateMatrixWorld(true);
  eachMesh(source,mesh=>result.add(new THREE.Mesh(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),new THREE.MeshBasicMaterial())));
  const points=[];eachMesh(result,m=>{const p=m.geometry.attributes.position;for(let i=0;i<p.count;i++)points.push([p.getX(i),p.getY(i)])});
  const angle=planarAngle(points,width,height);apply(result,new THREE.Matrix4().makeRotationZ(angle));
  if(heavySideBelow||uprightShell){
    const b=new THREE.Box3().setFromObject(result,true),height=b.max.y-b.min.y,planes=new Map();let low=0,high=0;
    eachMesh(result,m=>{
      const g=m.geometry.index?m.geometry.toNonIndexed():m.geometry,p=g.attributes.position;
      const a=new THREE.Vector3(),v=new THREE.Vector3(),w=new THREE.Vector3();
      for(let i=0;i<p.count;i+=3){a.fromBufferAttribute(p,i);v.fromBufferAttribute(p,i+1);w.fromBufferAttribute(p,i+2);const y=(a.y+v.y+w.y)/3;v.sub(a);w.sub(a);v.cross(w);if(Math.abs(v.y)<v.length()*.85)continue;if(y<b.min.y+height*.2)low+=Math.abs(v.y);if(y>b.max.y-height*.2)high+=Math.abs(v.y);const bin=Math.round(y*10)/10;planes.set(bin,(planes.get(bin)||0)+Math.abs(v.y))}
      if(g!==m.geometry)g.dispose();
    });
    // Chassis floors and ceilings have almost equal area. Their large interior
    // faces sit slightly above the connector-bounds center in the supplied
    // sample. Use that asymmetry rather than turning a closed shell upside down.
    const peak=positive=>[...planes].filter(([y])=>positive?y>height*.2:y<-height*.2).sort((a,b)=>b[1]-a[1])[0];
    const upper=peak(true),lower=peak(false),inverted=uprightShell&&upper&&lower?(upper[0]+lower[0])<-.1:high>low*1.1;
    if(inverted)apply(result,new THREE.Matrix4().makeRotationZ(Math.PI));
  }
  result.userData.planarAngle=angle;return centerObject(result);
}

// Paired runner STLs contain two parts separated along source X. Keep whole-file
// BOM quantities while rendering each side at its own assembly anchor.
export function splitPair(source,axis='x'){
  const groups=[new THREE.Group(),new THREE.Group()],values=[[],[]],normals=[[],[]];
  const a=axis==='x'?0:1;
  eachMesh(source,m=>{
    const g=m.geometry.index?m.geometry.toNonIndexed():m.geometry,p=g.attributes.position,n=g.attributes.normal;
    for(let i=0;i<p.count;i+=3){const center=(p.array[i*3+a]+p.array[(i+1)*3+a]+p.array[(i+2)*3+a])/3,k=center<0?0:1;
      for(let j=0;j<3;j++){values[k].push(p.getX(i+j),p.getY(i+j),p.getZ(i+j));if(n)normals[k].push(n.getX(i+j),n.getY(i+j),n.getZ(i+j))}}
    if(g!==m.geometry)g.dispose();
  });
  groups.forEach((group,i)=>{if(!values[i].length)throw new Error('Cannot separate paired runner preview.');const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(values[i],3));if(normals[i].length)g.setAttribute('normal',new THREE.Float32BufferAttribute(normals[i],3));else g.computeVertexNormals();group.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial()));centerObject(group)});
  return groups;
}
