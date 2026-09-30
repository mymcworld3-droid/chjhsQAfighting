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

test('trusted raid reward rejects unfinished, forged-damage and non-member rooms', () => {
  assert.equal(api.validateRaidVictory(wonRoom({status:'active'}), 'u1').ok, false);
  assert.equal(api.validateRaidVictory(wonRoom({members:{
    u1:{uid:'u1',damage:100,attempts:1,correct:1}
  }}), 'u1').ok, false);
  assert.equal(api.validateRaidVictory(wonRoom(), 'outsider').ok, false);
  assert.equal(api.validateRaidVictory(wonRoom({bossActionCount:13}), 'u1').ok, true);
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

test('raid reward writes refinement seals and boss-exclusive materials exactly once into A material inventory', async () => {
  const db = fakeDb({ uid:'u1', stats:{totalScore:68}, materialSystem:{ inventory:{} } });
  const validation = api.validateRaidVictory(wonRoom(), 'u1');
  const fieldValue = { serverTimestamp:() => 12345 };
  const first = await api.awardRaidReward(db, 'u1', 'room_12345678', validation, { fieldValue });
  assert.equal(first.status, 'awarded');
  assert.deepEqual(first.rewards, {'raid-refine-key-ii':3,'raid-refine-key-iii':2,'raid-secret-realm-essence':3,'raid-shen-sword-soul':2});
  assert.equal(first.firstVictory,true);
  assert.equal(first.dailyFirstVictory,true);
  const inventory = db.docs.get('users/u1').materialSystem.inventory;
  assert.equal(inventory['raid-refine-key-ii'], 3);
  assert.equal(inventory['raid-refine-key-iii'], 2);
  assert.equal(inventory['raid-secret-realm-essence'], 3);
  assert.equal(inventory['raid-shen-sword-soul'], 2);

  const second = await api.awardRaidReward(db, 'u1', 'room_12345678', validation, { fieldValue });
  assert.equal(second.status, 'duplicate');
  assert.equal(db.docs.get('users/u1').materialSystem.inventory['raid-refine-key-ii'], 3);
  assert.equal(db.docs.get('users/u1').materialSystem.inventory['raid-refine-key-iii'], 2);
  assert.equal(db.docs.get('users/u1').materialSystem.inventory['raid-secret-realm-essence'], 3);
  assert.equal(db.docs.get('users/u1').materialSystem.inventory['raid-shen-sword-soul'], 2);
});

test('raid reward API is registered and client claims through the settlement repository', () => {
  const server = read('server.js');
  const raid = read('public/cultivation/raid-mode.js');
  const repository = read('public/cultivation/data/reward-repository.js');
  assert.match(server, /registerRaidRewardApi\(app\)/);
  assert.match(raid, /rewardRepository\.claimRaid\(roomId\)/);
  assert.doesNotMatch(raid, /fetch\('\/api\/raid\/reward'/);
  assert.match(repository, /\/api\/raid\/reward/);
  assert.match(repository, /authenticatedMainFetch/);
  assert.match(repository, /body:JSON\.stringify\(body\|\|\{\}\)/);
  assert.match(repository, /claimRaid\(roomId\).*\{roomId\}/);
  assert.doesNotMatch(raid, /JSON\.stringify\(\{[^}]*raid-refine-key/);
});

test('raid-exclusive materials never leak into ordinary drops; refinement seals remain external furnace requirements', () => {
  const catalog = read('public/cultivation/material-catalog.js');
  const drops = read('public/cultivation/material-drop-system.js');
  const jobs = read('public/cultivation/refinery-ai-jobs.js');
  const ui = read('public/cultivation/cultivation-refinery-v2.js');
  assert.match(catalog, /id: 'raid-refine-key-ii'/);
  assert.match(catalog, /id: 'raid-refine-key-iii'/);
  assert.match(catalog, /id: 'raid-secret-realm-essence'/);
  assert.match(catalog, /id: 'raid-shen-sword-soul'/);
  assert.match(catalog, /RAID_EXCLUSIVE_MATERIAL_IDS/);
  assert.match(catalog, /function raidRefinementKeyRequirement\(stage, realm\)/);
  assert.match(catalog, /Math\.ceil\(order \/ 2\)/);
  assert.match(catalog, /Math\.ceil\(order \* 2 \/ 3\)/);
  assert.match(drops, /enabled:false/);
  assert.match(drops, /quizDrops:false/);
  assert.match(drops, /dongtianDrops:false/);
  assert.match(jobs, /consumeRefinementKey\(consumed\.materialSystem, plan\.keyRequirement\)/);
  assert.match(jobs, /refinementStage: plan\.refinementStage/);
  assert.match(ui, /RAID_REFINEMENT_KEYS/);
  assert.match(ui, /const raidKeyIds = new Set\(Object\.values\(RAID_REFINEMENT_KEYS\)\)/);
  assert.match(ui, /!raidKeyIds\.has\(m\.id\)/);
  assert.match(ui, /refinery-key-requirement/);
  assert.match(ui, /第二煉印記/);
  assert.match(ui, /第三煉印記/);
  assert.match(ui, /持有 \$\{view\.have\} \/ 需要 \$\{view\.need\}/);
  assert.match(ui, /keyStatus\.enough/);
  assert.match(ui, /請先挑戰團本取得/);
});


const fieldValue = {serverTimestamp:()=>12345};
test('same-day second room receives base keys; next Taiwan day receives another daily bonus',async()=>{
  const db=fakeDb({uid:'u1',stats:{totalScore:68}});
  const validation=api.validateRaidVictory(wonRoom({finishedAtMs:Date.parse('2026-09-30T15:59:00Z')}),'u1');
  const a=await api.awardRaidReward(db,'u1','room_first',validation,{fieldValue});
  const b=await api.awardRaidReward(db,'u1','room_second',validation,{fieldValue});
  const c=await api.awardRaidReward(db,'u1','room_third',{...validation,finishedAtMs:Date.parse('2026-09-30T16:00:00Z')},{fieldValue});
  assert.equal(a.date,'2026-09-30');assert.equal(c.date,'2026-10-01');
  assert.equal(b.firstVictory,false);assert.equal(b.dailyFirstVictory,false);
  assert.equal(b.rewards['raid-refine-key-ii'],2);
  assert.equal(b.rewards['raid-secret-realm-essence'],2);
  assert.equal(b.rewards['raid-shen-sword-soul'],1);
  assert.equal(c.dailyFirstVictory,true);assert.equal(c.firstVictory,false);
  assert.equal(db.docs.get('users/u1').raidProgress['shen-qingshuang'].firstVictoryRoomId,'room_first');
  // Claiming an old room on a later date cannot reset its original daily key.
  const d=await api.awardRaidReward(db,'u1','room_fourth',validation,{fieldValue});
  assert.equal(d.dailyFirstVictory,false);
});
test('legacy receipt stays unchanged and cannot restore consumed inventory',async()=>{
  const db=fakeDb({uid:'u1',stats:{totalScore:68},materialSystem:{inventory:{'raid-refine-key-ii':0}}});
  db.docs.set('raidRewardClaims/'+api.claimId('old_room','u1'),{rewards:api.REWARDS,inventory:{'raid-refine-key-ii':2}});
  const result=await api.awardRaidReward(db,'u1','old_room',api.validateRaidVictory(wonRoom(),'u1'),{fieldValue});
  assert.equal(result.awarded,false);assert.equal(result.firstVictory,false);
  assert.equal(db.docs.get('users/u1').materialSystem.inventory['raid-refine-key-ii'],0);
});
test('raid victory never grants retired ordinary realm materials',async()=>{
  const db=fakeDb({uid:'u1',stats:{totalScore:2588}});
  const room=wonRoom();room.members.u1.totalScore=68;
  const validation=api.validateRaidVictory(room,'u1');
  const result=await api.awardRaidReward(db,'u1','realm_room',validation,{fieldValue});
  assert.equal(result.rewards['raid-secret-realm-essence'],3);
  assert.equal(result.rewards['raid-shen-sword-soul'],2);
  assert.equal(result.rewards['taixu-mystic-iron'],undefined);
  assert.equal(result.rewards['nascent-soul-crystal'],undefined);
});

test('concurrent different rooms grant exactly one first victory and daily bonus',async()=>{
  const db=fakeDb({uid:'u1',stats:{totalScore:68},materialSystem:{inventory:{}}});
  const validation=api.validateRaidVictory(wonRoom(),'u1');
  const results=await Promise.all(['room_aaaa','room_bbbb','room_aaaa'].map(id=>api.awardRaidReward(db,'u1',id,validation,{fieldValue})));
  assert.equal(results.filter(r=>r.awarded&&r.firstVictory).length,1);
  assert.equal(results.filter(r=>r.awarded&&r.dailyFirstVictory).length,1);
  assert.equal(db.docs.get('users/u1').materialSystem.inventory['raid-refine-key-ii'],5);
  assert.equal(db.docs.get('users/u1').materialSystem.inventory['raid-refine-key-iii'],3);
  assert.equal(db.docs.get('users/u1').materialSystem.inventory['raid-secret-realm-essence'],5);
  assert.equal(db.docs.get('users/u1').materialSystem.inventory['raid-shen-sword-soul'],3);
});
test('missing player leaves no daily claim, reward receipt or partial inventory',async()=>{
  const db=fakeDb({});db.docs.delete('users/u1');
  await assert.rejects(api.awardRaidReward(db,'u1','room_missing',api.validateRaidVictory(wonRoom(),'u1'),{fieldValue}),/玩家資料不存在/);
  assert.equal(db.docs.size,0);
});
