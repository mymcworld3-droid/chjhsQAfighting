'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const R=require('../public/cultivation/tactical-rules.js'),api=require('../tactical-combat-api.cjs').__test;
const {database}=require('./helpers/tactical-db.cjs');
const now=2000000000000;
function scene(species,hero={x:6,y:4},monster={x:5,y:4}){
  const s=R.create({id:'arena-0123456789abcdef',mode:'pve',map:'ruins',players:[{uid:'u1',name:'修士',atk:200,maxHp:10000}],now});
  s.blocks=[];s.actors=[R.actor({uid:'u1',name:'修士',atk:200,maxHp:10000},hero),R.actor({uid:'monster',name:R.monsterProfile(species).name,bot:true,team:'monster',species,atk:100,maxHp:5000},monster)];
  s.actors[0].stamina=10;s.actors[0].turns=1;R.prepareIntents(s);return s;
}
test('all twenty monsters unlock progressively and every milestone guarantees the introduced species',()=>{
  const names=new Set(),behaviors=new Set(),encountered=new Set();
  for(const p of R.MONSTERS){
    names.add(p.name);behaviors.add(JSON.stringify([p.attack,p.move]));
    assert.ok(p.attackText&&p.moveText&&p.tip);assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.attack)&&Object.isFrozen(p.move));
  }
  assert.equal(names.size,20);assert.equal(behaviors.size,20);
  for(let stage=1;stage<=80;stage++){
    const layout=R.stageLayout('bestiary-unlock-test',stage),intro=R.MONSTERS.find(p=>p.unlockStage===stage);
    assert.deepEqual(layout,R.stageLayout('bestiary-unlock-test',stage));
    assert.ok(layout.enemies.every(m=>R.monsterProfile(m.species).unlockStage<=stage));
    if(intro)assert.equal(layout.enemies[0].species,intro.species);
    for(const m of layout.enemies)encountered.add(m.species);
  }
  assert.equal(encountered.size,20);assert.deepEqual(R.stageLayout('first',1).enemies.map(m=>m.species),[0]);
});
test('every monster has a real attack, a bounded warning, and a safe dodge without retargeting',()=>{
  for(const profile of R.MONSTERS){
    let s;
    for(let y=0;y<9&&!s;y++)for(let x=0;x<11&&!s;x++){
      if(x===5&&y===4)continue;const candidate=scene(profile.species,{x,y});
      if(candidate.actors[1].intent.kind==='attack')s=candidate;
    }
    assert.ok(s,profile.name+' must be able to attack');
    const warning=s.actors[1].intent,cells=warning.cells,keys=new Set(cells.map(R.key));
    assert.equal(keys.size,cells.length);assert.ok(cells.every(p=>R.inside(s,p)&&!R.blocked(s,p)));
    const hit=R.apply(s,'u1',{type:'end'},now);
    assert.equal(hit.actors[0].hp,10000-Math.round(100*(profile.attack.power||1)),profile.name+' hits the warned target');
    if(profile.attack.slow)assert.equal(hit.actors[0].slow,1,profile.name+' applies its advertised slow');
    const safe=R.moveCells(s,s.actors[0]).find(p=>!keys.has(R.key(p)));
    assert.ok(safe,profile.name+' must offer a reachable escape');
    const moved=R.apply(s,'u1',{type:'move',x:safe.x,y:safe.y},now);
    assert.deepEqual(moved.actors[1].intent,warning,'moving the player does not retarget the warning');
    const dodge=R.apply(moved,'u1',{type:'end'},now);
    assert.equal(dodge.actors[0].hp,10000,profile.name+' misses outside its red cells');
  }
});
test('all monster movement obeys its budget, empty landing cells and diagonal corner rules',()=>{
  for(const p of R.MONSTERS){
    const s=scene(p.species,{x:10,y:8},{x:0,y:0}),m=s.actors[1],route=R.monsterRoute(s,m,s.actors[0]);
    assert.deepEqual(route[0],{x:0,y:0});assert.ok(route.every(n=>R.inside(s,n)&&!R.blocked(s,n)));
    if(p.move.kind==='rooted'){assert.equal(route.length,1);continue;}
    assert.ok(route.length>1,p.name+' approaches when outside its attack range');
    const jumping=['leap','hop','fly','teleport'].includes(p.move.kind);
    if(jumping){assert.equal(route.length,2);const end=route[1],distance=p.move.kind==='fly'?Math.max(end.x,end.y):R.dist(m,end);assert.ok(distance<=p.move.steps);}
    else {assert.ok(route.length-1<=p.move.steps);for(let i=1;i<route.length;i++)assert.ok(R.dist(route[i-1],route[i])<=(p.move.kind==='diagonal'?2:1));}
    assert.ok(route.slice(1).every(n=>!R.at(s,n)));
  }
  const kiter=scene(6),before=R.dist(kiter.actors[1],kiter.actors[0]),route=R.monsterRoute(kiter,kiter.actors[1],kiter.actors[0]);
  assert.equal(kiter.actors[1].intent.kind,'advance');assert.ok(R.dist(route.at(-1),kiter.actors[0])>before,'scorpion retreats when crowded');
});
test('leaping and flying cross intervening rocks but never land on blocked or occupied cells',()=>{
  for(const species of [4,12,14,19]){
    const s=scene(species,{x:8,y:4},{x:3,y:4});s.blocks=Array.from({length:9},(_,y)=>({x:4,y}));
    const route=R.monsterRoute(s,s.actors[1],s.actors[0]);assert.ok(route.at(-1).x>4,R.monsterProfile(species).name);
    assert.ok(!R.blocked(s,route.at(-1))&&!R.at(s,route.at(-1)));
  }
});
test('charges stop at an intervening actor and displacement interrupts an already warned attack',()=>{
  const charge=scene(1,{x:6,y:4},{x:3,y:4});assert.equal(charge.actors[1].intent.kind,'attack');
  const blocker=R.actor({uid:'blocker',name:'石障獸',bot:true,species:8,team:'monster',atk:1,maxHp:1000},{x:4,y:4,intent:{kind:'wait',cells:[]}});charge.actors.push(blocker);
  const stopped=R.apply(charge,'u1',{type:'end'},now);assert.equal(stopped.actors[0].hp,10000);assert.equal(stopped.actors[1].x,3);
  const pushed=scene(0,{x:3,y:4},{x:4,y:4});Object.assign(pushed.actors[0],{core:'ocean',branch:'surge'});
  const after=R.apply(pushed,'u1',{type:'skill',x:4,y:4},now);
  assert.equal(after.actors[1].intent.kind,'stagger');assert.deepEqual(after.actors[1].intent.cells,[]);
  assert.equal(R.apply(after,'u1',{type:'end'},now).actors[0].hp,10000);
});
test('guardian alternates cross and targeted blast; shell ring and poison ring retain safe centers',()=>{
  const s=scene(18,{x:6,y:4});assert.equal(s.actors[1].intent.cells.length,5);
  s.turn=2;R.prepareIntents(s);assert.equal(s.actors[1].intent.cells.length,12);
  const turtle=scene(17,{x:7,y:4});const cells=turtle.actors[1].intent.cells;
  assert.equal(cells.length,16);assert.ok(!cells.some(p=>p.x===6&&p.y===4));
  const toad=scene(14,{x:8,y:4}),ring=toad.actors[1].intent.cells;
  assert.equal(ring.length,8);assert.ok(!ring.some(p=>p.x===7&&p.y===4));
});
test('first encounter acknowledgements persist per account and are idempotent, authenticated and revision neutral',async()=>{
  const db=database(),s=await api.start(db,'u1',{mode:'pve'},now);assert.deepEqual(s.newEnemies,[0]);assert.equal('pendingIntroductions'in s,false);
  const input={roomId:s.id,species:0,seen:[...Array(20).keys()]},before=structuredClone(db.records.get('users/u1'));
  await assert.rejects(api.acknowledgeEnemy(db,'u2',input),/參戰/);
  await assert.rejects(api.acknowledgeEnemy(db,'u1',{...input,species:19}),/目前試煉/);
  const [a,b]=await Promise.all([api.acknowledgeEnemy(db,'u1',input),api.acknowledgeEnemy(db,'u1',input)]);
  assert.deepEqual(a.newEnemies,[]);assert.deepEqual(b.newEnemies,[]);assert.equal(a.revision,s.revision);
  assert.deepEqual(db.records.get(api.PLAYERS+'/u1').bestiary.seen,[0]);assert.deepEqual(db.records.get('users/u1'),before);
  assert.deepEqual((await api.start(db,'u2',{mode:'pve'},now)).newEnemies,[0],'seen species belong to each account');
  assert.deepEqual((await api.start(db,'u1',{mode:'pve'},now)).newEnemies,[]);
  await api.command(db,'u1',{type:'leave',roomId:s.id,requestId:'bestiary-forfeit-01'},now);
  assert.deepEqual((await api.start(db,'u1',{mode:'pve'},now)).newEnemies,[],'retry does not repeat a seen introduction');
});
test('multiple new species are queued once each and interrupted introductions survive reload',async()=>{
  const db=database(),first=await api.start(db,'u1',{mode:'pve'},now),raw=db.records.get(api.ROOMS+'/'+first.id);
  for(const [i,species]of [8,8,1].entries())raw.actors.push(R.actor({uid:'new-'+i,name:'妖獸',species,bot:true,team:'monster'},{x:i+2,y:0}));
  delete raw.pendingIntroductions;
  const beforeMigration=JSON.stringify([...db.records]);assert.deepEqual((await api.state(db,'u1',now)).newEnemies,[0,8,1]);
  assert.equal(JSON.stringify([...db.records]),beforeMigration,'deriving old-room introductions remains read-only');
  assert.deepEqual((await api.start(db,'u1',{mode:'pve'},now)).newEnemies,[0,8,1]);
  await api.acknowledgeEnemy(db,'u1',{roomId:first.id,species:0});
  assert.deepEqual((await api.start(db,'u1',{mode:'pve'},now)).newEnemies,[8,1]);
  await api.acknowledgeEnemy(db,'u1',{roomId:first.id,species:8});
  assert.deepEqual((await api.state(db,'u1',now)).newEnemies,[1]);
  const before=JSON.stringify([...db.records]);await api.state(db,'u1',now);assert.equal(JSON.stringify([...db.records]),before,'ordinary state reads do not write');
});
test('retrying v1 and pre-seed battles preserves their map before upgrading on a later stage',async()=>{
  for(const version of [0,1]){
    const db=database(),first=await api.start(db,'u1',{mode:'pve'},now),pointer=db.records.get(api.PLAYERS+'/u1');
    const old=R.create({id:first.id,mode:'pve',map:'bamboo',players:[{uid:'u1',atk:200,maxHp:1100}],trial:{...pointer.trial,layoutVersion:version},now});
    db.records.set(api.ROOMS+'/'+first.id,old);await api.command(db,'u1',{type:'leave',roomId:first.id,requestId:'old-layout-leave-'+version},now);
    const retry=await api.start(db,'u1',{mode:'pve',map:'ruins'},now);
    assert.equal(retry.trial.layoutVersion,version);assert.equal(retry.map,old.map);assert.deepEqual(retry.blocks,old.blocks);assert.deepEqual(retry.ground,old.ground);
    assert.deepEqual(retry.actors.map(a=>[a.species,a.x,a.y,a.maxHp]),old.actors.map(a=>[a.species,a.x,a.y,a.maxHp]));
    const finishing=db.records.get(api.ROOMS+'/'+retry.id);finishing.blocks=[];finishing.actors=finishing.actors.slice(0,2);
    Object.assign(finishing.actors[0],{x:1,y:3,stamina:4});Object.assign(finishing.actors[1],{x:2,y:3,hp:1});
    await api.command(db,'u1',{type:'attack',x:2,y:3,roomId:retry.id,revision:retry.revision,requestId:'old-layout-win-'+version},now);
    const next=await api.start(db,'u1',{mode:'pve'},now);assert.equal(next.trial.stage,2);assert.equal(next.trial.layoutVersion,2);
  }
});
test('v1 seeded geometry and enemy snapshots remain compatible with the previous generator',()=>{
  const hashes={1:'be70a3189f43de126cf1890d5503bd78080658e3708ff52d4be486d010c451e6',7:'ed24f4926a5062348cf662e01484f2bbf1f4d45718648d28c2e04fe2e0b19432',20:'2866235924c553d235c1b38b0934a6bf381e4a4124c538d8b3f11f8a35f254ba'};
  for(const [stage,expected]of Object.entries(hashes)){
    const p=R.stageLayout('legacy-stable-map',Number(stage),1),enemies=p.enemies.map(({level,...m})=>m);
    const body=JSON.stringify({width:p.width,height:p.height,terrain:p.terrain,ground:p.ground,blocks:p.blocks,spawn:p.spawn,enemies});
    assert.equal(crypto.createHash('sha256').update(body).digest('hex'),expected);
  }
});
