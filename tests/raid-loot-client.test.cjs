const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/raid-mode.js'),'utf8');
const claim=source.slice(source.indexOf('  async function claimRaidReward()'),source.indexOf('  function finishRaid('));
function fixture({fresh,claimError,getError,switchAccount=false}={}) {
  const local={uid:'a',materialSystem:{inventory:{'raid-refine-key-ii':0}}};
  let current=local,claims=0,reads=0;
  const state={roomId:'room_test',room:{status:'won'}};
  const status={innerHTML:'',querySelector(){return {addEventListener(){}};}};
  const call=vm.runInNewContext(claim+'\nclaimRaidReward',{
    state,data:()=>current,document:{getElementById:()=>status},console:{error(){}},
    window:{dispatchEvent(){}},CustomEvent:class{},escapeHtml:String,renderRaidLoot:()=>'<b>loot</b>',
    rewardRepository:{async claimRaid(){claims++;if(claimError)throw Error('retry');return {awarded:false,inventory:{'raid-refine-key-ii':999}};}},
    playerRepository:{currentUser:()=>({uid:current.uid}),async get(){reads++;if(switchAccount)current={uid:'b'};if(getError)throw Error('read failed');return fresh;}}
  });
  return {call,state,local,status,claims:()=>claims,reads:()=>reads};
}
test('duplicate victory receipt cannot restore keys consumed since the original reward',async()=>{
  const f=fixture({fresh:{materialSystem:{inventory:{'raid-refine-key-ii':0}},raidProgress:{}}});
  await f.call();assert.equal(f.local.materialSystem.inventory['raid-refine-key-ii'],0);
  assert.equal(f.state.rewardClaimedRoomId,'room_test');await f.call();assert.equal(f.claims(),1);
});
test('failed inventory refresh remains retryable after reward was committed',async()=>{
  const f=fixture({getError:true});await f.call();assert.match(f.status.innerHTML,/已入帳，背包待同步/);
  assert.equal(f.state.rewardClaimedRoomId,undefined);await f.call();assert.equal(f.claims(),2);
});
test('victory response after account switch does not change the old account',async()=>{
  const f=fixture({fresh:{materialSystem:{inventory:{x:10}}},switchAccount:true});
  await f.call();assert.deepEqual(f.local.materialSystem.inventory,{'raid-refine-key-ii':0});
  assert.equal(f.state.rewardClaimedRoomId,undefined);
});
const view=fs.readFileSync(path.join(__dirname,'../public/cultivation/raid-loot-view.js'),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
test('loot view safely renders material names and blocks executable image URLs',()=>{
  const render=vm.runInNewContext(view+'\nrenderRaidLoot',{getMaterialById:()=>({name:'<script>x</script>',imageUrl:'javascript:alert(1)',icon:'<b>'})});
  const html=render({awarded:true,rewards:{x:2},firstVictory:true,memento:{name:'<svg>'}});
  assert.doesNotMatch(html,/<script>|javascript:|<svg>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/×2/);
});
test('learning view clearly distinguishes pending from settled earnings',()=>{
  const render=vm.runInNewContext(view+'\nrenderRaidLearning',{getMaterialById(){}});
  const member={learningCorrect:3,spiritCorrect:2};
  assert.match(render(member,null),/待入帳/);
  const settled=render(member,{settledLearningCorrect:3,settledCorrect:2});
  assert.match(settled,/已入帳/);assert.match(settled,/\+60/);assert.doesNotMatch(settled,/待入帳/);
});
