import {DRAWER_WIDTHS,drawerHeight} from './families.js';
const PI=Math.PI;

// Coordinates in mm, Y up, Z out of the drawer. Each preview is centered on
// its source bounds. Anchors measured from STL planar faces and section loops:
// module's main faces Y=-95.3,+95.7 relative to source center; 192 mm stack pitch;
// facade screw/key row Y=72 and screws X=±92.45,±51.45 in the source XY plane;
// box: 143.8 deep, rear wall 3 mm, floor 3 mm; source height 181.5;
// roof: seating plane Y=-1.35 after Rx(180) Rz(-45).
export const M3={pitch:192,bodyCenterY:100.505,facadeCenterY:100.705,
  facadeCenterZ:78.23,keyY:28.705,boxCenterY:99.05,boxCenterZ:1.2,
  roofCenterY:197.55,travel:105,baseplateY:13.3};

export function assemblyLayout(state,{open=0,exploded=false,baseplateHeight=4}={}){
  const height=drawerHeight(state),width=DRAWER_WIDTHS[state.family||'M'],extraDepth=((state.depth||3)-3)*42;
  // Centered meshes have different heights across collection revisions. Seat
  // their lowest point on the box floor (8.3 mm bottom + 3 mm floor), rather
  // than burying taller baseplates at the old 4 mm sample's center height.
  const plateHeight=Number.isFinite(baseplateHeight)&&baseplateHeight>0?baseplateHeight:4;
  const profile={...M3,baseplateY:11.3+plateHeight/2,pitch:48*height,bodyCenterY:(48*height+9.009)/2,
    facadeCenterY:48*height/2+4.705,boxCenterY:(48*height-10.5)/2+8.3,
    facadeCenterZ:M3.facadeCenterZ+extraDepth/2,roofCenterY:48*height+5.55,
    travel:M3.travel+extraDepth};
  const widthDelta=(width-254)/2,records=[];
  function add(key,position,slot,rotation=[0,0,0],group='frame',level=0,confidence='feature-derived'){
    const y=level*(profile.pitch+(exploded?90:0));
    records.push({key,position:[position[0],position[1]+y,position[2]+(group==='drawer'?(Math.max(0,Math.min(1,open))*profile.travel+(exploded?95:0)):0)],rotation,slot,group,level,confidence});
  }
  state.layers.forEach((_,i)=>{
    const front=profile.facadeCenterZ+(exploded?50:0),lockZ=89.8+extraDepth/2+(exploded?95:0);
    add('module',[0,profile.bodyCenterY,0],'body',undefined,'frame',i);
    add('box',[0,profile.boxCenterY,profile.boxCenterZ],'box',[-PI/2,0,PI],'drawer',i);
    add('facade',[0,profile.facadeCenterY,front],'front',[0,0,PI],'drawer',i);
    add('key',[0,profile.keyY,lockZ],'accent',undefined,'drawer',i);
    add('key-cap',[0,profile.keyY,100.7+extraDepth/2+(exploded?115:0)],'accent',undefined,'drawer',i,'diagram-inferred');
    add('label',[-84.7*width/254,profile.keyY,front+5.8+(exploded?25:0)],'body',[0,0,PI],'drawer',i,'diagram-inferred');
    for(const [x,y] of [[-92.45,profile.keyY],[-51.45,profile.keyY],[51.45,profile.keyY],[92.45,profile.keyY],...(height===1?[]:[[-92.45,profile.keyY+profile.pitch-48],[92.45,profile.keyY+profile.pitch-48]])]){
      add('facade-cap',[x*width/254,y,front+4.5+(exploded?20:0)],'front',undefined,'drawer',i);
    }
    if(state.baseplate)add('baseplate',[0,profile.baseplateY+(exploded?65:0),profile.boxCenterZ],'body',[-PI/2,0,0],'drawer',i);
    for(let side=0;side<2;side++){
      const sign=side===0?-1:1;
      add('guides-'+side,[sign*(117+widthDelta+(exploded?35:0)),21.7,0],'body',[PI/2,PI/2,0],'frame',i,'diagram-inferred');
      add('slides-'+side,[sign*(113.5+widthDelta),19.5,11.5],'box',[PI/2,PI/2,0],'drawer',i,'diagram-inferred');
      add('stopper',[sign*(121+widthDelta),21.7,65+extraDepth/2],'accent',[PI/2,0,0],'frame',i,'diagram-inferred');
      // Each source spring is 47.47 x 37 mm, matching the facade's 37 mm
      // recess height. Its long axis remains horizontal, without a 90° turn.
      add('springs-'+side,[sign*44.4,profile.keyY,front-1.5-(exploded?25:0)],'accent',[0,0,side===0?PI:0],'drawer',i,'diagram-inferred');
      if(state.rails)add('rails-'+side,[0,profile.keyY+sign*18,front-3],'accent',undefined,'drawer',i,'diagram-inferred');
    }
    add('latch',[0,4-(exploded?22:0),-7],'accent',[PI/2,0,0],'frame',i,'diagram-inferred');
  });
  if(state.roof!=='none')add('roof',[0,profile.roofCenterY+(exploded?110:0),0],'body',state.normalizedAssets?[PI,0,0]:[PI,0,-PI/4],'frame',state.layers.length-1);
  return records;
}

// Fit the actual camera-facing extents rather than guessing from world width.
export function fitCameraToBox(THREE,camera,controls,box,aspect,{padding=1.2,viewDirection=null}={}){
  const center=box.getCenter(new THREE.Vector3());
  const direction=(viewDirection?viewDirection.clone():new THREE.Vector3(.95,.65,1.3)).normalize();
  camera.position.copy(center).addScaledVector(direction,1000);camera.lookAt(center);camera.updateMatrixWorld(true);
  const corners=[];
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])corners.push(new THREE.Vector3(x,y,z));
  const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion),up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
  const projected=corners.map(v=>v.sub(center));
  if(camera.isOrthographicCamera){
    const halfHeight=Math.max(...projected.map(v=>Math.abs(v.dot(up))),...projected.map(v=>Math.abs(v.dot(right))/aspect))*padding;
    camera.top=halfHeight;camera.bottom=-halfHeight;camera.left=-halfHeight*aspect;camera.right=halfHeight*aspect;camera.zoom=1;
    const distance=box.getSize(new THREE.Vector3()).length()*2+100;
    camera.position.copy(center).addScaledVector(direction,distance);
  }else{
    camera.aspect=aspect;const tanY=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),tanX=tanY*aspect;
    const distance=Math.max(...projected.map(v=>Math.max(Math.abs(v.dot(up))/tanY,Math.abs(v.dot(right))/tanX)*padding+v.dot(direction)));
    camera.position.copy(center).addScaledVector(direction,distance);
  }
  controls.target.copy(center);camera.updateProjectionMatrix();controls.update();camera.updateMatrixWorld(true);
}
