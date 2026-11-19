'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PROJECT_IDS}=require('../firebase-admin-projects.cjs');
const {__test:API}=require('../dungeon-room-api.cjs');
const {generateDungeonLayout,LAYOUT_VERSION}=require('../dungeon-map-generator.cjs');
const SECRET='0a1b2c3d4e5f60718293a4b5';

function store(initial={}){
  const records=new Map(Object.entries(initial));let serial=0,chain=Promise.resolve();
  const clone=value=>structuredClone(value);
  const snap=ref=>({id:ref.id,exists:records.has(ref.key),data:()=>clone(records.get(ref.key))});
  const doc=(collection,id)=>{
    const name=id||'dungroom'+String(++serial).padStart(8,'0');
    const ref={id:name,key:collection+'/'+name};
    ref.get=async()=>snap(ref);
    return ref;
  };
  return {records,collection(collection){return {doc:id=>doc(collection,id)};},
    runTransaction(fn){
      const task=chain.then(async()=>{
        const changes=new Map();let written=false;
        const tx={
          get:async ref=>{
            assert.equal(written,false,'Firestore transactions must read before writes');
            return snap(ref);
          },
          set:(ref,value)=>{written=true;changes.set(ref.key,clone(value));},
          update:(ref,value)=>{
            written=true;changes.set(ref.key,{
              ...clone(changes.get(ref.key)||records.get(ref.key)),...clone(value)
            });
          }
        };
        const result=await fn(tx);
        for(const [id,value]of changes)records.set(id,value);
        return result;
      });
      chain=task.catch(()=>{});
      return task;
    }
  };
}
function fixture(){
  const players=Object.fromEntries('abcd'.split('').map(uid=>['users/'+uid,
    {uid,displayName:'修士'+uid,stats:{totalScore:50},raidTickets:{count:4}}]));
  const a=store(players),c=store();let at=1800000000000;
  const build=()=>API.createHandler({
    resolveA:()=>({db:a,auth:{verifyIdToken:async token=>{
      if(token==='invalid')throw Error('expired');
      return {uid:token,aud:PROJECT_IDS.A,
        iss:'https://securetoken.google.com/'+PROJECT_IDS.A};
    }}}),
    resolveC:()=>({db:c}),seedFactory:()=>SECRET,
    clock:()=>at,logger:{error(){}}
  });
  const handlers=[build(),build()];
  async function call(uid,action,body={},instance=0){
    let status=200,result;
    await handlers[instance]({
      body:{action,...body},
      get:field=>field==='authorization'?'Bearer '+uid:''
    },{
      set(){return this;},
      status(value){status=value;return this;},
      json(value){result=value;return this;}
    });
    return {status,body:result};
  }
  return {a,c,call,clock:advance=>{at+=advance;}};
}

const {walkable}=require('../dungeon-map-generator.cjs');
const Combat=require('../dungeon-enemy-combat.cjs');
const ROOMS='dungeonRooms';
const directions=[[0,1],[1,0],[0,-1],[-1,0]];
const nextTo=(map,p,except=[])=>directions.map(([dx,dy])=>
  ({x:p.x+dx,y:p.y+dy})).find(q=>
    walkable(map,q)&&except.every(e=>e.x!==q.x||e.y!==q.y));
async function setup(){
  const f=fixture(),created=(await f.call('a','create')).body;
  const id=created.roomId;
  await f.call('b','join-code',{roomCode:created.room.code},1);
  for(const uid of 'ab')await f.call(uid,'ready',{roomId:id,ready:true});
  const initial=(await f.call('a','start',{roomId:id})).body.room;
  const map=generateDungeonLayout(SECRET);
  const raw=f.c.records.get(ROOMS+'/'+id);
  // Place a single trusted NPC adjacent to a waiting player.
  const player=raw.members.a.position;
  const around=nextTo(map,player,[raw.members.b.position]);
  assert.ok(around);
  raw.enemies=[{...raw.enemies.find(e=>e.kind==='wolf'),
    position:around,attack:null,lastAttack:null,lastAttackTick:0}];
  return {f,id,map,initial,raw};
}
test('room assembly grants isolated HP and a server clock transaction publishes warned strike',async()=>{
  const {f,id,raw}=await setup();
  assert.equal(raw.members.a.battleHealth,raw.members.a.battleMaxHealth);
  assert.equal(raw.members.b.battleHealth,raw.members.b.battleMaxHealth);
  const original=structuredClone(f.a.records.get('users/a'));
  f.clock(2000);
  const first=await f.call('b','clock',{roomId:id,tick:1e6,damage:1e6,
    battleHealth:-9,enemyAttack:{cells:[{x:0,y:0}]},paused:true},1);
  assert.equal(first.status,200);
  const snap=(await f.call('a','get',{roomId:id})).body.room;
  assert.equal(snap.enemies.length,1);
  assert.equal(snap.battleClock.appliedTick,2);
  assert.equal(snap.enemies[0].attack.damage,8);
  assert.equal(snap.enemies[0].attack.startedAtTick,2);
  assert.equal(snap.enemies[0].attack.resolvesAtTick,4);
  assert.ok(snap.enemies[0].attack.cells.some(p=>
    p.x===snap.members.a.position.x&&p.y===snap.members.a.position.y));
  assert.ok(!Object.hasOwn(snap.enemies[0],'patrolIndex'));
  assert.ok(!Object.hasOwn(snap.enemies[0],'spawn'));
  assert.equal(snap.members.a.battleHealth,snap.members.a.battleMaxHealth);
  assert.deepStrictEqual(f.a.records.get('users/a'),original);
});
test('unmoved player loses HP once across four simultaneous server requests',async()=>{
  const {f,id,raw}=await setup();
  f.clock(2000);
  await f.call('a','clock',{roomId:id});
  const before=raw.revision;
  f.clock(2000);
  const replies=await Promise.all([
    f.call('a','clock',{roomId:id},0),f.call('b','clock',{roomId:id},1),
    f.call('a','heartbeat',{roomId:id},0),
    f.call('b','heartbeat',{roomId:id},1)
  ]);
  assert.ok(replies.every(r=>r.status===200));
  const stored=f.c.records.get(ROOMS+'/'+id);
  assert.equal(stored.members.a.battleHealth,stored.members.a.battleMaxHealth-Combat.scaledDamage(8,stored.members.a));
  assert.equal(stored.members.a.lastDamage.tick,4);
  assert.equal(stored.members.b.battleHealth,stored.members.b.battleMaxHealth);
  assert.equal(stored.battleAppliedTick,4);
  assert.equal(stored.enemies[0].lastAttack.hits.length,1);
  assert.equal(stored.revision,before+2,'arm and resolve each commit once');
  assert.equal((await f.call('a','clock',{roomId:id})).body.clock.appliedTick,4);
  assert.equal(f.c.records.get(ROOMS+'/'+id).members.a.battleHealth,stored.members.a.battleMaxHealth-Combat.scaledDamage(8,stored.members.a));
});
test('legal one-tile dodge after telegraph avoids damage and deducts only exploration stamina',async()=>{
  const {f,id,map,raw}=await setup();
  const first=raw.members.a.position;
  f.clock(2000);
  await f.call('b','clock',{roomId:id},1);
  const enemy=raw.enemies[0];
  const dir=directions.find(([dx,dy])=>{
    const p={x:first.x+dx,y:first.y+dy};
    return walkable(map,p)&&
      (p.x!==enemy.position.x||p.y!==enemy.position.y);
  });
  assert.ok(dir);
  f.clock(1000);
  const moved=await f.call('a','move',{roomId:id,dx:dir[0],dy:dir[1],
    step:1,battleHealth:999,explorationStamina:999});
  assert.equal(moved.status,200);
  assert.equal(moved.body.room.members.a.explorationStamina,9);
  assert.equal(moved.body.room.members.a.battleHealth,moved.body.room.members.a.battleMaxHealth);
  f.clock(1000);
  const expired=await f.call('b','clock',{roomId:id},1);
  assert.equal(expired.status,200);
  const stored=f.c.records.get(ROOMS+'/'+id);
  assert.equal(stored.members.a.battleHealth,stored.members.a.battleMaxHealth);
  assert.deepStrictEqual(stored.enemies[0].lastAttack.hits,[]);
  assert.deepStrictEqual(stored.members.a.position,moved.body.room.members.a.position);
});
test('downed player cannot move; knockout does not mutate original account or raid ticket',async()=>{
  const {f,id,raw}=await setup();
  const before=structuredClone(f.a.records.get('users/a'));
  raw.members.a.battleHealth=8;
  f.clock(2000);
  await f.call('b','clock',{roomId:id},1);
  f.clock(2000);
  await f.call('b','clock',{roomId:id},1);
  const down=(await f.call('a','get',{roomId:id})).body.room;
  assert.equal(down.members.a.battleHealth,0);
  assert.equal(down.members.a.downed,true);
  const [dx,dy]=directions[0];
  const denied=await f.call('a','move',{roomId:id,dx,dy,step:1});
  assert.equal(denied.status,409);
  assert.match(denied.body.error,/倒地/);
  assert.deepStrictEqual(f.a.records.get('users/a'),before);
});
test('offline catch-up cancels unseen attack and forbids retroactive damage',async()=>{
  const {f,id,raw}=await setup();
  f.clock(2000);
  await f.call('b','clock',{roomId:id},1);
  assert.ok(f.c.records.get(ROOMS+'/'+id).enemies[0].attack);
  f.clock(48000);
  const resumed=await f.call('a','clock',{roomId:id});
  assert.equal(resumed.status,200);
  const after=f.c.records.get(ROOMS+'/'+id);
  assert.equal(after.battleAppliedTick,50);
  assert.equal(after.members.a.battleHealth,after.members.a.battleMaxHealth);
  assert.ok(!after.enemies[0].attack||
    after.enemies[0].attack.startedAtTick===50);
});
test('attack warnings/health are private-room-only, disband clears state and resets reassembly',async()=>{
  const {f,id}=await setup();
  assert.equal((await f.call('c','clock',{roomId:id})).status,403);
  assert.equal((await f.call('c','get',{roomId:id})).status,403);
  f.clock(2000);
  await f.call('a','clock',{roomId:id});
  const closed=await f.call('a','disband',{roomId:id});
  assert.equal(closed.status,200);
  assert.deepStrictEqual(closed.body.room.enemies,[]);
  assert.equal(closed.body.room.battleClock,null);
  assert.equal((await f.call('a','get',{roomId:id})).status,410);
});
