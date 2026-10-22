// Manufacturing calculations use original STL dimensions and explicit slicer data.
export const PART_SLOTS={module:'body',roof:'body',baseplate:'body',guides:'body',label:'body',box:'box',slides:'box',facade:'front','facade-cap':'front',key:'accent','key-cap':'accent',springs:'accent',latch:'accent',stopper:'accent',rails:'accent'};
export const SLOT_NAMES={body:'Structure & inserts',front:'Facades & facade caps',box:'Drawer boxes & slides',accent:'Locks & small parts'};
// Nominal build volumes, checked against manufacturer specifications on 2026-10-22.
// Exclusions, brims and modified machines require custom usable dimensions.
// Nominal build volumes, checked against manufacturer specifications on 2026-10-22.
// Exclusions, brims and modified machines require custom usable dimensions.
export const PRINTER_PRESETS=[
  {name:'Bambu X1C / P1S',brand:'Bambu Lab',x:256,y:256,z:256,source:'https://wiki.bambulab.com/en/knowledge-sharing/print-volume-limitations'},
  {name:'Snapmaker U1',brand:'Snapmaker',x:270,y:270,z:270,source:'https://wiki.snapmaker.com/en/FAQ/u1'},
  {name:'180 mm cube · custom',brand:'Custom',x:180,y:180,z:180},
  {name:'250 × 210 × 220 mm · custom',brand:'Custom',x:250,y:210,z:220},
  {name:'350 mm cube · customize for your Voron',brand:'Custom',x:350,y:350,z:350},
  {name:'Bambu A1',brand:'Bambu Lab',x:256,y:256,z:256,source:'https://us.store.bambulab.com/products/a1'},
  {name:'Bambu A1 mini',brand:'Bambu Lab',x:180,y:180,z:180,source:'https://us.store.bambulab.com/products/a1-mini'},
  {name:'Bambu P2S',brand:'Bambu Lab',x:256,y:256,z:256,source:'https://blog.bambulab.com/the-icon-redefined-meet-the-p2s-a-completely-reengineered-version-of-the-ultra-productive-p1-series/'},
  {name:'Prusa MK4 / MK4S',brand:'Prusa',x:250,y:210,z:220,source:'https://www.prusa3d.com/p/prusa-3d-printers/'},
  {name:'Prusa MINI+',brand:'Prusa',x:180,y:180,z:180,source:'https://www.prusa3d.com/product/original-prusa-mini/'},
  {name:'Prusa CORE One / One+',brand:'Prusa',x:250,y:220,z:270,source:'https://www.prusa3d.com/product/prusa-core-one/'},
  {name:'Prusa XL',brand:'Prusa',x:360,y:360,z:360,source:'https://help.prusa3d.com/article/faq-frequently-asked-questions_1932?product=xl'},
  {name:'Elegoo Centauri Carbon',brand:'Elegoo',x:256,y:256,z:256,source:'https://www.elegoo.com/products/centauri-carbon'},
  {name:'Elegoo Neptune 4 Plus',brand:'Elegoo',x:320,y:320,z:385,source:'https://us.elegoo.com/products/neptune-4-plus-fdm-3d-printer'},
  {name:'Elegoo Neptune 4 Max',brand:'Elegoo',x:420,y:420,z:480,source:'https://us.elegoo.com/products/neptune-4-max-fdm-3d-printer'},
  {name:'Creality K1C',brand:'Creality',x:220,y:220,z:250,source:'https://www.creality.com/es/support/k1c-carbon-3d-printer'},
  {name:'Creality K1 Max',brand:'Creality',x:300,y:300,z:300,source:'https://www.creality.com/es/support/creality-k1-max-3d-printer'},
  {name:'Creality K2 Plus',brand:'Creality',x:350,y:350,z:350,source:'https://www.creality.com/products/creality-k2-plus-cfs-combo'},
  {name:'QIDI Plus4',brand:'QIDI',x:305,y:305,z:280,source:'https://us.qidi3d.com/pages/qidi-plus-4-techspecs'},
  {name:'Creality K1',brand:'Creality',x:220,y:220,z:250,source:'https://www.creality.com/mx/support/creality-k1-3d-printer'},
  {name:'Creality Ender-3 V3',brand:'Creality',x:220,y:220,z:250,source:'https://www.creality.com/fr/support/creality-ender-3-v3'},
  {name:'Anycubic Kobra S1',brand:'Anycubic',x:250,y:250,z:250,source:'https://wiki.anycubic.com/kobra-s1/anycubic_kobra_s1_combo_user_manual-es-v1.0.pdf'}
];
export const NOMINAL_FAMILIES=[['S',164.8],['M',254],['L',329.6],['XL',418.8]];
export const NOMINAL_FACADES=[['1F',47],['2F',95],['4F',191],['Sustainer 1F',61]];
export const NOMINAL_DEPTHS=[['x3',146],['x4',188],['x5',230],['x6',272],['x7',314]];

// Critical-angle solution for a rectangle, not a coarse angular sample. A rotated
// AABB is a conservative check: real contours may fit where this rectangle doesn't.
export function fitRectangle(x,y,z,printer){
  const width=printer.x-2*printer.clearance,height=printer.y-2*printer.clearance;
  const sizeAt=a=>[x*Math.cos(a)+y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)];
  const fitsAt=a=>{const [w,h]=sizeAt(a);return w<=width+1e-7&&h<=height+1e-7};
  const result=a=>({fits:z<=printer.z+1e-7&&fitsAt(a),bedFits:fitsAt(a),heightFits:z<=printer.z+1e-7,
    angle:a*180/Math.PI,footprint:sizeAt(a),usable:[width,height],size:[x,y,z]});
  if(![x,y,z,width,height,printer.z].every(n=>Number.isFinite(n)&&n>0))return {...result(0),fits:false,bedFits:false};
  if(fitsAt(0))return result(0);
  if(fitsAt(Math.PI/2))return result(Math.PI/2);
  const radius=Math.hypot(x,y),cuts=[0,Math.PI/2];
  for(const [limit,phase] of [[width,Math.atan2(y,x)],[height,Math.atan2(x,y)]]){
    if(limit>=radius)continue;
    const delta=Math.acos(limit/radius);
    for(const a of [phase-delta,phase+delta])if(a>0&&a<Math.PI/2)cuts.push(a);
  }
  cuts.sort((a,b)=>a-b);
  const candidates=[...cuts,...cuts.slice(1).map((a,i)=>(a+cuts[i])/2)];
  // Where both normalized extents are equal is also a possible optimum.
  const balance=Math.atan2(height*x-width*y,width*x-height*y);
  if(balance>0&&balance<Math.PI/2)candidates.push(balance);
  const feasible=candidates.filter(fitsAt);
  if(!feasible.length)return result(0);
  const score=a=>{const [w,h]=sizeAt(a);return Math.max(w/width,h/height)};
  feasible.sort((a,b)=>score(a)-score(b));return result(feasible[0]);
}

export function defaultFilament(){
  return {currency:'MXN',profile:'',allowancePercent:10,usage:{},spools:Object.fromEntries(Object.entries(SLOT_NAMES).map(([key,name])=>[key,{name,material:'PLA',density:1.24,diameter:1.75,pricePerKg:0,availableGrams:1000}]))};
}
export function sanitizeFilament(raw){
  const value=defaultFilament();
  if(!raw||typeof raw!=='object')return value;
  if(/^[A-Z]{3}$/.test(raw.currency))value.currency=raw.currency;
  value.profile=String(raw.profile||'').slice(0,120);
  if(Number.isFinite(raw.allowancePercent)&&raw.allowancePercent>=0&&raw.allowancePercent<=100)value.allowancePercent=raw.allowancePercent;
  for(const key of Object.keys(PART_SLOTS)){
    const grams=raw.usage?.[key];
    if(typeof grams==='number'&&Number.isFinite(grams)&&grams>=0&&grams<=100000)value.usage[key]=grams;
  }
  for(const key of Object.keys(value.spools)){
    const input=raw.spools?.[key];if(!input||typeof input!=='object')continue;
    for(const field of ['name','material'])if(typeof input[field]==='string')value.spools[key][field]=input[field].slice(0,60);
    for(const [field,min,max] of [['density',.1,10],['diameter',.5,4],['pricePerKg',0,100000],['availableGrams',0,100000]]){
      const n=input[field];if(typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max)value.spools[key][field]=n;
    }
  }
  return value;
}

export function summarizeFilament(state,parts){
  const settings=sanitizeFilament(state.filament),groups={};
  const rows=parts.map(part=>{
    const slot=PART_SLOTS[part.key],grams=settings.usage[part.key]??null;
    const totalGrams=grams===null?null:grams*part.quantity;
    const row={...part,slot,color:state.colors[slot],gramsPerFile:grams,totalGrams};
    const group=groups[slot]??={slot,...settings.spools[slot],color:state.colors[slot],knownGrams:0,missing:0};
    group.knownGrams+=totalGrams??0;group.missing+=grams===null?1:0;
    return row;
  });
  const values=Object.values(groups),missing=rows.filter(r=>r.gramsPerFile===null),knownGrams=values.reduce((n,g)=>n+g.knownGrams,0);
  for(const group of values){
    group.plannedGrams=group.missing?null:group.knownGrams*(1+settings.allowancePercent/100);
    group.cost=group.plannedGrams===null||group.pricePerKg<=0?null:group.plannedGrams*group.pricePerKg/1000;
    group.lengthMetres=group.plannedGrams===null?null:group.plannedGrams/(group.density*Math.PI*(group.diameter/2)**2);
    group.shortfallGrams=group.plannedGrams===null?null:Math.max(0,group.plannedGrams-group.availableGrams);
  }
  const complete=missing.length===0;
  return {basis:'Slicer-reported grams per complete STL, multiplied by file copies. No built-in slicing.',
    profile:settings.profile,currency:settings.currency,allowancePercent:settings.allowancePercent,complete,
    missing:missing.map(p=>p.key),knownGrams,totalGrams:complete?knownGrams:null,
    plannedGrams:complete?knownGrams*(1+settings.allowancePercent/100):null,
    totalCost:complete&&values.every(g=>g.cost!==null)?values.reduce((n,g)=>n+g.cost,0):null,rows,groups:values};
}

// Import the app's own CSV, identified by catalog IDs. No guessing by basename.
export function parseUsageCSV(text,parts){
  if(text.length>200000)throw new Error('Usage CSV exceeds 200 KB.');
  const rows=[];let row=[],field='',quoted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<=text.length;i++){
    const c=text[i]??'\n';
    if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++}else if(!quoted&&field!=='')throw new Error('Malformed CSV quotes.');else quoted=!quoted}
    else if(!quoted&&(c===','||c==='\n')){row.push(field.replace(/\r$/,''));field='';if(c==='\n'){if(row.some(v=>v!==''))rows.push(row);row=[]}}
    else field+=c;
  }
  if(quoted)throw new Error('Unclosed CSV quote.');
  const headers=rows.shift();if(!headers)throw new Error('Empty CSV.');
  const idIndex=headers.indexOf('Catalog ID'),gramsIndex=headers.indexOf('Grams per complete STL');
  if(idIndex<0||gramsIndex<0)throw new Error('Use the Download usage CSV template first.');
  const byID=new Map(parts.map(p=>[p.id,p.key])),usage={},seen=new Set();
  for(const record of rows){
    const id=record[idIndex],raw=record[gramsIndex]?.trim();
    if(!byID.has(id))throw new Error('CSV contains an unknown part ID.');
    if(seen.has(id))throw new Error('CSV contains a duplicate part ID.');seen.add(id);
    if(!raw)continue;
    const n=Number(raw);if(!Number.isFinite(n)||n<0||n>100000)throw new Error('Grams must be between 0 and 100,000.');
    usage[byID.get(id)]=n;
  }
  if(!Object.keys(usage).length)throw new Error('Enter grams in at least one CSV row.');
  return usage;
}
