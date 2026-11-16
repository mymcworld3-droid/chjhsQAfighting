'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
const css=read('styles/tactical-quarter-controls.css');
const battle=read('styles/tactical-combat.css');
const script=read('cultivation/tactical-combat.js');
test('wheel artwork rules are valid CSS instead of invalid //-prefixed selectors',()=>{
  assert.doesNotMatch(css,/^\s*\/\//m);
  assert.doesNotMatch(battle,/^\s*\/\//m);
  assert.match(css,/\.tc-wheel-skill-art,\s*\n#tactical-combat\.tc-quarter-layout \.tc-wheel-detail-marker \.tc-wheel-skill-art/);
  assert.match(css,/object-fit:cover/);
  assert.match(css,/max-width:23px;max-height:23px/);
  assert.match(battle,/\.tc-action-tabs \.tc-pvp-skill-art\{/);
});
test('skill picture and name + cost use one horizontal, size-limited sector label',()=>{
  assert.match(script,/copy\.className='tc-wheel-copy'/);
  assert.match(script,/copy\.append\(title,fee\)/);
  assert.match(script,/container\.prepend\(image\)/);
  assert.match(css,/\.tc-sector\[data-wheel-choice\]>span\{[\s\S]*?flex-direction:row/);
  assert.match(css,/\.tc-wheel-detail-marker\{[\s\S]*?flex-direction:row/);
  assert.match(css,/\.tc-wheel-copy\{[\s\S]*?flex-direction:column/);
});
test('both landscape and portrait limit art size while preserving selected marker labels',()=>{
  assert.match(css,/@media\(orientation:portrait\)\{[\s\S]*?width:14px;height:14px;max-width:14px;max-height:14px/);
  assert.match(script,/wheelText\(detailThumb,targetName,targetCost,attacking\?skillArt\(shown\):''\)/);
  assert.match(script,/wheelText\(button\.firstElementChild,option\.name,price,skillArt\(option\.skill\)\)/);
});
