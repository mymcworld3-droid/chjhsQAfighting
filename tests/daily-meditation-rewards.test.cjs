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
  const ctx={...require('./helpers/presentations.cjs'),module:{exports:{}},matchMedia:()=>({matches:reduced}),performance:{now:()=>now},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;}};
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
  const result=src.slice(src.indexOf('function dungeonSettlementMarkup('),src.indexOf('function leaveDialog(){'));
  assert.match(result,/presentation\.renderSettlement\(settlementReward,/);
  assert.match(result,/presentation\.animateInline/);
  assert.match(result,/data-next-stage/);
  assert.match(result,/data-tutorial-collapse/);
  assert.match(result,/data-manual-training/);
  assert.match(result,/data-weapon-dungeon-retry/);
  assert.match(result,/data-exit/);
  assert.doesNotMatch(result,/data-mr-collect|QAMeditationRewardFeedback\?*\.show/);
});

test('three sizes share art and format, and preview never represents a credited reward',()=>{
  const reward={gold:1250,cultivation:2,weaponDungeonTicket:1};
  const full=Feedback.renderList(reward);
  const general=Feedback.renderList(reward,{variant:'general',preview:true});
  const small=Feedback.renderFeedback({cultivation:-2,gold:0});
  assert.match(full,/mr-reward-list--full/);
  assert.match(general,/mr-reward-list--general/);
  assert.match(general,/可獲得的獎勵/);
  assert.match(general,/>1,250<\/strong>/);
  assert.doesNotMatch(general,/>\+1,250<\/strong>/);
  assert.match(small,/mr-reward-list--small/);
  assert.match(small,/>−2<\/strong>/);
  assert.match(small,/>[+]0<\/strong>/);
  assert.doesNotMatch(small,/<dialog|<button|<ul/);
  assert.match(full,/weapon-dungeon-ticket\.webp/);
  assert.doesNotMatch(full,/raid-ticket\.webp/);
});
test('weapon and mastery rows use existing weapon art and explicit server amounts',()=>{
  const reward={weapon:{id:'sword-wind',name:'測試武器<&',tierRealm:'金丹',quantity:1},
    weaponXp:[{id:'body-rock',name:'岩拳',earned:1234},{id:'../bad',name:'bad',earned:50}]};
  const html=Feedback.renderList(reward);
  assert.match(html,/\/assets\/weapons\/sword-wind-hd\.webp/);
  assert.match(html,/\/assets\/weapons\/body-rock-hd\.webp/);
  assert.match(html,/測試武器&lt;&amp;/);
  assert.match(html,/\+1,234 EXP/);
  assert.match(html,/武器熟練度/);
  assert.doesNotMatch(html,/\.\.\/bad|測試武器<&/);
  assert.equal(Feedback.entries({weapon:{id:'sword-wind',name:'未確認',quantity:0}}).length,0);
});
test('settlement distinguishes missing receipts and zero rewards without blocking navigation',()=>{
  assert.match(Feedback.renderSettlement(null),/尚未確認入帳/);
  assert.match(Feedback.renderSettlement({gold:0,cultivation:0}),/無額外獎勵/);
  assert.match(Feedback.renderSettlement({cultivation:3}),/data-trial-reward-list/);
  assert.doesNotMatch(Feedback.renderSettlement({gold:2}),/<dialog|<button|data-mr-collect/);
});

test('phase 4 material rewards retain original quest names and quantities',()=>{
  const html=Feedback.renderList({materials:{'raid-refine-key-ii':2,'old-test-id':3}},{variant:'general',preview:true});
  assert.match(html,/淬靈玄印/);
  assert.match(html,/old-test-id/);
  assert.match(html,/>2<\/strong>/);
  assert.match(html,/>3<\/strong>/);
  assert.doesNotMatch(html,/weapon-dungeon-ticket/);
});
test('phase 4 settlement title is escaped and does not introduce a claim button',()=>{
  const html=Feedback.renderSettlement({gold:3},{title:'<洞天>'});
  assert.match(html,/&lt;洞天&gt;/);
  assert.doesNotMatch(html,/<button|<dialog/);
});
test('four active reward flows delegate rendering while preserving their original operations',()=>{
  const fs=require('node:fs');
  const read=p=>fs.readFileSync(require.resolve('../public/cultivation/'+p),'utf8');
  const vocab=read('daily-vocabulary-page.js'),quest=read('quest-system.js'),dt=read('dongtian.js'),battle=read('tactical-combat.js');
  assert.match(vocab,/QARewardPresentation\.renderList\(reward,\{variant:'general'\}\)/);
  assert.match(vocab,/retry-reward/);
  assert.match(quest,/QARewardPresentation\.renderList\(reward,\{variant:'general',preview:true\}\)/);
  assert.match(quest,/result\.awarded\?result\.reward:null/);
  assert.match(quest,/\/api\/quests\/claim/);
  assert.match(dt,/presentation\.renderSettlement\(settlementReward/);
  assert.match(dt,/reward\.applied===true/);
  assert.match(dt,/dt-retry-settlement/);
  assert.match(battle,/presentation\.renderSettlement\(dungeonReward/);
  assert.match(battle,/data-weapon-dungeon-retry/);
  assert.match(battle,/data-weapon-dungeon-menu/);
});

test('all six reward states have explicit labels and escape detail text',()=>{
  for(const [state,label] of Object.entries({obtainable:'可獲得',pending:'待領取',settling:'結算中',claimed:'已領取',unconfirmed:'尚未確認入帳',none:'本次無額外獎勵'})){
    const html=Feedback.renderStatus(state,'<detail>');
    assert.ok(html.includes('data-reward-state="'+state+'"'));
    assert.ok(html.includes(label));
    assert.ok(html.includes('&lt;detail&gt;'));
  }
});
test('cosmetic receipt ledger survives reload, separates accounts and does not replay sound',()=>{
  const vm=require('node:vm'),fs=require('node:fs');
  const src=fs.readFileSync(require.resolve('../public/cultivation/daily-meditation-rewards.js'),'utf8');
  const storage=new Map(),sounds=[];
  function boot(){
    const ctx={...require('./helpers/presentations.cjs'),module:{exports:{}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},QAGameAudio:{play:(...args)=>sounds.push(args)}};
    vm.runInNewContext(src,ctx);return ctx.module.exports;
  }
  const opt={uid:'a',receiptId:'test:1',reward:{gold:20}};
  assert.equal(boot().celebrate(opt),true);
  assert.equal(boot().celebrate(opt),false);
  assert.equal(boot().celebrate({...opt,uid:'b'}),true);
  assert.equal(boot().celebrate({...opt,receiptId:'pending',isCurrent:()=>false}),false);
  assert.equal(sounds.length,2);
});
test('skip completes numbers without a transaction or another reward sound',()=>{
  const vm=require('node:vm'),fs=require('node:fs');
  const src=fs.readFileSync(require.resolve('../public/cultivation/daily-meditation-rewards.js'),'utf8');
  const frames=[],sounds=[];
  const ctx={...require('./helpers/presentations.cjs'),module:{exports:{}},performance:{now:()=>0},requestAnimationFrame:f=>{frames.push(f);return frames.length;},cancelAnimationFrame(){},QAGameAudio:{play:(...a)=>sounds.push(a)}};
  vm.runInNewContext(src,ctx);
  const api=ctx.module.exports,els=[{textContent:'+20'}],host={querySelector:()=>({classList:{remove(){},add(){}}}),querySelectorAll:()=>els};
  assert.equal(api.animateInline(host,{uid:'a',receiptId:'skip',reward:{gold:20}}),true);
  assert.equal(els[0].textContent,'+0');
  assert.equal(api.skipInline(host),true);
  assert.equal(els[0].textContent,'+20');
  frames[0](100);assert.equal(els[0].textContent,'+20');
  assert.equal(sounds.length,1);
});
