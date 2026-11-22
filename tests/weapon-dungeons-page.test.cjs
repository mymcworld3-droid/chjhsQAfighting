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
 const state=extra=>({tickets:3,clears:[0,0,0,0,0,0],active:null,
   difficulties:W.DIFFICULTIES.map(d=>({...d,locked:d.index>0,nextRealm:W.DIFFICULTIES[d.index+1]?.name||'真仙'})),...extra});
 const respond=(data=state(),index=0)=>requests[index]({ok:true,json:async()=>({ok:true,state:data})});
 return {elements,entered,requests,dialog,state,respond,events,
   setUid:value=>{uid=value;},open:()=>window.openWeaponDungeons(),
   click:async difficulty=>{dialog().handlers.click({target:{closest:selector=>selector==='[data-wd-difficulty]'?
     {dataset:{wdDifficulty:String(difficulty)},disabled:false}:null}});await new Promise(resolve=>setImmediate(resolve));}};
}
test('gameplay entry opens an authenticated modal with six difficulties, ticket balance and tracking counterplay',async()=>{
 const h=harness();assert(h.elements.has('gameplay-weapon-dungeon-entry'));
 const loading=h.open();assert(h.dialog().open);assert.match(h.dialog().innerHTML,/同步中/);
 h.respond();await loading;
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
 const h=harness(),opening=h.open();h.respond(h.state({tickets:0,active:{roomId:'arena-active',difficulty:0}}));await opening;
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
