'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..','public',p),'utf8');
const {roleFor,decorate,scan}=require('../public/cultivation/shared-controls.js');
function fake(kind,token,classes=[]){
  const attrs=new Map(),cls=new Set(classes);
  return {kind,token,attrs,cls,disabled:false,value:'保留輸入',onclick:()=>42,
    classList:{contains:k=>cls.has(k)},getAttribute:k=>attrs.get(k)??null,
    setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),
    matches(s){return s===kind||s==='button,input,textarea,select'||(this.token&&s.includes(this.token));}};
}
test('semantic adapter distinguishes native actions, tabs, filters and fields',()=>{
  for(const [kind,token,expected] of [['button','.quest-claim','primary'],['button','#quest-refresh','secondary'],['button','#delete-account-btn','danger'],['button','#alliance-chat-send','icon'],['button','.quest-tabs button','tab'],['button','.manual-library-filter','filter'],['textarea','#section-classes','field']]){
    const n=fake(kind,token);assert.equal(roleFor(n),expected,token);
    const original=n.onclick;assert.equal(decorate(n),expected);assert.equal(n.attrs.get('data-qy-control'),expected);
    assert.equal(n.onclick,original);assert.equal(n.value,'保留輸入');assert.equal(n.disabled,false);
  }
});
test('answer options, art, navigation and arbitrary controls are not decorated',()=>{
  for(const token of ['.dv-choice','.cc-options button','.tc-options button','.dm-option','.dt-option','.manual-native-card','[data-wd-difficulty]','.nav-btn','[data-qy-nav-action]']){
    const n=fake('button',token);assert.equal(decorate(n),null,token);assert.equal(n.attrs.has('data-qy-control'),false);
  }
  assert.equal(roleFor(fake('button','not-a-known-selector')),null);
});
test('store filter mirrors its owner class without triggering handlers or changing selection',()=>{
  const n=fake('button','.store-tab',['active']);n.disabled=true;
  decorate(n);assert.equal(n.getAttribute('aria-pressed'),'true');assert.equal(n.disabled,true);
  n.cls.delete('active');decorate(n);assert.equal(n.getAttribute('aria-pressed'),'false');
  n.cls.add('active-tab');decorate(n);assert.equal(n.getAttribute('aria-pressed'),'true');
  assert.equal(n.onclick(),42);
});
test('re-rendered native fields preserve value, handler and owner state',()=>{
  const n=fake('input','#page-settings'),b=fake('button','.quest-claim');
  b.disabled=true;n.value='abc';const f=n.onclick;
  scan({querySelectorAll:()=>[n,b]});
  assert.equal(n.value,'abc');assert.equal(n.onclick,f);assert.equal(b.disabled,true);
  assert.equal(n.getAttribute('data-qy-control'),'field');
  b.token='not-a-known-selector';decorate(b);assert.equal(b.getAttribute('data-qy-control'),null);
});
test('stylesheet and module are loaded, preserve native keyboard and state semantics',()=>{
  const js=read('cultivation/shared-controls.js'),css=read('styles/shared-controls.css'),index=read('index.html'),main=read('main.js');
  assert.match(index,/styles\/shared-controls\.css\?v=/);
  assert.match(main,/import\('\.\/cultivation\/shared-controls\.js\?v=/);
  assert.match(main,/QA_COOP_DUNGEON_ENABLED = false/);
  assert.match(main,/QA_WEAPON_SYSTEM_ENABLED = false/);
  for(const role of ['primary','danger','icon','tab','filter','field'])assert.ok(css.includes('data-qy-control="'+role+'"'));
  assert.match(css,/@media\(pointer:coarse\)/);assert.match(css,/font-size:16px!important/);
  assert.match(css,/\[aria-invalid="true"\]/);assert.match(css,/\[aria-selected="true"\]/);
  assert.doesNotMatch(js,/\.focus\(|scrollIntoView\(|visualViewport|\.click\(|preventDefault\(/);
  assert.doesNotMatch(css,/position:fixed|100dvh|appearance:\s*none/);
  assert.match(js,/attributeFilter:\['class','type','role'\]/);
  assert.match(css,/\[hidden\],\.hidden/);
});
