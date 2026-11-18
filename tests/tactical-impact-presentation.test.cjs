'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Fx=require('../public/cultivation/tactical-impact-presentation.js');
const A=require('../public/cultivation/tactical-animation.js');

const boss=(extra={})=>({uid:'monster-0',bot:true,boss:true,bossKind:'flame',species:10,
  name:'赤焰巨獸',x:5,y:3,footprint:{width:2,height:2},
  hp:1000,maxHp:1000,phase:1,intent:{text:'下次：烈焰吐息'},...extra});
const room=(actor=boss(),opts={})=>({id:'arena-a',mode:'pve',status:'active',revision:2,
  objective:{type:'boss',bossUid:'monster-0'},actors:[
    {uid:'hero',name:'修士',team:'player',x:1,y:2,hp:1000,maxHp:1000},actor
  ],...opts});
const strikeScene={
  kind:'cast',actor:'hero',skill:'rock-fist',parallelImpact:true,impactStart:.45,
  numbers:[{uid:'monster-0',damage:150}],before:room().actors,after:[...room().actors],
  target:{x:5,y:3},duration:620
};
function canvas(){
  const calls=[];let invalid=0;
  const ctx={};
  for(const method of ['save','restore','beginPath','moveTo','lineTo','fill','stroke',
    'rect','clip','arc','ellipse','setLineDash','translate','rotate']){
    ctx[method]=(...args)=>{if(args.some(x=>typeof x==='number'&&!Number.isFinite(x)))invalid++;calls.push(method);};
  }
  const gradient=()=>({addColorStop:()=>calls.push('stop')});
  ctx.createRadialGradient=(...args)=>{if(args.some(x=>!Number.isFinite(x)))invalid++;calls.push('gradient');return gradient()};
  ctx.createLinearGradient=gradient;
  return {ctx,calls,invalid:()=>invalid};
}
const view={ox:6,oy:7,cell:44,width:11,height:9};

test('boss health uses current authoritative state and never invents phase or damage',()=>{
  const battle=room(),immutable=JSON.stringify(battle);
  const status=Fx.bossStatus(battle);
  assert.equal(status.name,'赤焰巨獸');
  assert.equal(status.maxHp,1000);
  assert.equal(status.ratio,1);
  assert.equal(status.phase,1);
  assert.equal(status.intent,'下次：烈焰吐息');
  assert.equal(JSON.stringify(battle),immutable);
  const half=Fx.bossStatus(room(boss({hp:470,phase:2})));
  assert.equal(half.ratio,.47);assert.equal(half.phase,2);
  assert.equal(Fx.bossStatus(room(boss({hp:0}))).alive,false);
  assert.equal(Fx.bossStatus(room(boss({hp:1500}))).ratio,1);
  assert.equal(Fx.bossStatus(room(boss({hp:-20}))).ratio,0);
  assert.equal(Fx.bossStatus({...battle,mode:'pvp'}),null);
  assert.equal(Fx.bossStatus({...battle,objective:{type:'sealing'}}),null);
  assert.equal(Fx.bossStatus({...battle,actors:[battle.actors[0]]}),null);
});

test('phase reveal triggers only on actual boss 1→2 transition in same live room',()=>{
  const before=room(),after=room(boss({hp:480,phase:2}),{revision:3});
  assert.deepEqual(Fx.phaseTransition(before,after),
    {type:'phase',name:'赤焰巨獸',phase:2,kind:'flame'});
  assert.equal(Fx.phaseTransition(after,after),null);
  assert.equal(Fx.phaseTransition(null,after),null);
  assert.equal(Fx.phaseTransition(before,{...after,id:'arena-b'}),null);
  assert.equal(Fx.phaseTransition(before,room(boss({hp:480,phase:1}),{revision:3})),null);
  assert.equal(Fx.phaseTransition(before,room(boss({hp:0,phase:2}),{revision:3})),null);
});

test('hit windows follow committed damage and separate combo strikes',()=>{
  const frozen=JSON.stringify(strikeScene);
  assert.deepEqual(Fx.hitWindows(strikeScene,A).map(w=>w.at),[.45]);
  assert.equal(Fx.contactAt(strikeScene,.42,A).length,0);
  assert.equal(Fx.contactAt(strikeScene,.46,A).length,1);
  assert.ok(Fx.shake(strikeScene,.46,A)>.1);
  assert.equal(Fx.shake(strikeScene,.9,A),0);
  assert.equal(Fx.hitWindows({...strikeScene,numbers:[]},A).length,0);
  assert.equal(Fx.hitWindows({...strikeScene,numbers:[{uid:'hero',heal:20}]},A).length,0);
  assert.equal(Fx.hitWindows({...strikeScene,numbers:[{uid:'hero',absorbed:10}]},A).length,1);
  const combo={...strikeScene,skill:'sky-cloud',strikeImpacts:[
    [{uid:'monster-0',damage:65}],
    [{uid:'monster-0',damage:82}]
  ]};
  const windows=Fx.hitWindows(combo,A);
  assert.equal(windows.length,2);assert.ok(windows[1].at>windows[0].at);
  assert.equal(Fx.contactAt(combo,windows[1].at+.01,A).length>=1,true);
  assert.deepEqual(Fx.hitWindows({kind:'damage',numbers:[{uid:'monster-0',damage:75}]},A)
    .map(w=>w.at),[.12]);
  assert.equal(JSON.stringify(strikeScene),frozen,'visual inspection never mutates events');
});

test('contact effects draw clipped sparks while leaving combat data intact',()=>{
  const c=canvas(),snapshot=JSON.stringify(strikeScene);
  Fx.drawHitEffects(c.ctx,strikeScene,.50,view,A);
  assert.ok(c.calls.includes('ellipse')&&c.calls.includes('gradient')&&c.calls.includes('stroke'));
  assert.equal(c.invalid(),0,'never passes NaN/infinite canvas coordinates');
  assert.equal(JSON.stringify(strikeScene),snapshot);
  const empty=canvas();
  Fx.drawHitEffects(empty.ctx,strikeScene,.05,view,A);
  assert.equal(empty.calls.length,0,'missed contact frames do not cover the battlefield');
});

test('boss atmosphere and phase pulse are clipped visual-only cues',()=>{
  const c=canvas(),before=room();
  Fx.drawBossPresence(c.ctx,boss({phase:2}),view,1500);
  assert.ok(c.calls.includes('gradient')&&c.calls.includes('ellipse'));
  const count=c.calls.length;
  Fx.drawBossPresence(c.ctx,boss({hp:0}),view,1500);
  assert.equal(c.calls.length,count,'defeated bosses have no ground aura');
  const phase={kind:'cast',style:'blast',actor:'monster-0',label:'赤焰巨獸進入第二階段',
    before:room().actors,after:room().actors};
  Fx.drawPhaseWave(c.ctx,phase,.44,view);
  assert.ok(c.calls.includes('arc'));
  assert.equal(c.invalid(),0);
  const count2=c.calls.length;
  Fx.drawPhaseWave(c.ctx,{...phase,label:'一般攻擊'},.44,view);
  assert.equal(c.calls.length,count2,'normal casts never show second-phase shockwaves');
  assert.equal(JSON.stringify(before),JSON.stringify(room()));
});
