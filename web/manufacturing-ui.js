import {PART_SLOTS,SLOT_NAMES,PRINTER_PRESETS,NOMINAL_FAMILIES,NOMINAL_FACADES,NOMINAL_DEPTHS,fitRectangle,summarizeFilament,parseUsageCSV} from './manufacturing.js';

export function createManufacturingUI({getState,getModels,getParts,esc,persist,onPrinterChange,onColorChange,download,toast,showPreview}){
  const $=s=>document.querySelector(s);let selectedPart='module',nominal=null;
  const decimal=n=>n.toLocaleString(undefined,{maximumFractionDigits:1});
  const money=(n,currency)=>new Intl.NumberFormat(undefined,{style:'currency',currency}).format(n);
  const csv=rows=>'\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
  const fitLabel=f=>!f.heightFits?'Too tall':!f.bedFits?'Too large':f.angle>.05&&f.angle<89.95?'Angled · '+f.angle.toFixed(2)+'°':'Fits · '+Math.round(f.angle)+'°';
  const fitClass=f=>!f.fits?'fit-no':f.angle>.05&&f.angle<89.95?'fit-angle':'fit-yes';
  function renderPrinterOptions(){
    const selected=$('#printer-preset').value||'custom',query=$('#printer-search').value.trim().toLowerCase();
    const custom=document.createElement('option');custom.value='custom';custom.textContent='Custom volume';$('#printer-preset').replaceChildren(custom);
    const groups=new Map();let matches=0;
    PRINTER_PRESETS.forEach((p,i)=>{
      const matching=(p.brand+' '+p.name).toLowerCase().includes(query);
      if(!matching&&String(i)!==selected)return;
      if(matching)matches++;
      if(!groups.has(p.brand)){const group=document.createElement('optgroup');group.label=p.brand;groups.set(p.brand,group);$('#printer-preset').append(group)}
      const option=document.createElement('option');option.value=String(i);option.textContent=`${p.name} · ${p.x} × ${p.y} × ${p.z} mm`;groups.get(p.brand).append(option);
    });
    $('#printer-preset').value=selected;
    $('#printer-preset-note').textContent=query?`${matches} matching presets. Custom volume is always available.`:`${PRINTER_PRESETS.length} presets, including editable custom sizes.`;
  }
  function renderPrinterSource(){
    const value=$('#printer-preset').value,p=value==='custom'?null:PRINTER_PRESETS[Number(value)],link=$('#printer-source');
    link.hidden=!p?.source;
    if(p?.source)link.href=p.source;else link.removeAttribute('href');
  }
  // Use DOM creation so the controller also works in a test DOM.
  renderPrinterOptions();renderPrinterSource();
  $('#printer-search').oninput=()=>{renderPrinterOptions();renderPrinterSource()};
  function savePrinter(quiet=false){
    const p={name:$('#printer-name').value.trim().slice(0,60)||'My printer'};
    for(const key of ['x','y','z']){p[key]=Number($('#printer-'+key).value);if(!Number.isFinite(p[key])||p[key]<50||p[key]>1000){if(!quiet)toast('Enter 50–1,000 mm on each axis.');return}}
    p.clearance=Number($('#clearance').value);if(!Number.isFinite(p.clearance)||p.clearance<0||p.clearance>30){if(!quiet)toast('Clearance must be 0–30 mm per side.');return}
    getState().printer=p;persist();onPrinterChange();if(!quiet)toast('Printer saved. Bed fit updated.');
  }
  $('#save-printer').onclick=()=>savePrinter();
  for(const id of ['printer-name','printer-x','printer-y','printer-z','clearance'])$('#'+id).oninput=()=>{$('#printer-preset').value='custom';renderPrinterSource();savePrinter(true)};
  $('#printer-preset').onchange=e=>{
    renderPrinterSource();const preset=PRINTER_PRESETS[Number(e.target.value)];if(e.target.value==='custom'||!preset)return;
    $('#printer-name').value=preset.name;for(const k of ['x','y','z'])$('#printer-'+k).value=preset[k];savePrinter(true);
  };
  $('#fit-part').onchange=e=>{if(!e.target.value)return;selectedPart=e.target.value;nominal=null;renderBed()};

  function renderBed(){
    const state=getState(),models=getModels();if(!models.module)return;
    const parts=getParts(),p=state.printer;
    if(!parts.some(part=>part.key===selectedPart))selectedPart='module';
    $('#fit-part').innerHTML='<option value="">Choose an original STL…</option>'+parts.map(part=>`<option value="${part.key}">${esc(part.title)}</option>`).join('');
    $('#fit-part').value=nominal?'':selectedPart;
    let size,title;
    if(nominal){size=[nominal.width,nominal.height,0.001];title=nominal.title+' · nominal footprint'}else{size=models[selectedPart].printSize;title=models[selectedPart].name}
    if(!size){
      $('#bed-diagram').textContent='Dimensions not imported for this STL.';$('#bed-verdict').textContent='Fit not yet measured';$('#bed-detail').textContent=title;
      $('#fit-results').innerHTML=parts.map(part=>`<tr><td>${esc(part.name)}</td><td>${models[part.key].printSize?.map(decimal).join(' × ')||'Not measured'}</td><td>Import dimensions to check fit</td></tr>`).join('');return;
    }
    const fit=fitRectangle(...size,p),angle=fit.angle*Math.PI/180;
    // SVG uses exact millimetre coordinates; the inset dashed box is usable space.
    const extent=Math.max(p.x,p.y,...fit.footprint)*1.16,scale=260/extent;
    const w=p.x*scale,h=p.y*scale,partW=size[0]*scale,partH=size[1]*scale,margin=p.clearance*scale;
    $('#bed-diagram').innerHTML=`<svg viewBox="0 0 360 330" role="img" aria-label="${esc(title)} on a ${p.x} by ${p.y} mm bed"><rect x="${180-w/2}" y="${155-h/2}" width="${w}" height="${h}" fill="#e3eada" stroke="#859b72"/><rect x="${180-w/2+margin}" y="${155-h/2+margin}" width="${Math.max(0,w-2*margin)}" height="${Math.max(0,h-2*margin)}" fill="none" stroke="#859b72" stroke-dasharray="5 4"/><g transform="translate(180 155) rotate(${fit.angle})"><rect x="${-partW/2}" y="${-partH/2}" width="${partW}" height="${partH}" fill="${fit.fits?'#e7c765':'#d58a78'}" fill-opacity=".8" stroke="${fit.fits?'#866b2b':'#9c473b'}"/></g><text x="180" y="305" text-anchor="middle" fill="#52664a" font-size="13">Bed ${p.x} × ${p.y} mm · clearance ${p.clearance} mm / side</text></svg>`;
    $('#bed-verdict').textContent=(nominal?'Bed footprint: ':'Complete STL: ')+fitLabel(fit);
    $('#bed-detail').textContent=`${title} · ${size.slice(0,nominal?2:3).map(decimal).join(' × ')} mm`+(nominal?' · Check Z and complete STLs separately.':` · Z limit ${p.z} mm. Suggested in-plane rotation ${fit.angle.toFixed(2)}°.`);
    $('#nominal-head').innerHTML='<tr><th>Family</th>'+NOMINAL_FACADES.map(([name,height])=>`<th>${name}<br>${height} mm</th>`).join('')+'</tr>';
    $('#nominal-body').innerHTML='';
    for(const [family,width] of NOMINAL_FAMILIES){
      const tr=document.createElement('tr');tr.innerHTML=`<td><strong>${family}</strong><small>${width} mm wide</small></td>`;
      for(const [name,height] of NOMINAL_FACADES){
        const f=fitRectangle(width,height,.001,p),td=document.createElement('td'),b=document.createElement('button');
        b.className=fitClass(f)+(nominal?.title===family+' / '+name?' selected':'');b.textContent=fitLabel(f).replace('Fits · 0°','Fits').replace('Fits · 90°','Fits');
        b.setAttribute('aria-label',`${family} ${name}: ${fitLabel(f)}`);b.setAttribute('aria-pressed',String(nominal?.title===family+' / '+name));
        b.onclick=()=>{nominal={width,height,title:family+' / '+name};renderBed()};td.append(b);tr.append(td);
      }
      $('#nominal-body').append(tr);
    }
    $('#depth-checks').innerHTML=NOMINAL_DEPTHS.map(([name,depth])=>`<span class="${depth<=p.z?'fit-yes':'fit-no'}">${name} · ${depth} mm · ${depth<=p.z?'Fits Z':'Too tall'}</span>`).join('');
    $('#fit-results').innerHTML='';
    for(const part of parts){
      const size=models[part.key].printSize,f=size?fitRectangle(...size,p):null,tr=document.createElement('tr');
      tr.innerHTML=`<td><button class="fit-part-button">${esc(part.name)}</button></td><td>${size?.map(decimal).join(' × ')||'Not measured'}</td><td><span class="tag ${f?fitClass(f):'fit-no'}">${f?fitLabel(f):'Not measured'}</span></td>`;
      tr.querySelector('button').onclick=()=>{nominal=null;selectedPart=part.key;renderBed()};$('#fit-results').append(tr);
    }
  }

  function renderTotals(){
    const state=getState();if(!getModels().module)return;
    const result=summarizeFilament(state,getParts());
    $('#filament-summary').innerHTML=`<div class="filament-totals"><div><strong>${result.complete?decimal(result.totalGrams)+' g':'Incomplete'}</strong><span>${result.complete?'Slicer usage × copies':result.missing.length+' unique STL weights missing'}</span></div><div><strong>${result.complete?decimal(result.plannedGrams)+' g':'—'}</strong><span>With ${result.allowancePercent}% planning allowance</span></div><div><strong>${result.totalCost===null?'—':money(result.totalCost,result.currency)}</strong><span>Filament cost including allowance</span></div></div>`+
      `<div class="filament-groups">${result.groups.map(g=>`<div class="filament-group"><strong><i class="color-dot" style="background:${g.color}"></i>${esc(g.name)}</strong><br>${g.missing?`${decimal(g.knownGrams)} g known · ${g.missing} weights missing`:`${decimal(g.plannedGrams)} g planned · ≈${decimal(g.lengthMetres)} m · ${g.cost===null?'Add price for cost':money(g.cost,result.currency)}<br>${g.shortfallGrams>0?decimal(g.shortfallGrams)+' g more needed':'Enough remaining filament entered'} (${decimal(g.availableGrams)} g entered)`}</div>`).join('')}</div>`;
    $('#filament-mini').textContent=result.complete?`Filament: ${decimal(result.plannedGrams)} g across ${result.groups.length} groups, including ${result.allowancePercent}% allowance.`:`Filament: ${result.missing.length} STL weights needed. ${decimal(result.knownGrams)} g currently accounted for.`;
    for(const r of result.rows){const cell=$(`#usage-total-${r.key}`);if(cell)cell.textContent=r.totalGrams===null?'—':decimal(r.totalGrams)}
  }
  function renderFilament(){
    const state=getState();
    $('#slicing-profile').value=state.filament.profile;$('#filament-currency').value=state.filament.currency;$('#filament-allowance').value=state.filament.allowancePercent;
    $('#filament-profiles').innerHTML='';
    for(const [slot,title] of Object.entries(SLOT_NAMES)){
      const spool=state.filament.spools[slot],card=document.createElement('section');card.className='filament-profile';
      card.innerHTML=`<h3>${title}</h3><div class="profile-fields"><label>Filament name<input data-field="name" maxlength="60" value="${esc(spool.name)}"></label><label>Preview color<input type="color" data-field="color" value="${state.colors[slot]}"></label><label>Material<input data-field="material" maxlength="60" value="${esc(spool.material)}"></label><label>Price / kg · ${state.filament.currency}<input type="number" data-field="pricePerKg" min="0" max="100000" step="0.01" value="${spool.pricePerKg}"></label><label>Remaining filament · g<input type="number" data-field="availableGrams" min="0" max="100000" step="1" value="${spool.availableGrams}"></label><label>Diameter · mm<input type="number" data-field="diameter" min="0.5" max="4" step="0.01" value="${spool.diameter}"></label><label>Density · g/cm³<input type="number" data-field="density" min="0.1" max="10" step="0.01" value="${spool.density}"></label></div><p class="field-help">Density and diameter convert grams to length. Enter your filament’s values. Weights must come from slicing with the selected material.</p>`;
      card.querySelectorAll('input').forEach(input=>input.oninput=()=>{
        const s=getState(),field=input.dataset.field;
        if(field==='color'){s.colors[slot]=input.value;$('#color-'+slot).value=input.value;onColorChange()}
        else if(['name','material'].includes(field))s.filament.spools[slot][field]=input.value;
        else{const n=Number(input.value);if(input.value===''||!input.checkValidity()||!Number.isFinite(n))return;s.filament.spools[slot][field]=n}
        persist();renderTotals();
      });
      $('#filament-profiles').append(card);
    }
    $('#filament-usage').innerHTML='';
    if(!getModels().module)return;
    for(const part of getParts()){
      const slot=PART_SLOTS[part.key],tr=document.createElement('tr');
      tr.innerHTML=`<td><strong>${esc(part.title)}</strong><small>${esc(part.name)}</small></td><td>${SLOT_NAMES[slot]}</td><td>×${part.quantity}</td><td><input aria-label="Grams for ${esc(part.name)}" type="number" min="0" max="100000" step="0.01" placeholder="Not entered" value="${state.filament.usage[part.key]??''}"></td><td id="usage-total-${part.key}">—</td>`;
      const input=tr.querySelector('input');input.oninput=()=>{
        const usage=getState().filament.usage;
        if(input.value==='')delete usage[part.key];else{const n=Number(input.value);if(!input.checkValidity()||!Number.isFinite(n))return;usage[part.key]=n}
        persist();renderTotals();
      };$('#filament-usage').append(tr);
    }
    renderTotals();
  }
  $('#slicing-profile').oninput=e=>{getState().filament.profile=e.target.value;persist()};
  $('#filament-allowance').oninput=e=>{const n=Number(e.target.value);if(e.target.value===''||!e.target.checkValidity()||!Number.isFinite(n))return;getState().filament.allowancePercent=n;persist();renderTotals()};
  $('#filament-currency').onchange=e=>{getState().filament.currency=e.target.value;persist();renderFilament()};
  $('#preview-colors').onclick=showPreview;
  $('#usage-template').onclick=()=>{
    if(!getModels().module)return;
    download('VAULT-usage-template.csv',csv([['Catalog ID','File','Grams per complete STL'],...getParts().map(p=>[p.id,p.path,getState().filament.usage[p.key]??''])]),'text/csv;charset=utf-8');
  };
  $('#import-usage').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    try{
      if(file.size>200000)throw new Error('Usage CSV exceeds 200 KB.');
      const usage=parseUsageCSV(await file.text(),getParts());Object.assign(getState().filament.usage,usage);persist();renderFilament();toast('Slicer weights imported. Totals updated for this design.');
    }catch(error){toast(error.message)}finally{e.target.value=''}
  };
  $('#export-filament').onclick=()=>{if(getModels().module)download('VAULT-filament-plan.json',JSON.stringify(summarizeFilament(getState(),getParts()),null,2))};
  return {render(){renderBed();renderFilament()},sync(){const p=getState().printer;const index=PRINTER_PRESETS.findIndex(v=>v.name===p.name&&['x','y','z'].every(k=>v[k]===p[k]));$('#printer-search').value='';renderPrinterOptions();$('#printer-preset').value=index<0?'custom':String(index);renderPrinterSource();renderBed();renderFilament()}};
}
