'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PROJECT_IDS}=require('../firebase-admin-projects.cjs');
const {__test:API}=require('../dungeon-room-api.cjs');
const {generateDungeonLayout,walkable}=require('../dungeon-map-generator.cjs');
const SECRET='0a1b2c3d4e5f60718293a4b5';
function store(initial={}){
  const records=new Map(Object.entries(initial));let serial=0,chain=Promise.resolve();
  const clone=value=>structuredClone(value);
  const snap=ref=>({id:ref.id,exists:records.has(ref.key),
    data:()=>clone(records.get(ref.key))});
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
        const tx={get:async ref=>{
          assert.equal(written,false,'transaction reads must precede writes');
          return snap(ref);
        },set:(ref,value)=>{written=true;changes.set(ref.key,clone(value));},
        update:(ref,value)=>{written=true;changes.set(ref.key,
          {...clone(changes.get(ref.key)||records.get(ref.key)),...clone(value)});}};
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
  const users=Object.fromEntries('ab'.split('').map(uid=>['users/'+uid,
    {uid,displayName:'修士'+uid,stats:{totalScore:50},raidTickets:{count:4}}]));
  const a=store(users),c=store(),now=1800000000000;
  const build=()=>API.createHandler({
    resolveA:()=>({db:a,auth:{verifyIdToken:async token=>{
      if(token==='invalid')throw Error('invalid');
      return {uid:token,aud:PROJECT_IDS.A,iss:'https://securetoken.google.com/'+PROJECT_IDS.A};
    }}}),
    resolveC:()=>({db:c}),seedFactory:()=>SECRET,
    clock:()=>now,logger:{error(){}}
  });
  const handlers=[build(),build()];
  async function call(uid,action,body={},instance=0){
    let status=200,result;
    await handlers[instance]({body:{action,...body},
      get:key=>key==='authorization'?'Bearer '+uid:''},{
      set(){return this;},status(value){status=value;return this;},
      json(value){result=value;return this;}
    });
    return {status,body:result};
  }
  return {a,c,call};
}
async function setup(){
  const f=fixture(),created=(await f.call('a','create')).body;
  const id=created.roomId;
  await f.call('b','join-code',{roomCode:created.room.code},1);
  for(const uid of 'ab')await f.call(uid,'ready',{roomId:id,ready:true});
  assert.equal((await f.call('a','start',{roomId:id})).status,200);
  const raw=f.c.records.get('dungeonRooms/'+id);
  const wolf=raw.enemies.find(e=>e.kind==='wolf');
  const map=generateDungeonLayout(SECRET);
  const spot=[[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dy])=>
    ({x:wolf.position.x+dx,y:wolf.position.y+dy})).find(p=>walkable(map,p));
  assert.ok(spot);
  raw.enemies=[wolf];raw.members.a.position=spot;raw.members.b.position=spot;
  return {f,id,raw,wolf};
}
test('two distinct servers commit concurrent strikes once and share one enemy health',async()=>{
  const {f,id,raw,wolf}=await setup();
  const account=structuredClone(f.a.records.get('users/a'));
  const [a,b]=await Promise.all([
    f.call('a','strike',{roomId:id,enemyId:wolf.id,seq:1,
      damage:100000,explorationStamina:100000},0),
    f.call('b','strike',{roomId:id,enemyId:wolf.id,seq:1},1)
  ]);
  assert.equal(a.status,200);assert.equal(b.status,200);
  const stored=f.c.records.get('dungeonRooms/'+id);
  assert.equal(stored.enemies.length,0);
  assert.equal(stored.members.a.strikeSeq,1);
  assert.equal(stored.members.b.strikeSeq,1);
  assert.equal(stored.members.a.explorationStamina,98);
  assert.equal(stored.members.b.explorationStamina,98);
  const before=stored.revision;
  const same=await f.call('a','strike',{roomId:id,enemyId:wolf.id,seq:1},1);
  assert.equal(same.status,200);
  assert.equal(f.c.records.get('dungeonRooms/'+id).revision,before);
  assert.deepStrictEqual(f.a.records.get('users/a'),account);
});
test('forged and stale attacks are rejected, no player stamina or room revision spent',async()=>{
  const {f,id,raw,wolf}=await setup();
  const original=raw.revision;
  assert.equal((await f.call('a','strike',{roomId:id,enemyId:wolf.id,seq:0})).status,400);
  assert.equal((await f.call('a','strike',{roomId:id,enemyId:wolf.id,seq:2})).status,409);
  assert.equal((await f.call('invalid','strike',{roomId:id,enemyId:wolf.id,seq:1})).status,401);
  raw.members.a.downed=true;
  assert.equal((await f.call('a','strike',{roomId:id,enemyId:wolf.id,seq:1})).status,409);
  raw.members.a.downed=false;raw.members.a.explorationStamina=0;
  assert.equal((await f.call('a','strike',{roomId:id,enemyId:wolf.id,seq:1})).status,409);
  assert.equal(raw.revision,original);
});


const skillRecord=()=>({
  school:'sword',books:{'sword-wind':{exp:2500}},
  equipped:['wind-slash','wind-step','wind-thousand'],
  loadouts:[
    {name:'直線',skillIds:['wind-slash','wind-step','wind-thousand']},
    {name:'突進',skillIds:['wind-step']},
    {name:'留空',skillIds:[]}
  ],activeLoadout:0
});
test('authoritative C-side manual equipment enables skills and replaces basic attack',async()=>{
  const {f,id,raw,wolf}=await setup();
  f.a.records.set('tacticalManuals/a',skillRecord());
  const applied=await f.call('a','loadout',{roomId:id,index:0});
  assert.equal(applied.status,200);
  assert.ok(applied.body.room.members.a.dungeonSkillIds.includes('wind-slash'));
  assert.equal(applied.body.room.members.a.dungeonLoadoutIndex,0);
  const basic=await f.call('a','strike',{roomId:id,enemyId:wolf.id,seq:1});
  assert.equal(basic.status,409);
  const cast=await f.call('a','skill',{roomId:id,skillId:'wind-slash',
    target:{...wolf.position},seq:1,power:9999,damage:9999});
  assert.equal(cast.status,200);
  const result=cast.body.room.members.a.lastSkill;
  assert.equal(result.skillId,'wind-slash');
  assert.ok(result.totalDamage>0&&result.totalDamage<=60);
  assert.equal(cast.body.room.members.a.explorationStamina,98);
  const before=f.c.records.get('dungeonRooms/'+id).revision;
  const retry=await f.call('a','skill',{roomId:id,skillId:'wind-slash',
    target:{...wolf.position},seq:1});
  assert.equal(retry.status,200);
  assert.equal(f.c.records.get('dungeonRooms/'+id).revision,before);
  assert.equal((await f.call('a','skill',{roomId:id,skillId:'sky-sever',
    target:wolf.position,seq:2})).status,403);
});
test('two servers resolve simultaneous equipped skills against one shared enemy',async()=>{
  const {f,id,raw,wolf}=await setup();
  for(const uid of 'ab'){
    f.a.records.set('tacticalManuals/'+uid,skillRecord());
    assert.equal((await f.call(uid,'loadout',{roomId:id,index:0})).status,200);
  }
  const replies=await Promise.all(['a','b'].map((uid,i)=>
    f.call(uid,'skill',{roomId:id,skillId:'wind-slash',
      target:{...wolf.position},seq:1},i)));
  assert.ok(replies.every(r=>r.status===200));
  const stored=f.c.records.get('dungeonRooms/'+id);
  assert.equal(stored.enemies.length,0);
  assert.equal(stored.members.a.skillSeq,1);
  assert.equal(stored.members.b.skillSeq,1);
  assert.equal(stored.members.a.explorationStamina,98);
  assert.equal(stored.members.b.explorationStamina,98);
  assert.ok(stored.members.a.lastSkill.totalDamage+
    stored.members.b.lastSkill.totalDamage===60);
  const before=stored.revision;
  const stale=await f.call('b','skill',{roomId:id,skillId:'wind-slash',
    target:wolf.position,seq:1},0);
  assert.equal(stale.status,200);
  assert.equal(f.c.records.get('dungeonRooms/'+id).revision,before);
});
test('three stored presets switch in battle, deny forged or unowned skills',async()=>{
  const {f,id,raw,wolf}=await setup();
  f.a.records.set('tacticalManuals/a',skillRecord());
  const second=await f.call('a','loadout',{roomId:id,index:1});
  assert.equal(second.status,200);
  assert.deepStrictEqual(second.body.room.members.a.dungeonSkillIds,['wind-step']);
  const fail=await f.call('a','skill',{roomId:id,skillId:'wind-slash',
    target:wolf.position,seq:1});
  assert.equal(fail.status,403);
  assert.equal((await f.call('a','loadout',{roomId:id,index:3})).status,400);
  const back=await f.call('a','loadout',{roomId:id,index:0});
  assert.equal(back.status,200);
  assert.ok(back.body.room.members.a.dungeonSkillIds.includes('wind-slash'));
  assert.equal((await f.call('b','skill',{roomId:id,skillId:'wind-slash',
    target:wolf.position,seq:1})).status,403);
});

test('assembly trusts only Firebase A manuscript documents, never empty C aliases',async()=>{
  const f=fixture(),created=(await f.call('a','create')).body,id=created.roomId;
  f.a.records.set('tacticalManuals/a',skillRecord());
  f.c.records.set('tacticalManuals/a',{equipped:['sky-sever'],
    books:{'sword-sky':{exp:99999}}});
  await f.call('a','ready',{roomId:id,ready:true});
  const started=await f.call('a','start',{roomId:id});
  assert.equal(started.status,200);
  assert.deepStrictEqual(started.body.room.members.a.dungeonSkillIds,
    ['wind-slash','wind-step','wind-thousand']);
  assert.equal(started.body.room.members.a.dungeonLoadoutIndex,0);
});


test('two C server instances cannot double-credit one A-graded answer',async()=>{
  const {f,id,raw}=await setup();
  raw.members.a.explorationStamina=93;
  const qid='dungeon-question-a-1';
  f.a.records.set('dungeonQuizStates/a',{
    roomId:id,sessionKey:id+':'+raw.assembledAtMs,
    reviews:{[qid]:{uid:'a',questionId:qid,index:1,correct:true,amount:4}}
  });
  const [first,retry]=await Promise.all([
    f.call('a','quiz-credit',{roomId:id,questionId:qid,correct:false,
      amount:100,explorationStamina:9999},0),
    f.call('a','quiz-credit',{roomId:id,questionId:qid},1)
  ]);
  assert.equal(first.status,200);assert.equal(retry.status,200);
  const snapshot=f.c.records.get('dungeonRooms/'+id);
  assert.equal(snapshot.members.a.quizCreditSeq,1);
  assert.equal(snapshot.members.a.explorationStamina,97);
  assert.equal(snapshot.members.b.quizCreditSeq,0);
  assert.equal(snapshot.members.b.explorationStamina,100);
  assert.equal(snapshot.members.a.lastQuizCredit.granted,4);
  const revision=snapshot.revision;
  assert.equal((await f.call('a','quiz-credit',{roomId:id,questionId:qid})).status,200);
  assert.equal(f.c.records.get('dungeonRooms/'+id).revision,revision);
});
test('quiz credit is member- and session-bound; rejects ungraded, out-of-order and forged',async()=>{
  const {f,id,raw}=await setup();
  const sessionKey=id+':'+raw.assembledAtMs;
  f.a.records.set('dungeonQuizStates/a',{
    roomId:id,sessionKey,
    reviews:{
      one:{uid:'a',questionId:'one',index:1,correct:false,amount:1},
      two:{uid:'a',questionId:'two',index:2,correct:true,amount:4}
    }
  });
  const rev=raw.revision;
  assert.equal((await f.call('a','quiz-credit',{roomId:id,questionId:'two'})).status,409);
  assert.equal((await f.call('a','quiz-credit',{roomId:id,questionId:'invented'})).status,403);
  assert.equal((await f.call('b','quiz-credit',{roomId:id,questionId:'one'})).status,403);
  assert.equal((await f.call('invalid','quiz-credit',{roomId:id,questionId:'one'})).status,401);
  assert.equal(f.c.records.get('dungeonRooms/'+id).revision,rev);
  const credited=await f.call('a','quiz-credit',{roomId:id,questionId:'one'});
  assert.equal(credited.status,200);assert.equal(credited.body.room.members.a.explorationStamina,100);
  assert.equal(credited.body.room.members.a.lastQuizCredit.granted,0,
    'at cap still acknowledge the receipt once');
  f.c.records.get('dungeonRooms/'+id).members.a.explorationStamina=90;
  const second=await f.call('a','quiz-credit',{roomId:id,questionId:'two'});
  assert.equal(second.status,200);assert.equal(second.body.room.members.a.explorationStamina,94);
  const oldA=f.a.records.get('dungeonQuizStates/a');
  f.a.records.set('dungeonQuizStates/a',{...oldA,sessionKey:'old-room:123'});
  assert.equal((await f.call('a','quiz-credit',{roomId:id,questionId:'two'})).status,403);
});
