'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PROJECT_IDS}=require('../firebase-admin-projects.cjs');
const {__test:API}=require('../dungeon-room-api.cjs');
const {generateDungeonLayout}=require('../dungeon-map-generator.cjs');
const Boss=require('../dungeon-boss-battle.cjs');
const Combat=require('../dungeon-enemy-combat.cjs');
const Player=require('../dungeon-player-combat.cjs');
const SEED='0a1b2c3d4e5f60718293a4b5',NOW=1800000000000;
function store(initial={}){
  const records=new Map(Object.entries(initial)),clone=x=>structuredClone(x);
  let chain=Promise.resolve(),serial=0;
  const snap=ref=>({id:ref.id,exists:records.has(ref.key),
    data:()=>clone(records.get(ref.key))});
  const doc=(coll,id)=>{
    const name=id||'dungroom'+String(++serial).padStart(8,'0');
    const ref={key:coll+'/'+name,id:name};ref.get=async()=>snap(ref);return ref;
  };
  return {records,collection:coll=>({doc:id=>doc(coll,id)}),
    runTransaction:fn=>{
      const op=chain.then(async()=>{
        const pending=new Map();let written=false;
        const tx={get:async ref=>{
          assert.equal(written,false,'Firestore read must precede writes');
          return snap(ref);
        },set:(ref,value)=>{written=true;pending.set(ref.key,clone(value));},
        update:(ref,value)=>{written=true;pending.set(ref.key,{
          ...clone(pending.get(ref.key)||records.get(ref.key)),...clone(value)});}};
        const result=await fn(tx);
        for(const [key,v]of pending)records.set(key,v);return result;
      });
      chain=op.catch(()=>{});return op;
    }};
}
async function create(){
  const users=Object.fromEntries(['a','b'].map(uid=>['users/'+uid,
    {uid,displayName:'修士'+uid,stats:{totalScore:60},raidTickets:{count:2}}]));
  const a=store(users),c=store();let now=NOW;
  const make=()=>API.createHandler({
    resolveA:()=>({db:a,auth:{verifyIdToken:async token=>{
      if(token==='unauth')throw Error('bad token');
      return {uid:token,aud:PROJECT_IDS.A,
        iss:'https://securetoken.google.com/'+PROJECT_IDS.A};
    }}}),
    resolveC:()=>({db:c}),clock:()=>now,seedFactory:()=>SEED,
    logger:{error(){}}
  });
  const servers=[make(),make()];
  async function call(uid,action,body={},instance=0){
    let status=200,response=null;
    await servers[instance]({body:{action,...body},
      get:key=>key==='authorization'?'Bearer '+uid:''},{
      set(){return this;},
      status(v){status=v;return this;},json(v){response=v;return this;}
    });
    return {status,body:response};
  }
  const created=await call('a','create');
  const id=created.body.roomId;
  await call('b','join-code',{roomCode:created.body.room.code},1);
  await call('a','ready',{roomId:id,ready:true});
  await call('b','ready',{roomId:id,ready:true},1);
  assert.equal((await call('a','start',{roomId:id})).status,200);
  const map=generateDungeonLayout(SEED,2);
  const raw=()=>c.records.get('dungeonRooms/'+id);
  return {a,c,id,map,call,raw,advance:ms=>{now+=ms;}};
}
const unlock=f=>{
  const room=f.raw();
  room.dungeonProgress={...room.dungeonProgress,
    guardianStatus:'defeated',keyAcquired:true,portalStatus:'open'};
  return room;
};
test('two C servers permit only a legitimate teammate to enter one shared boss room',async()=>{
  const f=await create(),stored=unlock(f);
  const aBefore=structuredClone(f.a.records.get('users/a'));
  assert.equal((await f.call('a','enter-boss',{roomId:f.id})).status,409);
  assert.equal((await f.call('unauth','enter-boss',{roomId:f.id})).status,401);
  const original=stored.revision;
  stored.members.a.position={...f.map.portalSite};
  stored.members.b.position={...f.map.portalSite};
  stored.members.a.explorationStamina=7;
  stored.members.a.battleHealth=72;
  stored.members.a.focusCharges=5;
  const [first,second]=await Promise.all([
    f.call('a','enter-boss',{roomId:f.id,bossHealth:1,
      battleAppliedTick:99999,position:{x:0,y:0}},0),
    f.call('b','enter-boss',{roomId:f.id},1)
  ]);
  assert.equal(first.status,200,first.body?.error);
  assert.equal(second.status,200,second.body?.error);
  assert.equal(f.raw().revision,original+2,'each teammate must vote once');
  assert.equal(f.raw().dungeonArena,'boss');
  assert.equal(f.raw().enemies.length,1);
  assert.equal(f.raw().enemies[0].id,Boss.ID);
  assert.equal(f.raw().enemies[0].battleHealth,Boss.HP);
  assert.equal(f.raw().members.a.battleHealth,72);
  assert.equal(f.raw().members.a.explorationStamina,7);
  assert.equal(f.raw().members.a.focusCharges,5);
  assert.equal(f.raw().battleAppliedTick,0);
  const r1=await f.call('a','get-map',{roomId:f.id},0);
  const r2=await f.call('b','get-map',{roomId:f.id},1);
  assert.deepStrictEqual(r1.body.map,r2.body.map);
  assert.equal(r1.body.map.arena,'boss');
  assert.equal(second.body.room.enemies[0].footprint,2);
  assert.equal(second.body.room.bossEncounter.status,'fighting');
  assert.deepStrictEqual(f.a.records.get('users/a'),aBefore);
  assert.equal((await f.call('a','cancel-start',{roomId:f.id})).status,409);
});
test('real boss collision, dodgeable warning, 2-server shared kill and retry prevention',async()=>{
  const f=await create(),room=unlock(f);
  room.members.a.position={...f.map.portalSite};
  room.members.b.position={...f.map.portalSite};
  assert.equal((await f.call('a','enter-boss',{roomId:f.id})).status,200);
  assert.equal(f.raw().dungeonArena,'exploration','one vote may not teleport other players');
  assert.equal((await f.call('b','enter-boss',{roomId:f.id},1)).status,200);
  assert.equal(f.raw().dungeonArena,'boss');
  const raw=f.raw();raw.members.a.position={x:11,y:9};
  raw.members.b.position={x:12,y:9};
  const startHpA=raw.members.a.battleHealth;
  const startHpB=raw.members.b.battleHealth;
  assert.equal((await f.call('a','move',{roomId:f.id,dx:0,dy:-1,step:1})).status,
    200,'can approach a free cell');
  assert.equal((await f.call('a','move',{roomId:f.id,dx:0,dy:-1,step:2})).status,
    409,'the boss footprint blocks the next step');
  f.advance(2000);
  const clock=await f.call('b','clock',{roomId:f.id},1);
  assert.equal(clock.status,200);
  const warning=f.raw().enemies[0].attack;
  assert.equal(warning.kind,'quake');
  assert.ok(warning.cells.length>0);
  assert.equal(f.raw().members.a.battleHealth,startHpA);
  f.advance(1000);
  await f.call('a','clock',{roomId:f.id});
  assert.equal(f.raw().members.a.battleHealth,startHpA);
  // Player b intentionally stays on a warned tile; player a dodges.
  f.raw().members.a.position={x:7,y:13};
  f.advance(1000);
  await f.call('b','clock',{roomId:f.id},1);
  assert.equal(f.raw().members.a.battleHealth,startHpA);
  assert.equal(f.raw().members.b.battleHealth,startHpB-
    Combat.scaledDamage(warning.damage,raw.members.b));
  const current=f.raw();current.members.a.position={x:11,y:8};
  current.members.b.position={x:12,y:8};
  // Calibrate a 2-hit kill to the real trusted attack value, regardless
  // of which account has a weapon/manuscript equipped in the fixture.
  const probe={...current.enemies[0],battleHealth:Boss.HP};
  const firstDamage=Boss.damage(probe,'a',
    Player.playerStrikeDamage(current.members.a),
    current.battleAppliedTick).damage;
  current.enemies[0].battleHealth=firstDamage+1;
  const [strikeA,strikeB]=await Promise.all([
    f.call('a','strike',{roomId:f.id,enemyId:Boss.ID,seq:1,
      damage:99999,battleHealth:1},0),
    f.call('b','strike',{roomId:f.id,enemyId:Boss.ID,seq:1},1)
  ]);
  assert.equal(strikeA.status,200,strikeA.body?.error);
  assert.equal(strikeB.status,200,strikeB.body?.error);
  assert.equal(f.raw().enemies.length,0);
  assert.equal(f.raw().bossEncounter.status,'defeated');
  assert.ok(['a','b'].includes(f.raw().bossEncounter.defeatedByUid));
  const revision=f.raw().revision;
  assert.equal((await f.call('a','strike',{
    roomId:f.id,enemyId:Boss.ID,seq:1},1)).status,200);
  assert.equal(f.raw().revision,revision);
  assert.equal((await f.call('a','get',{roomId:f.id})).body.room.bossEncounter.status,
    'defeated');
  assert.ok(!f.raw().loot);
  assert.ok(!f.raw().rewards);
});
test('leaving a boss room preserves the surviving party and revokes ex-member access',async()=>{
  const f=await create(),room=unlock(f);
  room.members.a.position={...f.map.portalSite};
  room.members.b.position={...f.map.portalSite};
  assert.equal((await f.call('a','enter-boss',{roomId:f.id})).status,200);
  assert.equal(f.raw().dungeonArena,'exploration','one vote may not teleport other players');
  assert.equal((await f.call('b','enter-boss',{roomId:f.id},1)).status,200);
  const leaving=await f.call('b','leave',{roomId:f.id},1);
  assert.equal(leaving.status,200);
  assert.equal(f.raw().status,'assembled');
  assert.equal(f.raw().dungeonArena,'boss');
  assert.equal(f.raw().bossEncounter.status,'fighting');
  assert.equal(f.raw().dungeonProgress.keyAcquired,true);
  assert.equal(f.raw().enemies[0].id,Boss.ID);
  assert.equal(f.raw().members.b,undefined);
  assert.equal((await f.call('b','get',{roomId:f.id},1)).status,403);
});

test('gravity clock victory is atomically archived once across two C servers',async()=>{
  const O=require('../public/cultivation/weapon-special-objects.js'),V=require('../dungeon-victory-reward.cjs');
  const f=await create(),room=unlock(f);
  room.members.a.position={...f.map.portalSite};room.members.b.position={...f.map.portalSite};
  assert.equal((await f.call('a','enter-boss',{roomId:f.id})).status,200);
  assert.equal((await f.call('b','enter-boss',{roomId:f.id},1)).status,200);
  const raw=f.raw(),map=(await f.call('a','get-map',{roomId:f.id})).body.map,boss=raw.enemies[0];
  raw.members.a.dungeonAttack=100;boss.battleHealth=40;boss.shield=0;boss.nextActionTick=99;
  const board={width:map.width,height:map.height,blocked:q=>!map.tiles[q.y*map.width+q.x]};
  raw.weaponObjects=O.add(undefined,{type:'core',ownerUid:'a',position:{x:boss.position.x-1,y:boss.position.y},board,generatedAt:0});
  raw.weaponObjects=O.triggerCore(raw.weaponObjects,'a',0).state;
  const seq=raw.members.a.skillSeq;
  f.advance(4000);
  const replies=await Promise.all([f.call('a','clock',{roomId:f.id}),f.call('b','clock',{roomId:f.id},1)]);
  assert.ok(replies.every(r=>r.status===200),JSON.stringify(replies));
  const result=f.raw();assert.equal(result.bossEncounter.status,'defeated');
  assert.equal(result.bossEncounter.defeatedByUid,'a');assert.equal(result.enemies.length,0);
  assert.equal(result.gravityEvents.length,1);assert.equal(result.members.a.skillSeq,seq);
  assert.equal(result.weaponObjects.objects.length,0);
  assert.ok(f.c.records.get(V.ARCHIVES+'/'+f.id));
  const revision=result.revision;
  assert.equal((await f.call('b','clock',{roomId:f.id},1)).status,200);
  assert.equal(f.raw().revision,revision);
});
