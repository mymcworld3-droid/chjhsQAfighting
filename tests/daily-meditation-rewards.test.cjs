'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Feedback=require('../public/cultivation/daily-meditation-rewards.js');
test('the receipt displays only positive committed resources, never ticket conversion twice',()=>{
  const rows=Feedback.entries({gold:90,raidTickets:0,drawTickets:1,convertedRaidGold:60,cultivation:0,fragments:-3});
  assert.deepEqual(rows.map(row=>[row.key,row.amount]),[['gold',90],['drawTickets',1]]);
  assert.deepEqual(Feedback.entries({gold:NaN,fragments:Infinity,raidTickets:'invalid'}),[]);
});
test('personal receipts retain cultivation, spirit stones and essence independently',()=>{
  assert.deepEqual(Feedback.entries({cultivation:4,gold:45,fragments:3}).map(row=>[row.label,row.amount]),[['修為',4],['靈石',45],['元嬰碎精',3]]);
});
test('missing identities, empty receipts and stale account receipts cannot open feedback',()=>{
  assert.equal(Feedback.show({}),false);
  assert.equal(Feedback.show({uid:'a',receiptId:'one',reward:{gold:30},isCurrent:()=>false}),false);
  assert.equal(Feedback.show({uid:'a',receiptId:'one',reward:{gold:0}}),false);
});

test('embedded and modal receipts render identical resource cards, with final or animated numbers',()=>{
  const reward={cultivation:4,gold:1250,convertedRaidGold:60};
  const embedded=Feedback.renderList(reward,{inline:true});
  const animated=Feedback.renderList(reward,{animated:true});
  assert.match(embedded,/mr-reward-list--inline mr-reward-list--static/);
  assert.match(embedded,/cultivation\.webp/);
  assert.match(embedded,/gold\.webp/);
  assert.match(embedded,/>[+]1,250<\/strong>/);
  assert.equal((animated.match(/>\+0<\/strong>/g)||[]).length,2);
  assert.equal((embedded.match(/class="mr-reward-item"/g)||[]).length,2);
  assert.doesNotMatch(embedded,/convertedRaidGold|<button|<dialog/);
  assert.equal(Feedback.renderList({gold:0,cultivation:0}), '');
  assert.match(Feedback.renderList({cultivation:3}),/修為/);
});
test('inline animation stays visual, skips stale or repeated receipts and respects reduced motion',()=>{
  const vm=require('node:vm'),fs=require('node:fs');
  const src=fs.readFileSync(require.resolve('../public/cultivation/daily-meditation-rewards.js'),'utf8');
  let now=0,frames=[],reduced=false;
  const ctx={module:{exports:{}},matchMedia:()=>({matches:reduced}),performance:{now:()=>now},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;}};
  vm.runInNewContext(src,ctx);
  const api=ctx.module.exports;
  function host(){const elements=[{textContent:'+25'}];return {isConnected:true,elements,querySelector:()=>({classList:{remove(){}}}),querySelectorAll:()=>elements};}
  const options={uid:'u',receiptId:'trial:1',reward:{gold:25},isCurrent:()=>true};
  const first=host();assert.equal(api.animateInline(first,options),true);
  assert.equal(first.elements[0].textContent,'+0');assert.equal(frames.length,1);
  now=1000;frames.shift()(now);assert.equal(first.elements[0].textContent,'+25');
  const reopened=host();assert.equal(api.animateInline(reopened,options),false);assert.equal(reopened.elements[0].textContent,'+25');
  assert.equal(api.animateInline(host(),{...options,receiptId:'trial:2',isCurrent:()=>false}),false);
  reduced=true;assert.equal(api.animateInline(host(),{...options,receiptId:'trial:3'}),false);assert.equal(frames.length,0);
});
test('trial settlement embeds the shared list without replacing navigation or dungeon settlement',()=>{
  const src=require('node:fs').readFileSync(require.resolve('../public/cultivation/tactical-combat.js'),'utf8');
  const result=src.slice(src.indexOf('function resultDialog(){'),src.indexOf('function leaveDialog(){'));
  assert.match(result,/presentation\?\.renderList\(reward,\{inline:true\}\)/);
  assert.match(result,/presentation\.animateInline/);
  assert.match(result,/data-next-stage/);
  assert.match(result,/data-tutorial-collapse/);
  assert.match(result,/data-manual-training/);
  assert.match(result,/data-weapon-dungeon-retry/);
  assert.match(result,/data-exit/);
  assert.doesNotMatch(result,/data-mr-collect|QAMeditationRewardFeedback\?*\.show/);
});
