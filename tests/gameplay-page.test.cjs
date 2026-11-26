'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('gameplay page contains one target for the existing cooperative dungeon',()=>{
  const html=read('public/index.html');
  assert.match(html,/<section id="page-gameplay" class="page-section hidden/);
  assert.match(html,/class="gameplay-entries" aria-label="選擇歷練項目"/);
  assert.match(html,/id="gameplay-page-title">歷練<\/h2>/);
  assert.match(html,/styles\/gameplay-page\.css/);
  const lobby=read('public/cultivation/dungeon-lobby.js');
  assert.match(lobby,/querySelector\('#page-gameplay \.gameplay-entries'\)/);
  assert.match(lobby,/id='gameplay-dungeon-entry'/);
  assert.doesNotMatch(lobby,/#page-home \.xiuxian-quick-actions|home-dungeon-entry/);
  assert.match(lobby,/entry\.addEventListener\('click',\(\)=>\{void openLobby\(\);\}\)/);
  assert.match(read('public/main.js'),/\.\/cultivation\/gameplay-page\.js/);
});
test('navigation mounts after 修煉, stays unique and follows a replacement training button',()=>{
  class Node{
    constructor(id=''){this.id=id;this.children=[];this.parent=null;this.dataset={};this.listeners={};}
    get isConnected(){return !!this.parent;}
    get previousElementSibling(){if(!this.parent)return null;return this.parent.children[this.parent.children.indexOf(this)-1]||null;}
    addEventListener(n,fn){this.listeners[n]=fn;}
    setAttribute(k,v){this[k]=v;}
    append(node){this.insertBefore(node,null);}
    insertBefore(node,before){
      if(node.parent){const s=node.parent.children;s.splice(s.indexOf(node),1);}
      const pos=before?this.children.indexOf(before):this.children.length;
      this.children.splice(pos,0,node);node.parent=this;
    }
    insertAdjacentElement(side,node){
      assert.equal(side,'afterend');this.parent.insertBefore(node,
        this.parent.children[this.parent.children.indexOf(this)+1]||null);
    }
    querySelector(selector){
      if(selector==='#nav-training')return this.children.find(n=>n.id==='nav-training')||null;
      if(selector==='[data-target="page-home"]')return this.children.find(n=>n.dataset.target==='page-home')||null;
      return null;
    }
  }
  const nav=new Node('nav-grid'),home=new Node('nav-home'),training=new Node('nav-training'),settings=new Node('nav-settings');
  home.dataset.target='page-home';training.dataset.target='page-training';settings.dataset.target='page-settings';
  nav.append(home);nav.append(training);nav.append(settings);
  let observeCallback=null,opened='';
  const doc={
    readyState:'complete',getElementById:id=>id==='nav-grid'?nav:
      [...nav.children].find(el=>el.id===id)||null,
    createElement:()=>new Node(),addEventListener(){}
  };
  const context={document:doc,window:{switchToPage:id=>{opened=id;},addEventListener(){}},
    MutationObserver:class{constructor(cb){observeCallback=cb;}observe(){}}
  };
  vm.runInNewContext(read('public/cultivation/gameplay-page.js'),context);
  let gameplay=nav.children.find(el=>el.id==='nav-gameplay');
  assert.ok(gameplay);
  assert.deepEqual(nav.children.map(n=>n.id),['nav-home','nav-training','nav-gameplay','nav-settings']);
  assert.equal(gameplay.dataset.target,'page-gameplay');
  assert.ok(gameplay.innerHTML.includes('歷練'));
  assert.equal(gameplay['aria-label'],'前往歷練');
  gameplay.listeners.click();assert.equal(opened,'page-gameplay');
  // Simulate a realm transition that removes and recreates training.
  nav.children.splice(nav.children.indexOf(training),1);training.parent=null;
  observeCallback();
  const replacement=new Node('nav-training');replacement.dataset.target='page-training';
  home.insertAdjacentElement('afterend',replacement);
  observeCallback();
  assert.deepEqual(nav.children.map(n=>n.id),['nav-home','nav-training','nav-gameplay','nav-settings']);
  observeCallback();
  assert.equal(nav.children.filter(n=>n.id==='nav-gameplay').length,1);
});
