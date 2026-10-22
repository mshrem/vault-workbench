import {LayoutViewer} from './layout-viewer.js';
import {createLayoutUI} from './layout-ui.js';
function download(name,data,type){
  const blob=data instanceof Blob?data:new Blob([data],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
const viewer=new LayoutViewer(document.getElementById('layout-viewer'));
const app=createLayoutUI({document,fetch,storage:localStorage,viewer,download});viewer.onSelect=app.select;
function diagnostic(event,errorType){fetch('api/diagnostics/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event,errorType})}).catch(()=>{})}
if(!viewer.ready)diagnostic('webgl_unavailable',viewer.error||'Error');
window.addEventListener('error',e=>diagnostic('javascript_error',e.error?.name||'Error'));
window.addEventListener('unhandledrejection',e=>diagnostic('promise_rejection',e.reason?.name||'Error'));
