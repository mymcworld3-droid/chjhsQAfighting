'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const catalog=require('../public/cultivation/manual-rules.js');
const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/manual-training-page.js'),'utf8')
  .replace(/^import .*;\r?\n/gm,'').split("if(document.readyState==='loading')")[0];
const books=[
 {id:'sword-wind',name:'流風靈劍',school:'sword',owned:true,level:12,tierRealm:'煉氣',skills:[{id:'wind-slash',unlocked:true}]},
 {id:'body-rock',name:'玄嶽圖騰',school:'body',owned:true,level:13,tierRealm:'築基',skills:[{id:'rock-fist',unlocked:true}]},
 {id:'body-dragon',name:'龍象圖騰',school:'body',owned:true,level:15,tierRealm:'金丹',skills:[{id:'dragon-guard',unlocked:true}]}
];
function state(ids){
 const byId=new Map(books.map(book=>[book.id,book]));
 const loadouts=ids.map(id=>({weaponId:id,skillIds:byId.get(id)?.skills.map(skill=>skill.id)||[]}));
 return {weaponIds:[...ids],library:books,loadouts,activeLoadout:0,
   equipped:loadouts.flatMap(slot=>slot.skillIds),gold:5000};
}
function fixture(){
 const requests=[],paints=[],toasts=[],events=[],serverUpdates=[];
 let uid='u1';
 const window={
   request:(url,body)=>new Promise((resolve,reject)=>requests.push({url,body,resolve,reject})),
   paints,toasts,events,serverUpdates,initialState:state(['sword-wind',null]),
   getComputedStyle:()=>({paddingBottom:'0px'}),
   setCurrentTacticalManualState:(snapshot,user)=>serverUpdates.push({snapshot,user}),
   dispatchEvent:event=>events.push(event)
 };
 const context=vm.createContext({globalThis:{QAManuals:catalog},window,getMainUser:()=>uid,
   CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}});
 vm.runInContext(source,context);
 const evaluate=script=>vm.runInContext(script,context);
 evaluate(`request=window.request;paint=(...args)=>window.paints.push(args);
   showManualToast=(...args)=>window.toasts.push(args);
   current=window.initialState;weaponServerState=current;loadedFor='u1';`);
 const read=()=>JSON.parse(JSON.stringify(evaluate(`({
   busy,ids:current.weaponIds,flight:weaponRequest?.weaponId,queue:weaponChangeQueue.map(job=>job.weaponId),
   authoritative:weaponServerState?.weaponIds,blockedDungeonEquip})`)));
 return {requests,paints,toasts,events,serverUpdates,evaluate,read,
   setUid:value=>{uid=value;},state};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('weapon swap is immediate and never enters the page-wide busy/save popup',async()=>{
 const h=fixture();
 h.evaluate("changeWeaponInBackground(1,'body-rock')");
 assert.equal(h.read().busy,false);
 assert.deepEqual(h.read().ids,['sword-wind','body-rock']);
 assert.equal(h.requests.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].body)),{index:1,weaponId:'body-rock'});
 assert(h.paints.every(args=>!String(args[0]||'').includes('保存')));
 h.requests[0].resolve(state(['sword-wind','body-rock']));
 await settle();
 assert.deepEqual(h.read().ids,['sword-wind','body-rock']);
 assert.equal(h.toasts.length,0,'successful background saves remain silent');
 assert.equal(h.serverUpdates.length,1);
});

test('rapid changes serialize server writes while keeping the latest selection on screen',async()=>{
 const h=fixture();
 h.evaluate("changeWeaponInBackground(1,'body-rock')");
 h.evaluate("changeWeaponInBackground(1,'body-dragon')");
 assert.equal(h.requests.length,1);
 assert.deepEqual(h.read().ids,['sword-wind','body-dragon']);
 h.requests[0].resolve(state(['sword-wind','body-rock']));await settle();
 assert.equal(h.requests.length,2);
 assert.deepEqual(h.read().ids,['sword-wind','body-dragon']);
 assert.deepEqual(JSON.parse(JSON.stringify(h.requests[1].body)),{index:1,weaponId:'body-dragon'});
 h.requests[1].resolve(state(['sword-wind','body-dragon']));await settle();
 assert.deepEqual(h.read().ids,['sword-wind','body-dragon']);
 assert.equal(h.read().busy,false);
 assert.equal(h.toasts.length,0);
});

test('rejected background swap rolls back UI and shows only an error',async()=>{
 const h=fixture();
 h.evaluate("changeWeaponInBackground(1,'body-rock')");
 h.requests[0].reject(new Error('伺服器暫時無法使用'));await settle();
 assert.deepEqual(h.read().ids,['sword-wind',null]);
 assert.equal(h.read().busy,false);
 assert.equal(h.toasts.length,1);
 assert.match(h.toasts[0][0],/伺服器暫時無法使用/);
 assert.equal(h.toasts[0][1],'error');
});

test('multiplayer gear conflict keeps the explicit departure-and-retry option',async()=>{
 const h=fixture();h.evaluate("changeWeaponInBackground(1,'body-rock')");
 h.requests[0].reject(new Error('多人副本進行中，不可裝備或卸下武器'));await settle();
 assert.deepEqual(h.read().blockedDungeonEquip,{index:1,weaponId:'body-rock'});
 assert.deepEqual(h.read().ids,['sword-wind',null]);
});

test('account switching invalidates old saves rather than changing the new account',async()=>{
 const h=fixture();h.evaluate("changeWeaponInBackground(1,'body-rock')");
 h.setUid('u2');h.evaluate("resetWeaponChanges();current=window.initialState;loadedFor='u2';");
 h.requests[0].resolve(state(['sword-wind','body-rock']));await settle();
 assert.deepEqual(h.read().ids,['sword-wind',null]);
 assert.equal(h.serverUpdates.length,0);
});

test('armory fill height is stable when the main container scrolls',()=>{
 const h=fixture();
 h.evaluate("window.layoutMain={clientHeight:700,scrollTop:50,getBoundingClientRect:()=>({top:0})};");
 h.evaluate(`window.getComputedStyle=node=>({paddingBottom:node===window.layoutMain?'80px':'0px'});
 window.measurements={};window.topPosition=200;
 root={parentElement:{},classList:{contains:()=>false},style:{setProperty:(k,v)=>window.measurements[k]=v},
   getBoundingClientRect:()=>({top:window.topPosition}),closest:selector=>selector==='main'?window.layoutMain:{}};
 fitArmoryHeight();`);
 assert.equal(h.evaluate("window.measurements['--mt-fill-height']"),'368px');
 h.evaluate("window.layoutMain.scrollTop=100;window.topPosition=150;fitArmoryHeight()");
 assert.equal(h.evaluate("window.measurements['--mt-fill-height']"),'368px');
});

test('both orientations use the same fixed card aspect ratio and do not stretch columns',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../public/styles/manual-training-layout.css'),'utf8');
 assert.match(css,/aspect-ratio:1047\/1501/);
 assert.match(css,/grid-auto-columns:var\(--mt-fixed-card-width\)!important/);
 assert.match(css,/grid-template-rows:var\(--mt-fixed-card-height\)/);
 assert.match(css,/grid-template-rows:repeat\(2,var\(--mt-fixed-card-height\)\)/);
 assert.match(css,/flex:1 0 auto/);
 assert.match(css,/--mt-fill-height/);
});
