'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const W=require('../public/cultivation/weapon-dungeon-rules.js');
const Rewards=require('../weapon-dungeon-rewards.cjs');
const resourceCode=fs.readFileSync(require.resolve('../public/cultivation/spirit-stone-ui.js'),'utf8');
const weaponDungeonTicketMarkup=vm.runInNewContext(resourceCode.replace(/^export /gm,'')+'\nweaponDungeonTicketMarkup');
const source=fs.readFileSync(require.resolve('../public/cultivation/weapon-dungeons-page.js'),'utf8');
function harness({wide=false}={}){
 const elements=new Map(),events=new Map(),entered=[],requests=[];let uid='u1';
 class Element{
   constructor(tag){this.tagName=tag;this.handlers={};this.hidden=true;this.innerHTML='';this.attributes={};}
   addEventListener(type,handler){this.handlers[type]=handler;}
   setAttribute(key,value){this.attributes[key]=value;}
   removeAttribute(key){delete this.attributes[key];}
   append(child){elements.set(child.id,child);child.parentElement=this;}
   focus(){}
   querySelector(selector){if(selector==='[data-atlas-tickets]'&&this.id==='gameplay-dungeon-atlas')return this.ticketSlot||=( {innerHTML:''} );if(selector==='[data-atlas-resume-slot]'&&this.id==='gameplay-dungeon-atlas')return this.resumeSlot||=({innerHTML:''});return null;}
   querySelectorAll(selector){if(selector==='[data-atlas-progress]'&&this.id==='gameplay-dungeon-atlas')return [this.progressSlot||=({dataset:{atlasProgress:W.ID},innerHTML:''})];return [];}
   getBoundingClientRect(){return {left:0,right:500,top:0,bottom:500};}
 }
 const entries=new Element('div'),trigger=new Element('button'),shell=new Element('div');shell.dataset={};
 const document={readyState:'complete',activeElement:trigger,head:new Element('head'),body:new Element('body'),
   getElementById:id=>elements.get(id),createElement:tag=>new Element(tag),
   querySelector:selector=>selector==='#page-gameplay .gameplay-entries'?entries:selector==='#page-gameplay .gameplay-shell'?shell:null};
 const window={matchMedia:()=>({matches:wide}),addEventListener:(type,handler)=>events.set(type,handler),showToast:()=>{}};
 const context=vm.createContext({...require('./helpers/presentations.cjs'),QAWeaponDungeons:W,document,window,weaponDungeonTicketMarkup,getMainUser:()=>uid?{uid}:null,
   authenticatedMainFetch:()=>new Promise(resolve=>requests.push(resolve)),
   loadBattle:async()=>({openTacticalCombat:async(...args)=>entered.push(args)})});
 vm.runInContext(source.replace(/^import .*;\n/gm,'').replaceAll('export ','')
   .replaceAll("import('./tactical-combat.js?v=20261125-weapon-lord-cleared-v1')",'loadBattle()'),context);
 const dialog=()=>elements.get('weapon-dungeons-panel');
 const state=extra=>{const p={tickets:3,unlocked:0,clears:[0,0,0,0,0,0],active:null,...extra};return {...p,dungeonId:W.ID,dungeons:W.catalog(p),rewardPools:Rewards.previewPools(W.WEAPON_REALMS)};};
 const respond=(data=state(),index=0)=>requests[index]({ok:true,json:async()=>({ok:true,state:data})});
 return {elements,entered,requests,dialog,state,respond,events,shell,
   setUid:value=>{uid=value;},open:(id)=>window.openWeaponDungeons(id),
   choose:(id=W.ID)=>elements.get('gameplay-dungeon-atlas').handlers.click({target:{closest:s=>s==='[data-atlas-dungeon]'?{dataset:{atlasDungeon:id}}:null}}),
   back:()=>dialog().handlers.click({target:{closest:s=>s==='[data-wd-back]'?{}:null}}),
   click:async difficulty=>{dialog().handlers.click({target:{closest:selector=>selector==='[data-wd-difficulty]'?
     {dataset:{wdDifficulty:String(difficulty)},disabled:false}:null}});await new Promise(resolve=>setImmediate(resolve));},
   enter:async()=>{dialog().handlers.click({target:{closest:s=>s==='[data-wd-enter]'?{disabled:false}:null}});await new Promise(resolve=>setImmediate(resolve));}};
}
test('gameplay entry opens an authenticated inline panel with six difficulties, ticket balance and tracking counterplay',async()=>{
 const h=harness();assert(h.elements.has('gameplay-weapon-dungeon-entry'));
 const atlasOpening=h.open();assert.equal(h.requests.length,1);h.respond();await atlasOpening;assert.equal(h.dialog().hidden,true);
 assert.equal(h.shell.attributes['data-wd-atlas'],'true');
 assert.match(h.elements.get('gameplay-dungeon-atlas').innerHTML,/data-atlas-dungeon="peak-stone"/);
 h.choose();assert.equal(h.dialog().hidden,false);assert.match(h.dialog().innerHTML,/同步中/);
 h.respond(h.state(),1);await new Promise(resolve=>setImmediate(resolve));
 h.back();assert.equal(h.dialog().hidden,true);assert.equal(h.shell.attributes['data-wd-atlas'],'true');
 h.choose();h.respond(h.state(),2);await new Promise(resolve=>setImmediate(resolve));
 assert.equal((h.dialog().innerHTML.match(/data-wd-difficulty=/g)||[]).length,6);
 assert.match(h.dialog().innerHTML,/副本券 .*?>3<\/b>/);
 assert.match(h.dialog().innerHTML,/擊退則會打斷蓄勢/);
 assert.match(h.dialog().innerHTML,/data-wd-difficulty="1"[^>]*class="locked"/);
 await h.click(1);await h.enter();assert.equal(h.entered.length,0,'a forged locked-difficulty start cannot enter');
 await h.click(0);assert.equal(h.entered.length,0);await h.enter();assert.equal(h.entered.length,1);assert.equal(h.entered[0][0],'weapon-dungeon');
 assert.equal(h.entered[0][1].difficulty,0);assert.equal(h.entered[0][1].dungeonId,W.ID);
 assert.equal(h.dialog().hidden,true);
});
test('an active dungeon can resume with zero tickets and other challenges remain unavailable',async()=>{
 const h=harness(),opening=h.open(W.ID);h.respond(h.state({tickets:0,active:{roomId:'arena-active',difficulty:0}}));await opening;
 assert.match(h.dialog().innerHTML,/繼續挑戰 · 不耗券/);
 assert.doesNotMatch(h.dialog().innerHTML,/data-wd-difficulty="0"[^>]* disabled/);
 await h.click(0);assert.equal(h.entered.length,0);await h.enter();assert.equal(h.entered.length,1);
});
test('late account responses and responses after closing cannot overwrite a new modal session',async()=>{
 const h=harness(),old=h.open(W.ID);h.setUid('u2');h.events.get('xiuxian:user-data-ready')();
 assert.equal(h.dialog().hidden,true);
 const current=h.open(W.ID);h.respond(h.state({tickets:5}),1);await current;
 h.respond(h.state({tickets:1}),0);await old;
 assert.match(h.dialog().innerHTML,/副本券 .*?>5<\/b>/);
 const closing=h.open(W.ID);h.dialog().handlers.click({target:{closest:s=>s==='[data-wd-close]'?{}:null}});h.respond(h.state({tickets:2}),2);await closing;
 assert.equal(h.dialog().hidden,true);assert.doesNotMatch(h.dialog().innerHTML,/副本券 .*?>2<\/b>/);
});

test('catalog preserves per-dungeon progress and stone gates are deterministic',()=>{const p=W.progress({unlocked:1,clears:[2,0,0,0,0,0]});const d=W.catalog(p)[0];assert.equal(d.id,W.ID);assert.equal(d.clears[0],2);assert.equal(d.difficulties[1].locked,false);assert.equal(d.difficulties[2].locked,true);const map=W.layout('seed',0);assert.deepEqual(map,W.layout('seed',0));assert.equal(map.structure,'three-stone-gates');assert(map.blocks.length>75);});

test('earned dungeon ticket balances above daily refill cap remain visible',async()=>{
 const h=harness(),opening=h.open(W.ID);h.respond(h.state({tickets:8}));await opening;
 assert.match(h.dialog().innerHTML,/副本券 .*?>8<\/b>/);
 assert.match(h.dialog().innerHTML,/補發上限 5 張/);
});

test('landscape page shows weapon category and authentic map destination without opening a dialog',async()=>{
 const h=harness({wide:true}),atlas=h.elements.get('gameplay-dungeon-atlas');
 assert.ok(atlas);assert.equal(h.shell.dataset.atlasReady,'true');
 assert.match(atlas.innerHTML,/data-atlas-dungeon="peak-stone"/);
 assert.match(atlas.innerHTML,/尖峰石域/);assert.doesNotMatch(atlas.innerHTML,/data-atlas-coop/);
 assert.match(atlas.innerHTML,/src="\/assets\/dungeons\/peak-stone\.png"/);
 assert.match(atlas.innerHTML,/<span class="gameplay-atlas-name"><span>尖峰石域<\/span><\/span>/);
 assert.doesNotMatch(atlas.innerHTML,/fa-chevron-right/);
 h.elements.get('gameplay-weapon-dungeon-entry').handlers.click();
 assert.equal(h.requests.length,1,'category requests only the balance');
 h.respond();await new Promise(resolve=>setImmediate(resolve));
 atlas.handlers.click({target:{closest:s=>s==='[data-atlas-dungeon]'?{dataset:{atlasDungeon:W.ID}}:null}});
 assert.equal(h.requests.length,2);assert.equal(h.dialog().hidden,false);
 h.respond(h.state(),1);await new Promise(resolve=>setImmediate(resolve));
 assert.equal((h.dialog().innerHTML.match(/data-wd-difficulty=/g)||[]).length,6);
 assert.match(h.dialog().innerHTML,/尖峰石域/);
});
test('portrait launcher and external callers open the same island atlas, with no intermediate catalog',async()=>{
 const h=harness(),atlas=h.elements.get('gameplay-dungeon-atlas');
 assert.equal(h.shell.attributes['data-wd-atlas'],undefined);
 h.elements.get('gameplay-weapon-dungeon-entry').handlers.click();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.shell.attributes['data-wd-atlas'],'true');
 assert.equal(h.requests.length,1);assert.equal(h.dialog().hidden,true);
 h.respond();await new Promise(resolve=>setImmediate(resolve));
 assert.match(atlas.innerHTML,/data-atlas-dungeon="peak-stone"/);
 h.choose();h.respond(h.state(),1);await new Promise(resolve=>setImmediate(resolve));
 assert.match(h.dialog().innerHTML,/data-wd-difficulty=/);
 assert.doesNotMatch(h.dialog().innerHTML,/尋訪秘境|data-wd-dungeon=/);
 h.back();assert.equal(h.dialog().hidden,true);
 assert.equal(h.shell.attributes['data-wd-atlas'],'true');
 atlas.handlers.click({target:{closest:s=>s==='[data-atlas-back]'?{}:null}});
 assert.equal(h.shell.attributes['data-wd-atlas'],undefined);
 const reopening=h.open();assert.equal(h.shell.attributes['data-wd-atlas'],'true');
 assert.equal(h.requests.length,3);h.respond(h.state(),2);await reopening;
 h.events.get('xiuxian:page-switched')({detail:{pageId:'page-home'}});
 assert.equal(h.shell.attributes['data-wd-atlas'],undefined);
});

test('dungeon map art and universal solid plaque are separate original PNG files',()=>{
 const path=require('node:path');
 for(const name of ['peak-stone.png','dungeon-button.png']){
  const bytes=fs.readFileSync(path.join(__dirname,'../public/assets/dungeons',name));
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(bytes[25],6,'RGBA PNG with alpha');
 }
 const css=fs.readFileSync(path.join(__dirname,'../public/styles/gameplay-page.css'),'utf8');
 assert.match(css,/url\('\/assets\/dungeons\/dungeon-button\.png'\)/);
});

test('realm selector uses six segments and a moving highlight, previews without entry',async()=>{
 const h=harness(),opening=h.open(W.ID);h.respond(h.state({unlocked:1}));await opening;
 const markup=h.dialog().innerHTML,css=fs.readFileSync(require.resolve('../public/styles/weapon-dungeons.css'),'utf8');
 assert.match(markup,/class="wd-difficulty-selection"/);assert.match(markup,/--wd-selected-index:0/);
 assert.equal((markup.match(/data-wd-difficulty=/g)||[]).length,6);
 assert.match(css,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
 assert.match(css,/transform:translateX\(calc\(var\(--wd-selected-index,0\)\*100%\)\)/);
 await h.click(1);assert.equal(h.entered.length,0);await h.enter();assert.equal(h.entered[0][1].difficulty,1);
});

test('weapon dungeon is a section in the gameplay shell, and navigation hides it',async()=>{
 const h=harness(),opening=h.open(W.ID);h.respond();await opening;
 assert.equal(h.dialog().tagName,'section');assert.equal(h.dialog().parentElement,h.shell);
 assert.equal(h.dialog().hidden,false);h.events.get('xiuxian:page-switched')({detail:{pageId:'page-training'}});
 assert.equal(h.dialog().hidden,true);assert.doesNotMatch(source,/showModal\(|createElement\('dialog'\)/);
});

test('landscape details occupy the whole tab and both return controls restore the same atlas',async()=>{
 const h=harness({wide:true}),atlas=h.elements.get('gameplay-dungeon-atlas'),markup=atlas.innerHTML;
 const opening=h.open(W.ID);
 assert.equal(h.shell.attributes['data-wd-open'],'true');
 h.respond();await opening;
 assert.equal(h.dialog().hidden,false);assert.match(h.dialog().innerHTML,/尖峰石域/);
 h.back();
 assert.equal(h.dialog().hidden,true);
 assert.equal(h.shell.attributes['data-wd-open'],undefined);
 assert.equal(h.elements.get('gameplay-dungeon-atlas'),atlas);assert.equal(atlas.innerHTML,markup);
 assert.equal(h.requests.length,1,'return must not refetch or render the intermediate catalog');
 const second=h.open(W.ID);h.respond(h.state(),1);await second;
 h.dialog().handlers.click({target:{closest:s=>s==='[data-wd-close]'?{}:null}});
 assert.equal(h.dialog().hidden,true);assert.equal(h.shell.attributes['data-wd-open'],undefined);
 assert.equal(atlas.innerHTML,markup);assert.equal(h.entered.length,0);
 const css=fs.readFileSync(require.resolve('../public/styles/weapon-dungeons.css'),'utf8');
 assert.match(css,/grid-template-areas:"detail"/);
 assert.match(css,/\.gameplay-heading,\.gameplay-entries,\.gameplay-atlas\)\{display:none!important\}/);
 assert.match(css,/grid-area:detail;align-self:stretch;justify-self:stretch/);
});
test('return during a pending landscape request restores the atlas and ignores the late response',async()=>{
 const h=harness({wide:true}),opening=h.open(W.ID);
 h.dialog().handlers.click({target:{closest:s=>s==='[data-wd-close]'?{}:null}});
 h.respond();await opening;
 assert.equal(h.dialog().hidden,true);
 assert.equal(h.shell.attributes['data-wd-open'],undefined);
 assert.doesNotMatch(h.dialog().innerHTML,/data-wd-difficulty=/);
});

test('atlas shows the authenticated ticket balance, including zero and above-cap rewards',async()=>{
 for(const wide of [false,true]){
  const h=harness({wide}),atlas=h.elements.get('gameplay-dungeon-atlas');
  assert.doesNotMatch(atlas.innerHTML,/座秘境開放/);
  assert.match(atlas.innerHTML,/武器副本券/);
  const opening=h.open();h.respond(h.state({tickets:8}));await opening;
  assert.match(atlas.ticketSlot.innerHTML,/>8<\/b>/);
  const next=h.open();h.respond(h.state({tickets:0}),1);await next;
  assert.match(atlas.ticketSlot.innerHTML,/>0<\/b>/);
  const old=h.open();h.setUid('u2');h.events.get('xiuxian:user-data-ready')();
  const current=h.open();h.respond(h.state({tickets:4}),3);await current;
  h.respond(h.state({tickets:9}),2);await old;
  assert.match(atlas.ticketSlot.innerHTML,/>4<\/b>/);
 }
});
test('detail response replaces pending atlas balance without stale overwrites',async()=>{
 const h=harness(),atlas=h.elements.get('gameplay-dungeon-atlas');
 const balance=h.open(),detail=h.open(W.ID);
 h.respond(h.state({tickets:2}),1);await detail;
 h.respond(h.state({tickets:3}),0);await balance;
 assert.match(atlas.ticketSlot.innerHTML,/>2<\/b>/);
 h.back();assert.equal(h.dialog().hidden,true);assert.equal(h.requests.length,2);
});

test('expedition has one return control with both legacy selectors and compact disclosure',async()=>{
 const h=harness(),opening=h.open(W.ID);h.respond(h.state({tickets:8}));await opening;
 const markup=h.dialog().innerHTML;
 assert.equal((markup.match(/<button[^>]*data-wd-back/g)||[]).length,1);
 assert.equal((markup.match(/<button[^>]*data-wd-close/g)||[]).length,1);
 assert.match(markup,/data-wd-close data-wd-back data-qy-nav-action="back"/);
 assert.match(markup,/<details class="wd-tickets"><summary>/);
 assert.match(markup,/<details class="wd-intel"><summary>/);
 assert.match(markup,/30% 築基武器/);assert.match(markup,/20% 金丹武器/);
 assert.match(markup,/class="wd-island" src="\/assets\/dungeons\/peak-stone.png"/);
});

test('atlas one-tap resume opens exact active room, even with zero tickets; account switch removes it',async()=>{
 const h=harness(),opening=h.open();h.respond(h.state({tickets:0,active:{roomId:'arena-active',difficulty:0}}));await opening;
 const atlas=h.elements.get('gameplay-dungeon-atlas');
 assert.match(atlas.resumeSlot.innerHTML,/繼續挑戰/);assert.match(atlas.resumeSlot.innerHTML,/不耗券/);
 const click=()=>atlas.handlers.click({target:{closest:s=>s==='[data-atlas-resume]'?{}:null}});
 click();click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.entered.length,1);assert.equal(h.entered[0][1].resumeRoomId,'arena-active');
 assert.equal(h.requests.length,1);assert.equal(h.dialog().hidden,true);
 h.setUid('u2');h.events.get('xiuxian:user-data-ready')();assert.equal(atlas.resumeSlot.innerHTML,'');
 click();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.entered.length,1);
});

test('reward preview uses the actual server pool and original weapon artwork; empty tiers do not invent drops',async()=>{
 const h=harness(),opening=h.open(W.ID);h.respond(h.state());await opening;
 let markup=h.dialog().innerHTML;
 for(const book of Rewards.previewPools(['築基','金丹'])['築基']){
  assert.ok(markup.includes('data-wd-reward-id="'+book.id+'"'));
  assert.ok(markup.includes(book.name));
 }
 assert.match(markup,/src="\/assets\/weapons\/sword-flight-hd.webp"/);
 assert.match(markup,/實際未掉落武器機率 50%/);
 const pools=Rewards.previewPools(['元嬰','化神']);assert.deepEqual(pools,{元嬰:[],化神:[]});
 const another=harness(),pending=another.open(W.ID);another.respond(another.state({unlocked:2,active:{roomId:'active',difficulty:2}}));await pending;
 markup=another.dialog().innerHTML;
 assert.match(markup,/實際未掉落武器機率 100%/);
 assert.doesNotMatch(markup,/data-wd-reward-id=/);
});

test('island displays only authenticated progress and loads styles before the first landscape detail',async()=>{
 const h=harness({wide:true}),atlas=h.elements.get('gameplay-dungeon-atlas');
 assert.ok(h.elements.get('weapon-dungeons-style'));
 assert.match(atlas.innerHTML,/data-atlas-progress="peak-stone"/);
 const opening=h.open();h.respond(h.state({unlocked:1,clears:[1,0,0,0,0,0]}));await opening;
 assert.match(atlas.progressSlot.innerHTML,/已征服 1 \/ 6/);
 assert.equal((atlas.progressSlot.innerHTML.match(/is-cleared/g)||[]).length,1);
 assert.equal((atlas.progressSlot.innerHTML.match(/is-ready/g)||[]).length,1);
 const old=h.open();h.setUid('u2');h.events.get('xiuxian:user-data-ready')();
 h.respond(h.state({unlocked:5,clears:[1,1,1,1,1,1]}),1);await old;
 assert.equal(atlas.progressSlot.innerHTML,'');
});
test('one click reveals authentic island immediately, but no challenge controls before authenticated state',async()=>{
 const h=harness(),opening=h.open(W.ID);
 assert.match(h.dialog().innerHTML,/class="wd-expedition wd-loading"/);
 assert.match(h.dialog().innerHTML,/尖峰石域/);
 assert.doesNotMatch(h.dialog().innerHTML,/data-wd-enter|data-wd-difficulty=/);
 h.respond();await opening;
 assert.match(h.dialog().innerHTML,/data-wd-enter/);
 assert.doesNotMatch(h.dialog().innerHTML,/wd-expedition wd-loading/);
});
test('closing portrait atlas invalidates an in-flight status request',async()=>{
 const h=harness(),opening=h.open(),atlas=h.elements.get('gameplay-dungeon-atlas');
 atlas.handlers.click({target:{closest:s=>s==='[data-atlas-back]'?{}:null}});
 h.respond(h.state({active:{roomId:'stale',difficulty:0},unlocked:1,clears:[1,0,0,0,0,0]}));await opening;
 assert.equal(atlas.resumeSlot.innerHTML,'');assert.equal(atlas.progressSlot.innerHTML,'');
});
