import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createManufacturingUI} from '../web/manufacturing-ui.js';
import {DEFAULT_STATE,billOfMaterials} from '../web/core.js';

// For development only: npm install, or point VAULT_TEST_NODE_MODULES at jsdom.
const require=createRequire(import.meta.url);
const {JSDOM}=process.env.VAULT_TEST_NODE_MODULES
  ? require(require.resolve('jsdom',{paths:[process.env.VAULT_TEST_NODE_MODULES]})) : require('jsdom');
const models=JSON.parse(fs.readFileSync(new URL('./fixtures/models.json',import.meta.url)));

test('bed and filament controllers render and accept real DOM input events',async()=>{
  const dom=new JSDOM(fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8'),{url:'http://localhost:8787'});
  const oldDocument=globalThis.document;globalThis.document=dom.window.document;
  try{
    const state=structuredClone(DEFAULT_STATE),$=s=>document.querySelector(s),downloads=[];let colors=0;
    const input=(element,value)=>{element.value=value;element.dispatchEvent(new dom.window.Event('input',{bubbles:true}))};
    let ui;
    ui=createManufacturingUI({getState:()=>state,getModels:()=>models,getParts:()=>billOfMaterials(state,models),
      esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),persist(){},
      onPrinterChange(){ui.render()},onColorChange(){colors++},download:(...args)=>downloads.push(args),toast(){},showPreview(){colors++}});
    for(const k of ['x','y','z'])$('#printer-'+k).value=state.printer[k];$('#clearance').value=0;
    ui.sync();
    assert.equal(document.querySelectorAll('#nominal-body tr').length,4);
    assert.equal(document.querySelectorAll('#filament-profiles .filament-profile').length,4);
    assert.equal(document.querySelectorAll('#filament-usage tr').length,billOfMaterials(state,models).length);
    assert($('#bed-diagram svg'));assert($('#filament-summary').textContent.includes('Incomplete'));
    $('#printer-preset').value='1';$('#printer-preset').dispatchEvent(new dom.window.Event('change'));
    assert.equal(state.printer.name,'Snapmaker U1');assert.equal(state.printer.x,270);
    assert($('#bed-detail').textContent.includes('Z limit 270'));
    input($('#printer-search'),'P2S');
    const presetOptions=[...$('#printer-preset').options];
    assert(presetOptions.some(o=>o.textContent.includes('Bambu P2S')));
    assert(!presetOptions.some(o=>o.textContent.includes('Prusa')));
    assert(presetOptions.some(o=>o.value==='custom'));
    $('#printer-preset').value=presetOptions.find(o=>o.textContent.includes('Bambu P2S')).value;
    $('#printer-preset').dispatchEvent(new dom.window.Event('change'));
    assert.equal(state.printer.name,'Bambu P2S');assert.equal(state.printer.x,256);
    assert.equal($('#printer-source').hidden,false);assert($('#printer-source').href.startsWith('https://blog.bambulab.com/'));
    input($('#printer-x'),'240');assert.equal(state.printer.x,240);assert.equal($('#printer-preset').value,'custom');assert.equal($('#printer-source').hidden,true);
    input($('#printer-search'),'not-a-real-printer');assert.equal($('#printer-preset').options.length,1);assert($('#printer-preset-note').textContent.includes('0 matching'));
    input($('#printer-x'),'0');assert.equal(state.printer.x,240,'invalid dimensions must not overwrite saved printer');
    input($('#printer-x'),'256');
    const nominalButton=document.querySelectorAll('#nominal-body tr')[1].querySelector('button');nominalButton.click();
    assert($('#bed-detail').textContent.includes('M / 1F · nominal footprint'));
    $('#fit-part').value='module';$('#fit-part').dispatchEvent(new dom.window.Event('change'));
    assert($('#bed-detail').textContent.includes('M3 Module 4F.stl'));
    input(document.querySelector('#filament-profiles input[data-field=color]'),'#123456');
    assert.equal(state.colors.body,'#123456');assert.equal($('#color-body').value,'#123456');assert.equal(colors,1);
    for(const element of document.querySelectorAll('#filament-usage input'))input(element,'10');
    assert(!$('#filament-summary').textContent.includes('Incomplete'));
    assert(state.filament.usage.module===10);assert.equal($('#usage-total-facade-cap').textContent,'60');
    const before=$('#filament-mini').textContent;state.layers.push({label:'second'});ui.render();
    assert.notEqual($('#filament-mini').textContent,before);assert.equal($('#usage-total-facade-cap').textContent,'120');
    $('#export-filament').click();assert.equal(downloads[0][0],'VAULT-filament-plan.json');assert.equal(JSON.parse(downloads[0][1]).complete,true);
    $('#usage-template').click();assert(downloads[1][1].includes('Catalog ID'));
  }finally{globalThis.document=oldDocument;dom.window.close()}
});
