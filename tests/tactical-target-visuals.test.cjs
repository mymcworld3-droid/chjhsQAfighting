'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../public/cultivation/tactical-rules.js');
const Visual=require('../public/cultivation/tactical-target-visuals.js');
const Threats=require('../public/cultivation/tactical-threat-visuals.js');
const now=2000000000000;
function battle(){
  const state=R.create({id:'arena-target-visuals',players:[
    {uid:'u1',name:'修士',atk:200,maxHp:1800,core:'thunder',branch:'lightning'}
  ],now});
  state.blocks=[];
  Object.assign(state.actors[0],{x:1,y:3,hp:1000,stamina:10,actions:0,attacks:0});
  Object.assign(state.actors[1],{x:3,y:3,hp:2000,maxHp:2000,team:'monster'});
  return state;
}
test('route preview uses actual BFS cells, stamina cost and server movement constraints',()=>{
  const s=battle(),snapshot=JSON.stringify(s);
  const plan=Visual.derive(s,'u1','move',{x:1,y:5},R,Threats.derive(s,'u1'));
  assert.ok(plan,'valid tile is inspectable');
  assert.equal(plan.type,'move');
  assert.equal(plan.cost,2);
  assert.equal(plan.remaining,8);
  assert.equal(plan.valid,true);
  assert.equal(plan.route.length,3);
  assert.equal(plan.route[0].x,1);
  assert.deepEqual(plan.route.at(-1),{x:1,y:5});
  assert.equal(JSON.stringify(s),snapshot,'no gameplay state mutation');
  const unreachable=Visual.derive(s,'u1','move',{x:3,y:3},R);
  assert.equal(unreachable.valid,false,'occupied monster tile cannot be traversed');
  assert.equal(unreachable.route.length,0);
  assert.equal(Visual.derive(s,'u1','move',{x:-1,y:0},R),null);
  assert.equal(Visual.derive(s,'u1','move',{x:100,y:2},R),null);
  assert.equal(Visual.derive({...s,mode:'pvp'},'u1','move',{x:1,y:5},R),null);
});
test('insufficient stamina, slow and off-turn paths are never marked executable',()=>{
  const s=battle();s.actors[0].stamina=1;
  const low=Visual.derive(s,'u1','move',{x:1,y:5},R);
  assert.equal(low.valid,false);assert.equal(low.remaining,-1);
  assert.match(low.hint,/體力不足/);
  s.actors[0].stamina=10;s.actors[0].slow=1;
  const slow=Visual.derive(s,'u1','move',{x:1,y:6},R);
  assert.equal(slow.valid,false);
  s.actors[0].slow=0;s.turnUid='another';
  const offTurn=Visual.derive(s,'u1','move',{x:1,y:4},R);
  assert.equal(offTurn.valid,false);
  assert.match(offTurn.hint,/等待行動回合/);
});
test('attack preview respects actual skill geometry, never estimates or changes damage',()=>{
  const s=battle(),snapshot=JSON.stringify(s);
  const attack=Visual.derive(s,'u1','attack',{x:3,y:3},R);
  assert.equal(attack.type,'attack');
  assert.equal(attack.cost,R.basicFor(s.actors[0]).cost);
  assert.equal(attack.valid,true);
  assert.equal(attack.affected.length,1);
  assert.equal(attack.affected[0].uid,s.actors[1].uid);
  assert.deepEqual(attack.cells,R.techniquePreview(s,s.actors[0],R.basicFor(s.actors[0]),{x:3,y:3}).cells);
  assert.equal('damage' in attack,false,'never invent a damage amount');
  const diagonal=Visual.derive(s,'u1','attack',{x:2,y:4},R);
  assert.equal(diagonal.valid,false);
  assert.equal(diagonal.affected.length,0);
  const empty=Visual.derive(s,'u1','attack',{x:1,y:1},R);
  assert.equal(empty.valid,true);
  assert.equal(empty.affected.length,0);
  assert.equal(JSON.stringify(s),snapshot);
});
test('threatened movement destination is labeled without claiming guaranteed safety',()=>{
  const s=battle();s.actors[1].intent={kind:'attack',origin:{x:3,y:3},
    cells:[{x:1,y:4}],text:'下次：撲咬'};
  const threats=Threats.derive(s,'u1');
  const p=Visual.derive(s,'u1','move',{x:1,y:4},R,threats);
  assert.equal(p.valid,true);
  assert.equal(p.threatened,true);
  assert.match(p.hint,/攻擊預告內/);
});
function mock(){
  const ops=[],ctx={};
  for(const k of ['save','restore','beginPath','rect','clip','setLineDash','moveTo',
    'lineTo','stroke','fill','arc','ellipse','fillText','roundRect']){
    ctx[k]=(...args)=>{
      assert.ok(args.every(x=>typeof x!=='number'||Number.isFinite(x)),k+' receives only finite numbers');
      ops.push(k);
    };
  }
  ctx.measureText=text=>({width:text.length*6});
  return {ctx,ops};
}
test('route markers and enemy focus are visual-only and clipped to actual board',()=>{
  const s=battle(),snapshot=JSON.stringify(s),view={ox:0,oy:3,cell:44,width:7,height:7};
  const route=Visual.derive(s,'u1','move',{x:1,y:5},R);
  const a=mock();Visual.drawRoute(a.ctx,route,view);
  assert.ok(a.ops.includes('lineTo')&&a.ops.includes('fillText'));
  const attack=Visual.derive(s,'u1','attack',{x:3,y:3},R);
  const b=mock();Visual.drawFocus(b.ctx,attack,view);
  assert.ok(b.ops.includes('ellipse')&&b.ops.includes('roundRect'));
  assert.equal(JSON.stringify(s),snapshot);
  const absent=mock();Visual.drawRoute(absent.ctx,null,view);Visual.drawFocus(absent.ctx,null,view);
  assert.deepEqual(absent.ops,[]);
});
