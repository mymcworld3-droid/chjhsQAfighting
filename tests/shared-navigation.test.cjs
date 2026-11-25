'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..','public',p),'utf8');
const {syncRail}=require('../public/cultivation/shared-navigation.js');
function button(active=false,hidden=false){
  const attrs=new Map(),classes=new Set(active?['active-nav-btn']:[]);
  return {tagName:'BUTTON',dataset:{target:'page-home'},hidden,classes,attrs,
    classList:{contains:k=>classes.has(k)},getAttribute:k=>attrs.get(k)||null,
    setAttribute:(k,v)=>attrs.set(k,v),hasAttribute:k=>attrs.has(k),removeAttribute:k=>attrs.delete(k)};
}
test('live rail follows active and hidden states without replacing entries or handlers',()=>{
  const a=button(true),b=button(),hidden=button(true,true),locked=button();
  locked.classes.add('nav-locked');const click=()=>{};locked.onclick=click;
  const grid={children:[a,b,hidden,locked]};syncRail(grid);
  assert.equal(a.getAttribute('aria-current'),'page');assert.equal(hidden.getAttribute('aria-current'),null);
  a.classes.delete('active-nav-btn');b.classes.add('active-nav-btn');syncRail(grid);
  assert.equal(a.getAttribute('aria-current'),null);assert.equal(b.getAttribute('aria-current'),'page');
  b.attrs.set('aria-hidden','true');syncRail(grid);assert.equal(b.getAttribute('aria-current'),null);
  assert.equal(grid.children.length,4);assert.equal(locked.onclick,click);assert.ok(locked.classes.has('nav-locked'));
  const later=button(true);grid.children.push(later);syncRail(grid);assert.equal(later.getAttribute('aria-current'),'page');
});
test('brand uses the existing font wordmark without image loading',()=>{
  const brand=read('index.html').match(/<button id="brand-home"[\s\S]*?<\/button>/)[0];
  assert.match(brand,/<span class="app-brand-wordmark"[^>]*>青雲問道<\/span>/);
  assert.doesNotMatch(brand,/<picture|<img|<source/);
  assert.doesNotMatch(read('cultivation/shared-navigation.js'),/data-qy-art-ready/);
});
test('one global rail has no image decoration and preserves disabled features',()=>{
  const index=read('index.html'),css=read('styles/scene-art-shell.css'),main=read('main.js');
  assert.equal((index.match(/id="bottom-nav"/g)||[]).length,1);
  assert.equal((index.match(/id="nav-grid"/g)||[]).length,1);
  assert.doesNotMatch(css,/assets\/interface\/(?:brand|dock)-|qy-dock-art|data-qy-art-ready/);
  assert.match(css,/background-image:none!important/);
  assert.match(main,/import\('\.\/cultivation\/shared-navigation\.js'\)/);
  assert.match(main,/QA_COOP_DUNGEON_ENABLED = false/);assert.match(main,/QA_WEAPON_SYSTEM_ENABLED = false/);
  assert.match(index,/onclick="returnToImmortalHome\(\)"/);
});
test('shared visual roles retain original action selectors',()=>{
  assert.match(read('styles/scene-art-shell.css'),/button\[data-qy-nav-action\]/);
  for(const [file,role,action] of [
    ['index.html','back','data-dv-back'],['cultivation/manual-training-page.js','back','data-manual-close-training'],
    ['cultivation/weapon-dungeons-page.js','back','data-wd-back'],['cultivation/weapon-dungeons-page.js','close','data-wd-close'],
    ['cultivation/daily-meditation.js','close','dm-close'],['cultivation/tactical-combat.js','collapse','收起戰場'],
    ['cultivation/dongtian.js','exit','dt-exit']
  ]){const s=read(file);assert.ok(s.includes('data-qy-nav-action="'+role+'"'),file);assert.ok(s.includes(action),file);}
});
