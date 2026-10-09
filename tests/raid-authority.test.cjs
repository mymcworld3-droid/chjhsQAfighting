const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const read = rel => readFileSync(join(root, rel), 'utf8');
const authority = require('../raid-authority.cjs');
const tickets = require('../raid-question-ticket.cjs');

test('trusted raid snapshot derives combat stats from the A user document and equipped catalog', () => {
  const user = {
    displayName:'Server Player',
    stats:{attack:200,maxHp:1000,totalScore:68,rankLevel:3},
    cultivationTraining:{coreEnabled:true,equippedCore:{type:'sword',grade:5}},
    nascentSoulTree:{version:4,paths:{sword:{nodes:{leftMain:2,rightMain:3,leftTop:1},baselineNodes:{},legacySpent:0}}},
    artifactSystem:{
      inventory:{armor:1},
      equipped:{'護身法寶':'armor'},
      buffs:{}
    }
  };
  const catalog={items:[{id:'armor',name:'Server Armor',realm:'金丹',equipSlot:'護身法寶',
    effects:[{type:'equip_attack_flat',value:50},{type:'equip_hp_flat',value:200},{type:'equip_shield_flat',value:90}]}]};
  const snap=authority.trustedRaidPlayerSnapshot(user,'u1',catalog);
  assert.equal(snap.uid,'u1');
  assert.equal(snap.atk,250); // 200 + 50 equipment + 24 nascent soul
  assert.equal(snap.maxHp,1200); // 1000 + 200 equipment + 210 nascent soul
  assert.equal(snap.artifactShield,90);
  assert.equal(snap.goldenCore.type,'sword');
  assert.equal(snap.nascentSoul.bonusDamage,0);
  assert.ok(snap.combatPower>0);
});

test('server player action derives damage and correctness input has no client damage override', () => {
  const member={
    uid:'u1',atk:300,hp:1200,maxHp:1200,totalScore:10,
    goldenCore:null,nascentSoul:null,coreShield:false,coreCorrectStreak:0,
    artifactBattle:{version:1,effects:[],openingShield:0},artifactShield:0,
    artifactFirstHitUsed:false,artifactCheatDeathUsed:false
  };
  const miss=authority.resolvePlayerAction(member,{roomId:'room12345',actionId:1,correct:false});
  assert.equal(miss.damage,0);
  assert.equal(miss.member.hp,1200);
  const hit=authority.resolvePlayerAction(member,{roomId:'room12345',actionId:1,correct:true});
  assert.equal(hit.damage,300);
  assert.equal(hit.member.hp,1200);
});

test('server boss defense derives HP loss and reflection from trusted effects', () => {
  const member={
    uid:'u1',atk:200,hp:1000,maxHp:1000,totalScore:10,goldenCore:null,nascentSoul:null,
    coreShield:false,artifactBattle:{version:1,effects:[
      {type:'equip_damage_reduction_flat',value:50},
      {type:'equip_reflect_percent',value:.5}
    ]},artifactShield:0,artifactFirstHitUsed:false,artifactCheatDeathUsed:false
  };
  const result=authority.resolveBossDefense(member,{roomId:'room12345',bossAction:{id:1,damage:250}});
  assert.equal(result.damage,200);
  assert.equal(result.member.hp,800);
  assert.equal(result.reflectedDamage,100);
});

test('encrypted raid question ticket hides the answer and rejects tampering', () => {
  const env={FIREBASE_A_SERVICE_ACCOUNT_JSON:JSON.stringify({
    type:'service_account',project_id:'question-learning',
    private_key:'-----BEGIN PRIVATE KEY-----\nfake-test-key\n-----END PRIVATE KEY-----',
    client_email:'raid-test@question-learning.iam.gserviceaccount.com'
  })};
  const token=tickets.issueRaidQuestionTicket({
    uid:'u1',roomId:'room12345',actionId:2,questionId:'raidq-1',
    answerIndex:3,explanation:'SECRET EXPLANATION'
  },{env,now:1000});
  assert.equal(token.includes('SECRET EXPLANATION'),false);
  const payload=tickets.readRaidQuestionTicket(token,{env,now:2000});
  assert.equal(payload.answerIndex,3);
  assert.equal(payload.explanation,'SECRET EXPLANATION');
  assert.equal(tickets.assertRaidQuestionTicket(payload,{
    uid:'u1',roomId:'room12345',actionId:2,questionId:'raidq-1'
  }).answerIndex,3);
  assert.throws(()=>tickets.readRaidQuestionTicket(token.slice(0,-2)+'aa',{env,now:2000}),/票證/);
});

test('raid protocol ignores client combat claims and uses trusted A/C server resolution', () => {
  const api=read('raid-room-api.cjs');
  const room=read('public/cultivation/raid-room.js');
  const mode=read('public/cultivation/raid-mode.js');
  const question=read('public/cultivation/raid-question.js');
  const server=read('server.js');

  assert.match(api,/loadTrustedRaidPlayer\(playerDb, uid\)/);
  assert.match(api,/createRaidBoss\(\)/);
  assert.match(api,/resolvePlayerAction\(\{ \.\.\.me \}, \{ roomId, actionId: id, correct, bossHp:current\.bossHp, bossMaxHp:current\.bossMaxHp \}\)/);
  assert.match(read('raid-clock.cjs'),/resolveBossDefense\(member, \{ roomId, bossAction: action \}\)/);
  assert.match(api,/readRaidQuestionTicket\(req\.body\.ticket\)/);
  assert.match(read('raid-clock.cjs'),/const intent = bossIntent\(next\)/);
  assert.doesNotMatch(api,/finite\(req\.body\?\.damage/);
  assert.doesNotMatch(api,/finite\(req\.body\?\.hp/);
  assert.doesNotMatch(api,/req\.body\?\.correct === true/);
  assert.doesNotMatch(api,/const boss = req\.body\?\.boss/);
  assert.doesNotMatch(api,/const intent = req\.body\?\.intent/);
  assert.doesNotMatch(api,/req\.body\?\.reflectedDamage/);

  assert.match(room,/api\('create'\)/);
  assert.match(room,/api\('quick'\)/);
  assert.match(room,/api\('join-code', \{ roomCode \}\)/);
  assert.match(room,/player-action', \{ roomId, actionId, questionId, choice, ticket \}/);
  assert.match(room,/boss-defense', \{ roomId, bossActionSeen \}/);
  assert.doesNotMatch(room,/commitRaidPlayerAction\(\{ roomId, actionId, damage, hp, correct \}\)/);
  assert.doesNotMatch(room,/commitRaidBossDefense\(\{ roomId, hp, bossActionSeen, reflectedDamage/);

  assert.doesNotMatch(mode,/resolveShenPlayerAction|resolveShenBossAction/);
  assert.match(mode,/state\.answerCorrect = resolution\.correct === true/);
  assert.match(question,/authenticatedMainFetch\('\/api\/generate-quiz'/);
  assert.match(question,/ans: null, exp: ''/);
  assert.match(server,/issueRaidQuestionTicket/);
  assert.match(server,/raidActionId > expected \+ 1/);
  assert.match(server,/subject = trusted\.subject/);
  assert.match(server,/level = trusted\.level/);
  assert.match(server,/knowledgeMap = null/);
});
