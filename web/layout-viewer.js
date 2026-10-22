import * as THREE from 'three';
import {OrbitControls} from './vendor/controls/OrbitControls.js';
import {GLTFLoader} from './vendor/loaders/GLTFLoader.js';
import {orientPart,splitPair} from './assembly-geometry.js';
import {prepareDisplayGeometry,STUDIO_MATERIAL} from './rendering.js';
import {DRAWER_WIDTHS,requiredPreviewKeys} from './families.js';
import {fitCameraToBox} from './assembly.js';
import {layoutInstances,instancePlacement} from './layout.js';

export class LayoutViewer{
  constructor(element,onSelect=()=>{}){
    this.element=element;this.onSelect=onSelect;this.cache=new Map();this.sequence=0;this.ready=false;this.open=0;this.exploded=false;this.view='iso';
    try{
      this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
      this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1;
      element.append(this.renderer.domElement);this.scene=new THREE.Scene();this.camera=new THREE.OrthographicCamera(-300,300,300,-300,.1,12000);
      this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.maxPolarAngle=Math.PI*.49;this.controls.minDistance=40;this.controls.maxDistance=6000;this.controls.addEventListener('change',()=>this.render());
      this.scene.add(new THREE.HemisphereLight(0xffffff,0x7e8793,2));this.scene.add(new THREE.AmbientLight(0xffffff,.35));
      const light=new THREE.DirectionalLight(0xffffff,2.4);light.position.set(-500,900,700);this.scene.add(light);
      this.grid=new THREE.GridHelper(2400,80,0x4c5562,0x353b45);this.grid.position.y=-4;this.grid.material.transparent=true;this.grid.material.opacity=.45;this.scene.add(this.grid);
      this.root=new THREE.Group();this.scene.add(this.root);this.loader=new GLTFLoader();this.ready=true;
      new ResizeObserver(()=>this.resize()).observe(element);
      let down=null;this.renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY]});
      this.renderer.domElement.addEventListener('pointerup',e=>{
        if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;
        const box=this.renderer.domElement.getBoundingClientRect(),pointer=new THREE.Vector2((e.clientX-box.left)/box.width*2-1,-(e.clientY-box.top)/box.height*2+1),ray=new THREE.Raycaster();ray.setFromCamera(pointer,this.camera);
        const hit=ray.intersectObjects(this.root.children,true).find(h=>h.object.isMesh);
        if(hit?.object.userData.rowId)this.onSelect(hit.object.userData.rowId);
      });
      this.resize();
    }catch(e){this.error=e.name;this.ready=false;this.renderer?.dispose()}
  }
  render(){if(!this.ready||this.pending)return;this.pending=true;requestAnimationFrame(()=>{this.pending=false;this.renderer.render(this.scene,this.camera)})}
  resize(){if(!this.ready)return;const {width,height}=this.element.getBoundingClientRect();if(!width||!height)return;this.renderer.setSize(width,height,false);this.fit()}
  fit(){if(!this.ready||!this.root.children.length)return;const b=new THREE.Box3().setFromObject(this.root);if(b.isEmpty())return;
    const directions={iso:[.95,.65,1.3],front:[0,.001,1],side:[1,.001,0]};const {width,height}=this.element.getBoundingClientRect();
    fitCameraToBox(THREE,this.camera,this.controls,b,Math.max(.1,width/Math.max(1,height)),{padding:1.18,viewDirection:new THREE.Vector3(...directions[this.view])});this.render()}
  setView(view){this.view=view;this.fit()}
  clear(){
    while(this.root.children.length){const child=this.root.children[0];this.root.remove(child);child.traverse(o=>{if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()}if(o.userData.temporaryGeometry)o.geometry?.dispose()})}
  }
  async prepare(state,models,sources){
    const width=DRAWER_WIDTHS[state.family],extra=(state.depth-3)*42;
    const dims={module:{width,height:state.height*48+9.009,uprightShell:true},box:{width:width-30.6,height:143.8+extra,heavySideBelow:true},facade:{width,height:state.height*48-1},
      roof:{width},baseplate:{width:width-39.3,height:134+extra},guides:{width:55.65,height:143.5+extra},slides:{width:38.6,height:118+extra},rails:{width:width-88.35}};
    const assets=new Map();
    const source=async url=>{if(!sources.has(url))sources.set(url,this.loader.loadAsync(url).then(g=>g.scene));return sources.get(url)};
    try{
      await Promise.all(requiredPreviewKeys(state).map(async key=>{
        const raw=await source(models[key].url),obj=dims[key]?orientPart(raw,dims[key]):raw.clone(true);assets.set(key,obj);
        if(['guides','slides','rails','springs'].includes(key))splitPair(obj,['rails','springs'].includes(key)?'y':'x').forEach((part,i)=>assets.set(key+'-'+i,part));
      }));
      for(const obj of assets.values())obj.traverse(m=>{if(m.isMesh)m.geometry=prepareDisplayGeometry(m.geometry)});
      return assets;
    }catch(e){this.disposeAssets(assets);throw e}
  }
  disposeAssets(assets,retained=new Set()){const seen=new Set();for(const obj of assets.values())obj.traverse(m=>{if(m.geometry&&!seen.has(m.geometry)&&!retained.has(m.geometry)){seen.add(m.geometry);m.geometry.dispose()}})}
  async update(plan,result,selected){
    this.plan=plan;this.result=result;this.selected=selected;if(!this.ready)return {missing:[],schematic:result.description.modules,webgl:false};
    const sequence=++this.sequence,sources=new Map(),active=new Set(),rowAssets=new Map(),errors=[];
    await Promise.all(plan.rows.map(async row=>{
      const instance=layoutInstances(plan).find(i=>i.rowId===row.id),models=result.resolved.get(row.id);
      if(!models||requiredPreviewKeys(instance.state).some(k=>!models[k]?.url))return;
      const key=JSON.stringify([instance.state.family,plan.depth,row.height,row.roof,row.baseplate,row.rails,requiredPreviewKeys(instance.state).map(k=>models[k].url)]);active.add(key);
      if(!this.cache.has(key))this.cache.set(key,this.prepare(instance.state,models,sources).catch(e=>{this.cache.delete(key);throw e}));
      try{rowAssets.set(row.id,await this.cache.get(key))}catch(e){errors.push({rowId:row.id,errorType:e.name})}
    }));
    if(sequence!==this.sequence)return null;
    this.rowAssets=rowAssets;this.draw();
    const retained=new Set();for(const assets of rowAssets.values())for(const obj of assets.values())obj.traverse(m=>{if(m.geometry)retained.add(m.geometry)});
    for(const [key,promise] of this.cache)if(!active.has(key)){this.cache.delete(key);promise.then(assets=>this.disposeAssets(assets,retained)).catch(()=>{})}
    this.fit();return {errors,schematic:layoutInstances(plan).filter(i=>!rowAssets.has(i.rowId)).length,webgl:true};
  }
  draw(){
    if(!this.ready||!this.plan)return;this.clear();
    for(const instance of layoutInstances(this.plan,{exploded:this.exploded})){
      const group=new THREE.Group(),assets=this.rowAssets?.get(instance.rowId);group.userData.rowId=instance.rowId;this.root.add(group);
      if(assets){
        const plate=assets.get('baseplate'),baseplateHeight=plate?new THREE.Box3().setFromObject(plate,true).getSize(new THREE.Vector3()).z:4;
        for(const record of instancePlacement(instance,{open:this.open,exploded:this.exploded,baseplateHeight})){
          const source=assets.get(record.key);if(!source)continue;const object=source.clone(true);object.name=record.key;object.position.set(...record.position);object.rotation.set(...record.rotation);
          object.traverse(mesh=>{if(mesh.isMesh){mesh.material=new THREE.MeshStandardMaterial({...STUDIO_MATERIAL,color:this.plan.colors[record.slot],side:THREE.DoubleSide});mesh.userData.rowId=instance.rowId}});group.add(object);
        }
      }else{
        const geometry=new THREE.BoxGeometry(instance.width,instance.height,146+(this.plan.depth-3)*42),mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x929aa5,wireframe:true,transparent:true,opacity:.65}));
        mesh.position.set(instance.position[0],instance.position[1]+instance.height/2,0);mesh.userData={rowId:instance.rowId,temporaryGeometry:true};group.add(mesh);
      }
      if(instance.rowId===this.selected){const highlight=new THREE.Box3Helper(new THREE.Box3().setFromObject(group),0xff8038);highlight.userData.temporaryGeometry=true;group.add(highlight)}
    }this.render();
  }
  select(rowId){this.selected=rowId;this.draw()}
  motion({open=this.open,exploded=this.exploded}={}){this.open=open;this.exploded=exploded;this.draw();this.fit()}
}
