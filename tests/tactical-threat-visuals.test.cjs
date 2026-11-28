'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Visual=require('../public/cultivation/tactical-threat-visuals.js');
const point=(x,y)=>({x,y});
const state=()=>({
  mode:'pve',width:7,height:7,status:'active',turnUid:'u1',
  actors:[
    {uid:'u1',name:'修士',hp:100,maxHp:100,x:3,y:3},
    {uid:'wolf',bot:true,species:0,x:3,y:2,hp:60,maxHp:60,
      intent:{kind:'attack',origin:point(3,2),cells:[point(3,3),point(3,3)],text:'下次：撲咬'}},
    {uid:'boss',bot:true,boss:true,x:5,y:3,hp:300,maxHp:500,
      intent:{kind:'boss-attack',origin:point(5,3),cells:[point(3,3),point(4,3)],text:'下次：鎮壓'}}
  ],objective:{type:'boss',hazards:[point(5,5)]}
});
const moves=[
  {x:3,y:4,cost:1},{x:2,y:3,cost:1},
  {x:4,y:3,cost:1},{x:5,y:5,cost:4},
  {x:1,y:3,cost:2}
];
test('threats use current locked server intents with deduped cells and boss source',()=>{
  const s=state(),frozen=JSON.stringify(s);
  const p=Visual.derive(s,'u1','move',moves);
  assert.equal(p.playerThreatened,true);
  assert.equal(p.attackers,2);
  assert.equal(p.cells.length,3,'multiple attackers share a single danger cell');
  assert.deepEqual(p.byKey['3,3'].attackers,['wolf','boss']);
  assert.equal(p.byKey['3,3'].boss,true);
  assert.equal(p.byKey['5,5'].hazard,true);
  assert.match(p.description,/受到攻擊或場地危險預告/);
  assert.equal(JSON.stringify(s),frozen,'projection never modifies authoritative state');
});

test('out-of-bounds and stale telegraphs are removed, non-attacks are ignored',()=>{
  const s=state();
  s.actors[1].x=2; // A displaced wolf cannot execute a locked attack at its old origin.
  s.actors[2].intent.cells.push(point(-1,3),point(999,5),point(2.5,3),null);
  s.actors[2].intent.cells.push(point(3,3));
  const p=Visual.derive(s,'u1');
  assert.equal(p.attackers,1,'only the boss remains a live attacker');
  assert.equal(p.byKey['3,3'].attackers.length,1);
  assert.equal(p.cells.length,3);
  s.actors[2].intent.kind='advance';
  const q=Visual.derive(s,'u1');
  assert.equal(q.attackers,0);
  assert.equal(q.cells.length,1,'field hazard remains marked even without attacking creatures');
  assert.equal(q.playerThreatened,false);
  assert.equal(Visual.derive({...s,mode:'pvp'},'u1').cells.length,0);
  assert.equal(Visual.derive(s,'unknown').cells.length,0);
  s.actors[2].hp=0;s.actors[2].intent.kind='attack';
  assert.equal(Visual.derive(s,'u1').attackers,0,'defeated enemy can no longer telegraph');
});

test('escape hints are actually reachable and outside current telegraphs',()=>{
  const s=state(),p=Visual.derive(s,'u1','move',moves);
  assert.equal(p.landingHints.length,2);
  assert.ok(p.landingHints.every(h=>!p.byKey[h.x+','+h.y]));
  assert.ok(p.landingHints.every(h=>moves.some(m=>m.x===h.x&&m.y===h.y&&m.cost===h.cost)));
  assert.equal(p.landingHints[0].cost,1);
  assert.deepEqual(Visual.derive(s,'u1','attack',moves).landingHints,[]);
  assert.deepEqual(Visual.derive({...s,turnUid:'other'},'u1','move',moves).landingHints,[]);
  s.actors[0].x=0;s.actors[0].y=0;
  assert.equal(Visual.derive(s,'u1','move',moves).playerThreatened,false);
  assert.deepEqual(Visual.derive(s,'u1','move',moves).landingHints,[]);
});

function mock(){
  const log=[],ctx={};
  for(const fn of ['save','restore','beginPath','rect','clip','fillRect','strokeRect',
    'moveTo','lineTo','stroke','fill','arc','fillText']){
    ctx[fn]=(...args)=>{
      assert.ok(args.every(a=>typeof a!=='number'||Number.isFinite(a)),fn+' never receives NaN');
      log.push(fn);
    };
  }
  return {ctx,log};
}
test('canvas danger markings and 2 suggested landing tiles render without altering state',()=>{
  const s=state(),p=Visual.derive(s,'u1','move',moves);
  const prev=JSON.stringify(s),v={ox:17,oy:21,cell:44,width:7,height:7};
  const a=mock();
  Visual.drawGround(a.ctx,p,v);
  assert.ok(a.log.includes('fillRect')&&a.log.includes('stroke'));
  const b=mock();
  Visual.drawContours(b.ctx,p,v);
  assert.ok(b.log.includes('stroke'));
  const c=mock();
  Visual.drawGuidance(c.ctx,p,v,false);
  assert.ok(c.log.includes('fillText')&&c.log.includes('arc'));
  assert.equal(JSON.stringify(s),prev,'drawing never mutates state');
  const empty=mock();
  Visual.drawGround(empty.ctx,Visual.derive({...s,mode:'pvp'},'u1'),v);
  Visual.drawGuidance(empty.ctx,{playerThreatened:false},v);
  assert.deepEqual(empty.log,[],'no PvP or non-threat overlays');
});

test('v3 warning marks preserve exact server geometry, charge direction and echo layer',()=>{
 const s=state();s.actors[1].intent={version:3,kind:'attack',origin:point(3,2),cells:[point(3,3)],shape:'charge',warning:'locked',direction:point(0,1)};
 s.actors[2].intent={version:3,kind:'attack',origin:point(5,3),cells:[point(3,3),point(4,3)],shape:'square',warning:'locked',waves:[{layer:1,cells:[point(4,3)]},{layer:2,cells:[point(3,3)]}]};
 const before=JSON.stringify(s),p=Visual.derive(s,'u1','move',moves);
 assert.equal(p.cells.length,3);assert.deepEqual(p.byKey['3,3'].marks,[{source:'wolf',shape:'charge',locked:true,direction:point(0,1)},{source:'boss',shape:'square',locked:true,layer:2}]);
 assert.equal(p.byKey['4,3'].marks[0].layer,1);const m=mock();Visual.drawGround(m.ctx,p,{ox:0,oy:0,cell:36,width:7,height:7});assert.ok(m.log.includes('fillText'));assert.equal(JSON.stringify(s),before);
});
