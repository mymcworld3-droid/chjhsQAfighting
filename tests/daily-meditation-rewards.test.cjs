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
