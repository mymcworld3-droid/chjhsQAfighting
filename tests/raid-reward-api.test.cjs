const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const api = require('../raid-reward-api.cjs').__test;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function wonRoom(overrides = {}) {
  return {
    version: 2,
    bossId: 'shen-qingshuang',
    status: 'won',
    bossHp: 0,
    bossMaxHp: 2000,
    bossActionCount: 5,
    startedAtMs: 1000,
    finishedAtMs: 90000,
    members: {
      u1: { uid:'u1', damage:1200, attempts:6, correct:5 },
      u2: { uid:'u2', damage:800, attempts:5, correct:4 }
    },
    ...overrides
  };
}

test('trusted raid reward validates a real member and complete shared-boss damage', () => {
  const result = api.validateRaidVictory(wonRoom(), 'u1');
  assert.equal(result.ok, true);
  assert.equal(result.totalDamage, 2000);
  assert.equal(result.partySize, 2);
  assert.equal(result.bossMaxHp, 2000);
});

test('trusted raid reward rejects unfinished forged-damage and non-member rooms', () => {
  assert.equal(api.validateRaidVictory(wonRoom({status:'active'}), 'u1').ok, false);
  assert.equal(api.validateRaidVictory(wonRoom({members:{
    u1:{uid:'u1',damage:100,attempts:1,correct:1}
  }}), 'u1').ok, false);
  assert.equal(api.validateRaidVictory(wonRoom(), 'outsider').ok, false);
});

function fakeDb(initialUser) {
  const docs = new Map([['users/u1', structuredClone(initialUser)]]);
  let queue=Promise.resolve();
  const snap=target=>({exists:docs.has(target.key),data:()=>structuredClone(docs.get(target.key))});
  return {docs,collection(name){return {doc:id=>({key:name+'/'+id,get:async()=>snap({key:name+'/'+id})})};},
    runTransaction(worker){
      const job=queue.then(async()=>{
        const pending=new Map();let writing=false;
        const tx={get:async target=>{assert.equal(writing,false,'all reads precede writes');return snap(target);},
          create(target,value){writing=true;if(docs.has(target.key)||pending.has(target.key))throw Error('already-exists');pending.set(target.key,structuredClone(value));},
          update(target,value){writing=true;pending.set(target.key,{...structuredClone(docs.get(target.key)),...structuredClone(value)});}};
        const result=await worker(tx);for(const [key,value] of pending)docs.set(key,value);return result;
      });queue=job.catch(()=>{});return job;
    }};
}

test('current raid uses exactly six equal-table wood and iron materials with three rolls', () => {
  assert.equal(api.RAID_MATERIAL_POOL.length,6);
  assert.equal(api.RAID_MATERIAL_ROLLS,3);
  assert.deepEqual([...api.RAID_MATERIAL_POOL],[
    'qi-spirit-iron','foundation-refined-iron','golden-purple-iron',
    'qi-spirit-wood','foundation-century-wood','golden-lightning-wood'
  ]);
  for (let player=0;player<50;player++) {
    const drops=api.rollRaidMaterials('room_equal_probability','u'+player);
    assert.equal(Object.values(drops).reduce((sum,n)=>sum+n,0),3);
    for (const id of Object.keys(drops)) assert.ok(api.RAID_MATERIAL_POOL.includes(id));
  }
  assert.deepEqual(api.rollRaidMaterials('room_x','u1'),api.rollRaidMaterials('room_x','u1'),'replay is deterministic');
});

test('raid reward grants three material rolls plus refinement seals exactly once', async () => {
  const db = fakeDb({ uid:'u1', stats:{totalScore:68}, materialSystem:{ inventory:{} } });
  const validation = api.validateRaidVictory(wonRoom(), 'u1');
  const fieldValue = { serverTimestamp:() => 12345 };
  const first = await api.awardRaidReward(db, 'u1', 'room_12345678', validation, { fieldValue });
  assert.equal(first.status, 'awarded');
  assert.equal(first.rewards['raid-refine-key-ii'],3);
  assert.equal(first.rewards['raid-refine-key-iii'],2);
  assert.equal(api.RAID_MATERIAL_POOL.reduce((sum,id)=>sum+(first.rewards[id]||0),0),3);
  assert.equal(first.firstVictory,true);
  assert.equal(first.dailyFirstVictory,true);

  const before=structuredClone(db.docs.get('users/u1').materialSystem.inventory);
  const second = await api.awardRaidReward(db, 'u1', 'room_12345678', validation, { fieldValue });
  assert.equal(second.status, 'duplicate');
  assert.deepEqual(db.docs.get('users/u1').materialSystem.inventory,before);
});

test('raid reward API is registered and client claims through settlement repository', () => {
  const server = read('server.js');
  const raid = read('public/cultivation/raid-mode.js');
  const repository = read('public/cultivation/data/reward-repository.js');
  assert.match(server, /registerRaidRewardApi\(app\)/);
  assert.match(raid, /rewardRepository\.claimRaid\(roomId\)/);
  assert.match(repository, /\/api\/raid\/reward/);
  assert.match(repository, /authenticatedMainFetch/);
});

test('wood iron materials never leak into ordinary drops and seals remain external furnace requirements', () => {
  const catalog = read('public/cultivation/material-catalog.js');
  const drops = read('public/cultivation/material-drop-system.js');
  const jobs = read('public/cultivation/refinery-ai-jobs.js');
  const ui = read('public/cultivation/cultivation-refinery-v2.js');
  for (const id of api.RAID_MATERIAL_POOL) assert.match(catalog,new RegExp(id));
  assert.match(catalog, /id: 'raid-refine-key-ii'/);
  assert.match(catalog, /id: 'raid-refine-key-iii'/);
  assert.match(drops, /enabled:false/);
  assert.match(drops, /quizDrops:false/);
  assert.match(drops, /dongtianDrops:false/);
  assert.match(jobs, /consumeRefinementKey\(consumed\.materialSystem, plan\.keyRequirement\)/);
  assert.match(ui, /const raidKeyIds = new Set\(Object\.values\(RAID_REFINEMENT_KEYS\)\)/);
  assert.match(ui, /!raidKeyIds\.has\(m\.id\)/);
});

const fieldValue = {serverTimestamp:()=>12345};
test('same-day second room gets base seals and next Taiwan day gets daily seal bonus again',async()=>{
  const db=fakeDb({uid:'u1',stats:{totalScore:68}});
  const validation=api.validateRaidVictory(wonRoom({finishedAtMs:Date.parse('2026-09-30T15:59:00Z')}),'u1');
  const a=await api.awardRaidReward(db,'u1','room_first',validation,{fieldValue});
  const b=await api.awardRaidReward(db,'u1','room_second',validation,{fieldValue});
  const c=await api.awardRaidReward(db,'u1','room_third',{...validation,finishedAtMs:Date.parse('2026-09-30T16:00:00Z')},{fieldValue});
  assert.equal(a.date,'2026-09-30');
  assert.equal(c.date,'2026-10-01');
  assert.equal(b.firstVictory,false);
  assert.equal(b.dailyFirstVictory,false);
  assert.equal(b.rewards['raid-refine-key-ii'],2);
  assert.equal(b.rewards['raid-refine-key-iii'],1);
  assert.equal(api.RAID_MATERIAL_POOL.reduce((sum,id)=>sum+(b.rewards[id]||0),0),3);
  assert.equal(c.dailyFirstVictory,true);
  assert.equal(c.rewards['raid-refine-key-ii'],3);
  assert.equal(c.rewards['raid-refine-key-iii'],2);
});

test('legacy receipt cannot restore consumed inventory',async()=>{
  const db=fakeDb({uid:'u1',stats:{totalScore:68},materialSystem:{inventory:{'raid-refine-key-ii':0}}});
  db.docs.set('raidRewardClaims/'+api.claimId('old_room','u1'),{rewards:api.REWARDS,inventory:{'raid-refine-key-ii':2}});
  const result=await api.awardRaidReward(db,'u1','old_room',api.validateRaidVictory(wonRoom(),'u1'),{fieldValue});
  assert.equal(result.awarded,false);
  assert.equal(db.docs.get('users/u1').materialSystem.inventory['raid-refine-key-ii'],0);
});

test('raid victory never grants material outside the six-item current pool',async()=>{
  const db=fakeDb({uid:'u1',stats:{totalScore:2588}});
  const validation=api.validateRaidVictory(wonRoom(),'u1');
  const result=await api.awardRaidReward(db,'u1','realm_room',validation,{fieldValue});
  const allowed=new Set([...api.RAID_MATERIAL_POOL,'raid-refine-key-ii','raid-refine-key-iii']);
  for(const id of Object.keys(result.rewards)) assert.ok(allowed.has(id),id);
  assert.equal(result.rewards['raid-secret-realm-essence'],undefined);
  assert.equal(result.rewards['raid-shen-sword-soul'],undefined);
});

test('concurrent different rooms grant one first victory one daily bonus and six total material rolls',async()=>{
  const db=fakeDb({uid:'u1',stats:{totalScore:68},materialSystem:{inventory:{}}});
  const validation=api.validateRaidVictory(wonRoom(),'u1');
  const results=await Promise.all(['room_aaaa','room_bbbb','room_aaaa'].map(id=>api.awardRaidReward(db,'u1',id,validation,{fieldValue})));
  assert.equal(results.filter(r=>r.awarded&&r.firstVictory).length,1);
  assert.equal(results.filter(r=>r.awarded&&r.dailyFirstVictory).length,1);
  const inventory=db.docs.get('users/u1').materialSystem.inventory;
  assert.equal(inventory['raid-refine-key-ii'],5);
  assert.equal(inventory['raid-refine-key-iii'],3);
  assert.equal(api.RAID_MATERIAL_POOL.reduce((sum,id)=>sum+(inventory[id]||0),0),6);
});

test('missing player leaves no reward receipt or partial inventory',async()=>{
  const db=fakeDb({});db.docs.delete('users/u1');
  await assert.rejects(api.awardRaidReward(db,'u1','room_missing',api.validateRaidVictory(wonRoom(),'u1'),{fieldValue}),/玩家資料不存在/);
  assert.equal(db.docs.size,0);
});
