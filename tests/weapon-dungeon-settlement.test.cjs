'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../public/cultivation/weapon-dungeon-rules.js'),P=require('../public/cultivation/weapon-presentation.js'),Feedback=require('../public/cultivation/daily-meditation-rewards.js');
const source=fs.readFileSync(require.resolve('../public/cultivation/tactical-combat.js'),'utf8');
function render(overrides={}){
 const ctx={QAWeaponDungeons:W,QAWeaponPresentation:P,esc:v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))};
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('function dungeonSettlementMarkup('),source.indexOf('async function retryWeaponDungeon(')),ctx);
 const drop={id:'sword-flight',name:'御靈飛劍',tierRealm:'築基',quantity:1};
 return ctx.dungeonSettlementMarkup({info:{id:W.ID,name:W.NAME,realm:'築基',difficulty:0},result:{cleared:true,unlocked:1,newlyUnlocked:1,tickets:2},win:true,drop,weaponDrop:drop,celebrateFresh:true,dungeonCards:Feedback.renderSettlement({weapon:drop}),manualRecap:'<section data-manual-battle-result></section>',metrics:'<p>答對 2</p>',confirmed:true,...overrides});
}
test('first clear displays shared weapon reward, genuine unlock, remaining tickets and retry',()=>{
 const html=render();assert.match(html,/data-wd-result="cleared"/);assert.match(html,/秘境已破/);assert.match(html,/wd-result-unlock is-new/);assert.match(html,/首次解鎖.*金丹/);assert.match(html,/mr-reward-item--weapon/);assert.match(html,/御靈飛劍/);assert.match(html,/剩餘副本券 2 張/);assert.match(html,/data-manual-battle-result/);
});
test('replayed or repeated clear has no new celebration',()=>{
 const replay=render({celebrateFresh:false});assert.doesNotMatch(replay,/is-fresh|wd-result-unlock is-new/);
 const repeat=render({result:{cleared:true,unlocked:1,newlyUnlocked:null,tickets:1}});assert.match(repeat,/已開放境界/);assert.doesNotMatch(repeat,/首次解鎖|wd-result-unlock is-new/);
});
test('failure and exhausted tickets are explicit and do not unlock or imply a reward',()=>{
 const html=render({win:false,reason:'forfeit',result:{cleared:false,unlocked:1,newlyUnlocked:null,tickets:0},drop:null,weaponDrop:null,dungeonCards:Feedback.renderSettlement({})});
 assert.match(html,/data-wd-result="failed"/);assert.match(html,/副本券不退還/);assert.match(html,/data-weapon-dungeon-retry disabled/);assert.doesNotMatch(html,/wd-result-unlock|is-fresh|mr-reward-item--weapon/);
});
test('unconfirmed victory is not a clear and cannot trigger a paid retry',()=>{
 const html=render({result:null,confirmed:false,drop:null,weaponDrop:null,dungeonCards:Feedback.renderSettlement(null)});
 assert.match(html,/data-wd-result="pending"/);assert.match(html,/data-weapon-dungeon-retry disabled/);assert.doesNotMatch(html,/秘境已破|wd-result-unlock/);
});
test('highest realm has no fictional next difficulty',()=>{
 const html=render({info:{name:W.NAME,realm:'渡劫',difficulty:5},result:{cleared:true,unlocked:5,newlyUnlocked:null,tickets:1}});
 assert.match(html,/已完成最高難度/);assert.doesNotMatch(html,/wd-result-unlock/);
});

test('retry action only opens the settled room once eligible and never forwards a resume token',async()=>{
 const calls=[];
 const ctx={busy:false,state:{id:'finished-room',status:'finished',weaponDungeon:{id:W.ID,difficulty:1},weaponDungeonResult:{cleared:true,tickets:2}},uid:'u1',myActor:()=>({team:'player'}),open:async(...args)=>calls.push(args)};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function retryWeaponDungeon('),source.indexOf('function resultDialog(){')),ctx);
 await ctx.retryWeaponDungeon();
 assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['weapon-dungeon',{dungeonId:W.ID,difficulty:1,retryFromRoomId:'finished-room'}]]);
 ctx.busy=true;await ctx.retryWeaponDungeon();
 ctx.busy=false;ctx.state.weaponDungeonResult.tickets=0;await ctx.retryWeaponDungeon();
 ctx.state.weaponDungeonResult={};await ctx.retryWeaponDungeon();
 ctx.state.status='active';ctx.state.weaponDungeonResult={cleared:true,tickets:1};await ctx.retryWeaponDungeon();
 assert.equal(calls.length,1);
});
