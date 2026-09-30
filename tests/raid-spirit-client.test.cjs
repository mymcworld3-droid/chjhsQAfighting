const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/raid-room.js'),'utf8')
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');

test('raid reward response mirrors server spirit without a second persistence write',async()=>{
  const local={uid:'a',stats:{nascentSoulSpirit:10}};let refreshed=0,requests=0;
  const api=vm.runInNewContext(source+'\napi',{
    window:{getCurrentUserData:()=>local,updateUIStats(){refreshed++;}},
    raidRepository:{async request(){requests++;return {spiritReward:{uid:'a',totalSpirit:11}};}}});
  await api('player-action');
  assert.equal(local.stats.nascentSoulSpirit,11);assert.equal(refreshed,1);assert.equal(requests,1);
});

test('stale raid poll cannot reduce cumulative spirit or refresh unnecessarily',async()=>{
  const local={uid:'a',stats:{nascentSoulSpirit:20}};let refreshed=0;
  const api=vm.runInNewContext(source+'\napi',{
    window:{getCurrentUserData:()=>local,updateUIStats(){refreshed++;}},
    raidRepository:{async request(){return {spiritReward:{uid:'a',totalSpirit:11}};}}});
  await api('get');assert.equal(local.stats.nascentSoulSpirit,20);assert.equal(refreshed,0);
});

test('reward completing after account switch does not modify either account',async()=>{
  const original={uid:'a',stats:{nascentSoulSpirit:10}},next={uid:'b',stats:{nascentSoulSpirit:4}};
  let current=original;
  const api=vm.runInNewContext(source+'\napi',{
    window:{getCurrentUserData:()=>current,updateUIStats(){throw Error('unexpected refresh');}},
    raidRepository:{async request(){current=next;return {spiritReward:{uid:'a',totalSpirit:11}};}}});
  await api('get');assert.equal(original.stats.nascentSoulSpirit,10);assert.equal(next.stats.nascentSoulSpirit,4);
});
