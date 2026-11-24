'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const W=require('../public/cultivation/weapon-dungeon-rules.js');
const source=fs.readFileSync(require.resolve('../public/cultivation/weapon-dungeons-page.js'),'utf8');
function harness(){
 const elements=new Map(),events=new Map(),entered=[],requests=[];let uid='u1';
 class Element{
   constructor(tag){this.tagName=tag;this.handlers={};this.open=false;this.innerHTML='';}
   addEventListener(type,handler){this.handlers[type]=handler;}
   setAttribute(){}
   append(child){elements.set(child.id,child);}
   showModal(){this.open=true;}
   close(){this.open=false;this.handlers.close?.();}
   focus(){}
   getBoundingClientRect(){return {left:0,right:500,top:0,bottom:500};}
 }
 const entries=new Element('div'),trigger=new Element('button');
 const document={readyState:'complete',activeElement:trigger,head:new Element('head'),body:new Element('body'),
   getElementById:id=>elements.get(id),createElement:tag=>new Element(tag),
   querySelector:selector=>selector==='#page-gameplay .gameplay-entries'?entries:null};
 const window={addEventListener:(type,handler)=>events.set(type,handler),showToast:()=>{}};
 const context=vm.createContext({document,window,getMainUser:()=>uid?{uid}:null,
   authenticatedMainFetch:()=>new Promise(resolve=>requests.push(resolve)),
   loadBattle:async()=>({openTacticalCombat:async(...args)=>entered.push(args)})});
 vm.runInContext(source.replace(/^import .*;\n/,'').replaceAll('export ','')
   .replace("import('./tactical-combat.js')",'loadBattle()'),context);
 const dialog=()=>elements.get('weapon-dungeons-dialog');
 const state=extra=>{const p={tickets:3,unlocked:0,clears:[0,0,0,0,0,0],active:null,...extra};return {...p,dungeonId:W.ID,dungeons:W.catalog(p)};};
 const respond=(data=state(),index=0)=>requests[index]({ok:true,json:async()=>({ok:true,state:data})});
 return {elements,entered,requests,dialog,state,respond,events,
   setUid:value=>{uid=value;},open:()=>window.openWeaponDungeons(),
   choose:(id=W.ID)=>dialog().handlers.click({target:{closest:s=>s==='[data-wd-dungeon]'?{dataset:{wdDungeon:id}}:null}}),
   back:()=>dialog().handlers.click({target:{closest:s=>s==='[data-wd-back]'?{}:null}}),
   click:async difficulty=>{dialog().handlers.click({target:{closest:selector=>selector==='[data-wd-difficulty]'?
     {dataset:{wdDifficulty:String(difficulty)},disabled:false}:null}});await new Promise(resolve=>setImmediate(resolve));}};
}
test('gameplay entry opens an authenticated modal with six difficulties, ticket balance and tracking counterplay',async()=>{
 const h=harness();assert(h.elements.has('gameplay-weapon-dungeon-entry'));
 const loading=h.open();assert(h.dialog().open);assert.match(h.dialog().innerHTML,/同步中/);
 h.respond();await loading;
 assert.match(h.dialog().innerHTML,/data-wd-dungeon="peak-stone"/);
 assert.doesNotMatch(h.dialog().innerHTML,/data-wd-difficulty=/);
 h.choose();h.back();assert.doesNotMatch(h.dialog().innerHTML,/data-wd-difficulty=/);h.choose();
 assert.equal((h.dialog().innerHTML.match(/data-wd-difficulty=/g)||[]).length,6);
 assert.match(h.dialog().innerHTML,/副本券 3 \/ 5/);
 assert.match(h.dialog().innerHTML,/擊退則會打斷蓄勢/);
 assert.match(h.dialog().innerHTML,/data-wd-difficulty="1" disabled/);
 await h.click(1);assert.equal(h.entered.length,0,'a forged locked-difficulty click cannot enter');
 await h.click(0);assert.equal(h.entered.length,1);assert.equal(h.entered[0][0],'weapon-dungeon');
 assert.equal(h.entered[0][1].difficulty,0);assert.equal(h.entered[0][1].dungeonId,W.ID);
 assert.equal(h.dialog().open,false);
});
test('an active dungeon can resume with zero tickets and other challenges remain unavailable',async()=>{
 const h=harness(),opening=h.open();h.respond(h.state({tickets:0,active:{roomId:'arena-active',difficulty:0}}));await opening;h.choose();
 assert.match(h.dialog().innerHTML,/繼續挑戰 · 不耗券/);
 assert.doesNotMatch(h.dialog().innerHTML,/data-wd-difficulty="0" disabled/);
 await h.click(0);assert.equal(h.entered.length,1);
});
test('late account responses and responses after closing cannot overwrite a new modal session',async()=>{
 const h=harness(),old=h.open();h.setUid('u2');h.events.get('xiuxian:user-data-ready')();
 assert.equal(h.dialog().open,false);
 const current=h.open();h.respond(h.state({tickets:5}),1);await current;
 h.respond(h.state({tickets:1}),0);await old;
 assert.match(h.dialog().innerHTML,/副本券 5 \/ 5/);
 const closing=h.open();h.dialog().close();h.respond(h.state({tickets:2}),2);await closing;
 assert.equal(h.dialog().open,false);assert.doesNotMatch(h.dialog().innerHTML,/副本券 2 \/ 5/);
});

test('catalog preserves per-dungeon progress and stone gates are deterministic',()=>{const p=W.progress({unlocked:1,clears:[2,0,0,0,0,0]});const d=W.catalog(p)[0];assert.equal(d.id,W.ID);assert.equal(d.clears[0],2);assert.equal(d.difficulties[1].locked,false);assert.equal(d.difficulties[2].locked,true);const map=W.layout('seed',0);assert.deepEqual(map,W.layout('seed',0));assert.equal(map.structure,'three-stone-gates');assert(map.blocks.length>75);});
