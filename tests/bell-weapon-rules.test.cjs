'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../public/cultivation/bell-weapon-rules.js'),D=require('../public/cultivation/new-weapon-drafts.js'),R=require('../public/cultivation/tactical-rules.js'),C=require('../public/cultivation/dungeon-skill-resolution.js'),G=require('../public/cultivation/weapon-geometry.js');
const p=(x,y)=>({x,y}),origin=p(6,6),sk=id=>D.skillAtLevel(id,1,0);
const board={width:13,height:13,blocked:()=>false};
const trial=(position,blocks=[],hp=1000)=>{
  const s=R.create({id:'bell-test',mode:'pve',players:[{uid:'u',name:'u',atk:100,maxHp:10000,manualSkills:[]}],now:2000000000000});
  Object.assign(s,{width:13,height:13,blocks,objective:null,actors:s.actors.slice(0,2)});
  Object.assign(s.actors[0],{...origin,atk:100,stamina:10});
  Object.assign(s.actors[1],{...position,hp,maxHp:hp,shield:0,guard:0,counter:0,boss:false,footprint:{width:1,height:1}});
  return s;
};
const dungeon=(position,blocks=[],hp=1000)=>{
  const map={width:13,height:13,tiles:Array(169).fill(1)};
  for(const q of blocks)map.tiles[q.y*13+q.x]=0;
  return {map,room:{status:'assembled',battleAppliedTick:0,members:{u:{uid:'u',position:origin,battleHealth:10000,explorationStamina:10}},enemies:[{id:'e',kind:'wolf',position,battleHealth:hp,battleMaxHealth:hp}]}};
};
test('bell geometry distinguishes selectable aims and four square rings',()=>{
  const strike=B.plans(board,origin,sk('bell-strike'));
  assert.equal(strike.aims.length,8);assert.equal(strike.cells.length,8);
  assert.deepEqual(B.selected(board,origin,sk('bell-strike'),p(7,6)).cells,[p(7,6),p(8,6)]);
  assert.equal(B.selected(board,origin,sk('bell-strike'),p(7,7)),null);
  const shock=B.selected(board,origin,sk('bell-shock'),origin);
  assert.equal(shock.cells.length,24);assert.ok(!shock.cells.some(q=>G.key(q)===G.key(origin)));
  const echo=B.selected(board,origin,sk('bell-echo'),origin);
  assert.deepEqual(echo.steps.map(s=>s.cells.length),[8,16,24,32]);assert.equal(echo.cells.length,80);
  const blocked={...board,blocked:q=>q.x===7&&q.y===6};
  assert.equal(B.selected(blocked,origin,sk('bell-strike'),p(8,6)),null);
});
test('actual trial preview and realtime cast settle 4/3/2/1 hits with matching landings',()=>{
  for(let radius=1;radius<=4;radius++){
    const start=p(6+radius,6),s=trial(start),before=JSON.stringify(s),skill=sk('bell-echo');
    const out=R.previewCast(s,s.actors[0],skill,origin);
    assert.equal(JSON.stringify(s),before);assert.equal(out.cells.length,80);
    assert.equal(out.hits.length,5-radius);assert.ok(out.hits.every(h=>h.damage===65));
    assert.deepEqual(out.bellSteps.map(q=>q.hits.length),Array.from({length:4},(_,i)=>i+1>=radius?1:0));
    assert.deepEqual(out.landings,[p(11,6)]);
    const {room,map}=dungeon(start),saved=JSON.stringify(room);
    const actual=C.resolveCast(room,'u',map,skill,{target:origin,seq:1,base:100});
    assert.equal(JSON.stringify(room),saved);assert.equal(actual.result.totalDamage,65*(5-radius));
    assert.deepEqual(actual.enemies[0].position,p(11,6));assert.equal(actual.result.effectCells.length,80);
    assert.equal(actual.members.u.explorationStamina,6);
    assert.deepEqual(actual.result.bellSteps.map(q=>q.hits.length),out.bellSteps.map(q=>q.hits.length));
    const preview=C.resolveCast(room,'u',map,skill,{target:origin,seq:1,base:100,preview:true});
    assert.deepEqual(preview,actual);
  }
});
test('wall and death stop subsequent echo hits in both resolvers',()=>{
  for(const [blocks,hp] of [[[p(8,6)],1000],[[],40]]){
    const s=trial(p(7,6),blocks,hp),skill=sk('bell-echo');
    const out=R.previewCast(s,s.actors[0],skill,origin);
    assert.equal(out.hits.length,1);assert.equal(out.moves.length,0);
    const {room,map}=dungeon(p(7,6),blocks,hp);
    const actual=C.resolveCast(room,'u',map,skill,{target:origin,seq:1,base:100});
    assert.equal(actual.result.hits.length,1);assert.equal(actual.result.visualMoves.length,0);
    if(hp===40)assert.equal(actual.enemies.length,0);
  }
});
test('shock damages once and moves one cell; strike is 130 percent with no push',()=>{
  for(const [id,target,damage,end] of [['bell-shock',origin,165,p(8,6)],['bell-strike',p(7,6),130,p(7,6)]]){
    const s=trial(p(7,6)),skill=sk(id),out=R.previewCast(s,s.actors[0],skill,target);
    assert.equal(out.hits.length,1);assert.equal(out.hits[0].damage,damage);
    const {room,map}=dungeon(p(7,6));const actual=C.resolveCast(room,'u',map,skill,{target,seq:1,base:100});
    assert.equal(actual.result.totalDamage,damage);assert.deepEqual(actual.enemies[0].position,end);
  }
});
test('large footprints hit once per ring, and movement checks complete occupancy',()=>{
  const big={uid:'large',x:7,y:6,hp:1000,footprint:{width:2,height:2}},other={uid:'other',x:9,y:7,hp:1000};
  const plan=B.selected(board,origin,sk('bell-echo'),origin);
  const steps=B.resolve(plan,{targets:()=>[big],alive:e=>e.hp>0,covers:(e,q)=>G.footprint(e).some(c=>G.key(c)===G.key(q)),apply:(e,power)=>({damage:Math.round(100*power)}),push:(e,d)=>{const to={x:e.x+d.x,y:e.y+d.y};if(G.canPlace(board,e,to,[big,other]))Object.assign(e,to)}});
  assert.ok(steps.every(q=>q.hits.length<=1));assert.deepEqual(steps.map(q=>q.hits.length),[1,1,0,0]);
  assert.deepEqual(p(big.x,big.y),p(7,6));assert.ok(steps.every(q=>q.moves.length===0));
  const s=trial(p(7,6));s.actors[1].footprint={width:2,height:2};
  const out=R.previewCast(s,s.actors[0],sk('bell-echo'),origin);
  assert.ok(out.bellSteps.every(q=>q.hits.length<=1));
});
test('ally occupancy blocks knockback and low-stamina preview remains non-mutating',()=>{
  const s=trial(p(7,6));s.actors.push({...s.actors[0],uid:'ally',x:8,y:6});
  s.actors[0].stamina=0;const before=JSON.stringify(s);
  const out=R.skillPreviewPlan(s,s.actors[0],sk('bell-echo')).byAim['6,6'];
  assert.equal(out.valid,false);assert.equal(out.hits.length,1);assert.deepEqual(out.landings,[]);
  assert.equal(JSON.stringify(s),before);
  const {room,map}=dungeon(p(7,6));room.members.ally={uid:'ally',position:p(8,6)};
  const actual=C.resolveCast(room,'u',map,sk('bell-echo'),{target:origin,seq:1,base:100});
  assert.equal(actual.result.totalDamage,65);assert.deepEqual(actual.enemies[0].position,p(7,6));
});
