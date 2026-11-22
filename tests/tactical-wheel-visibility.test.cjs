'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8');
// Resolve declarations on the named component roots, including shared selectors.
function declarations(css,selector){
  const result={};
  for(const [,selectors,body]of css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g)){
    if(!selectors.split(',').some(value=>value.trim()===selector))continue;
    for(const field of body.split(';')){
      const colon=field.indexOf(':');
      if(colon>=0)result[field.slice(0,colon).trim()]=field.slice(colon+1).trim();
    }
  }
  return result;
}
for(const [name,file,prefix]of [
  ['trial','styles/tactical-quarter-weapons.css','#tactical-combat.tc-quarter-layout.tc-modern-weapon-wheel'],
  ['dungeon','styles/dungeon-trial-wheel.css','#dungeon-map-view.tc-quarter-layout .dm-modern-weapon-wheel']
]){
  test(name+': opaque hit sectors cannot cover tracks or either sliding thumb',()=>{
    const css=read(file),style=part=>declarations(css,prefix+' '+part);
    const z=part=>Number(style(part)['z-index']);
    assert.equal(style('.tc-rw-guides').display,'block','rail SVG must be visible');
    for(const part of ['.tc-rw-outer','.tc-rw-inner'])
      assert(z(part)<z('.tc-rw-guides'),'tracks must be above the entire button stacking context');
    assert(z('.tc-rw-guides')<z('.tc-rw-slider'),'thumbs must be above tracks');
    assert(z('.tc-rw-slider')<z('.tc-rw-label-layer'),'text and paintings remain readable above thumbs');
    assert.equal(style('.tc-rw-slider')['pointer-events'],'none','thumbs must not intercept tap/drag events');
    assert.equal(style('.tc-rw-slider[hidden]').display,'none!important','absent choices still hide their thumb');
  });
}
for(const name of ['tactical-combat.js','dungeon-trial-wheel.js']){
  test(name+': both inset lanes are rendered inside the modern component',()=>{
    const src=read('cultivation/'+name),start=src.indexOf('innerHTML=\'<svg class="tc-rw-guides"');
    assert(start>=0);
    const svg=src.slice(start,src.indexOf('</svg>',start));
    assert.equal((svg.match(/<path /g)||[]).length,7,'three ring edges plus four lane edges');
    for(const radius of [95,79,70,54])
      assert(svg.includes('A '+radius+' '+radius),'missing inset lane edge '+radius);
  });
}
