// Run before styles load so a saved dark theme never flashes a light page.
(()=>{
  const key='vault-theme-v1';
  let saved;try{saved=localStorage.getItem(key)}catch{}
  let manual=saved==='dark'||saved==='light';
  function apply(theme){
    const dark=theme==='dark';document.documentElement.dataset.theme=dark?'dark':'light';
    const button=document.getElementById('theme-toggle');
    if(button){
      button.setAttribute('aria-checked',String(dark));
      button.title=dark?'Switch to light theme':'Switch to dark theme';
      button.querySelector('[data-theme-icon]').textContent=dark?'☀':'☾';
      button.querySelector('[data-theme-label]').textContent=dark?'Light theme':'Dark theme';
    }
    window.dispatchEvent(new CustomEvent('vault-theme-change',{detail:{theme:dark?'dark':'light'}}));
  }
  apply(manual?saved:'dark');
  function bind(){
    const button=document.getElementById('theme-toggle');if(!button)return;
    apply(document.documentElement.dataset.theme);
    button.onclick=()=>{
      const next=document.documentElement.dataset.theme==='dark'?'light':'dark';manual=true;
      try{localStorage.setItem(key,next)}catch{}
      apply(next);
    };
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
  window.addEventListener('storage',event=>{
    if(event.key!==key&&event.key!==null)return;
    const next=event.key===key?event.newValue:null;manual=next==='light'||next==='dark';
    apply(manual?next:'dark');
  });
})();
