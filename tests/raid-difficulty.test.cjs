const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const authority = require('../raid-authority.cjs');
const { advanceRaidClock } = require('../raid-clock.cjs');

const TYPES = ['ocean','taichu','ningxin','pojing','xingchen','wugou','thunder','reverse','sword'];
const SOLO_NODES = {leftMain:10,rightMain:10,rightTop:5,rightFarTop:10};

test('Boss difficulty ignores party size, player stats, deaths and departing teammates', () => {
  const expected = authority.createRaidBoss();
  for (const count of [0,1,2,3,4]) {
    const members = Array.from({length:count}, (_,i)=>({uid:'p'+i,atk:1e6,maxHp:1e6,alive:i%2===0}));
    assert.deepEqual(authority.createRaidBoss(members),expected);
    assert.deepEqual(authority.createRaidBoss(members.slice(1)),expected);
  }
  assert.equal(expected.maxHp,4800);
  assert.equal(expected.baseAttack,70);
});

function trial({type,count,nodes={},seed}) {
  const roomId='sim'+seed, boss=authority.createRaidBoss();
  let room={version:2,status:'active',hostUid:'p0',startedAtMs:1,createdAtMs:1,
    bossHp:boss.hp,bossMaxHp:boss.maxHp,bossBaseAttack:boss.baseAttack,bossActionCount:0,members:{}};
  for(let i=0;i<count;i++) {
    const uid='p'+i;
    const player=authority.trustedRaidPlayerSnapshot({
      stats:{attack:200,maxHp:1000,totalScore:Object.keys(nodes).length?68:28},
      cultivationTraining:{equippedCore:{type,grade:9}},
      nascentSoulTree:{version:4,paths:{[type]:{nodes}}}
    },uid,{});
    room.members[uid]={...authority.memberSnapshotFromTrusted(player,i===0),joinedAtMs:1,heartbeatAtMs:1};
  }
  let nextAnswer=20000,nextBoss=18000;
  for(let time=Math.min(nextAnswer,nextBoss);time<=900000;time=Math.min(nextAnswer,nextBoss)) {
    for(const member of Object.values(room.members))member.heartbeatAtMs=time+1;
    // Real server clock resolves due Boss hits before accepting answers.
    room=advanceRaidClock(room,roomId,time+1)||room;
    if(room.status!=='active')return {won:room.status==='won',seconds:time/1000};
    if(time===nextBoss)nextBoss+=18000;
    if(time!==nextAnswer)continue;
    nextAnswer+=20000;
    for(let i=0;i<count;i++) {
      const uid='p'+i, member=room.members[uid];
      if(!member.alive||member.hp<=0)continue;
      const actionId=member.lastActionId+1;
      const random=crypto.createHash('sha256').update('accuracy:'+seed+':'+i+':'+actionId)
        .digest().readUInt32LE(0)/4294967296;
      const correct=random<.8;
      const result=authority.resolvePlayerAction(member,{roomId,actionId,correct,
        bossHp:room.bossHp,bossMaxHp:room.bossMaxHp});
      room.members[uid]={...result.member,lastActionId:actionId,
        damage:member.damage+result.damage,attempts:member.attempts+1,correct:member.correct+(correct?1:0)};
      room.bossHp=Math.max(0,room.bossHp-result.damage);
      if(!room.bossHp)return {won:true,seconds:time/1000};
    }
  }
  return {won:false,seconds:900};
}

for(const profile of [
  {name:'three basic Golden Core players normally clear',count:3,nodes:{},minimum:.8},
  {name:'an uninvested solo player usually cannot clear',count:1,nodes:{},maximum:.15},
  {name:'a solo nascent player with three full nodes and their prerequisite can clear',count:1,nodes:SOLO_NODES,minimum:.9}
])test(profile.name+' at 80% accuracy and 20 seconds per answer', t=>{
  for(const type of TYPES) {
    const outcomes=Array.from({length:200},(_,seed)=>trial({...profile,type,seed}));
    const wins=outcomes.filter(result=>result.won),rate=wins.length/outcomes.length;
    t.diagnostic(type+': '+wins.length+'/200 cleared');
    if(profile.minimum!==undefined)assert.ok(rate>=profile.minimum,type+': '+rate);
    if(profile.maximum!==undefined)assert.ok(rate<=profile.maximum,type+': '+rate);
  }
});
