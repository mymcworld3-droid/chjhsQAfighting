const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('server-settled lethal hit still animates once without another defense request',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/raid-mode.js'),'utf8');
  const start=source.indexOf('  async function applyRemoteBossAction(action) {');
  const end=source.indexOf('\n  async function maybeAdvanceBoss()',start);
  const action={id:3,name:'寒霜劍雨'};
  const mine={uid:'a',hp:0,lastBossResolution:{bossActionSeen:3,damage:90,playerHp:0,bossHp:1200}};
  let animations=0,requests=0;
  const context={state:{player:{uid:'a',hp:0},roomId:'room12345',lastBossActionSeen:2,
    room:{status:'lost',serverDrivenBoss:true,bossHp:1200,members:{a:mine}},boss:{maxHp:1800}},
    console,toast(){},shenPhaseForHp(){return 1;},
    async commitRaidBossDefense(){requests++;throw new Error('must not resettle');},
    async playBattleScene(input){animations++;assert.equal(input.damage,90);}};
  vm.runInNewContext(source.slice(start,end)+'\nthis.play=applyRemoteBossAction;',context);
  await context.play(action);await context.play(action);
  assert.equal(requests,0);assert.equal(animations,1);
  assert.equal(context.state.lastBossActionSeen,3);
  assert.equal(context.state.pendingFinishRoom.status,'lost');
});
