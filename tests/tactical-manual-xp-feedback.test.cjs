'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-manual-xp-feedback.js'),'utf8');
const {manualXpDelta,renderManualXpToast}=vm.runInNewContext(
  source.replaceAll('export function ','function ')+
    '\n({manualXpDelta,renderManualXpToast})',{},
  {filename:'tactical-manual-xp-feedback.js'});
const catalog={
  BY_BOOK:{
    'sword-wind':{id:'sword-wind',name:'流風劍訣',school:'sword'},
    'body-rock':{id:'body-rock',name:'玄嶽鍛體訣',school:'body'},
    'sword-flight':{id:'sword-flight',name:'御劍真訣',school:'sword'},
    'sword-sky':{id:'sword-sky',name:'八方劍典',school:'sword'},
    'body-dragon':{id:'body-dragon',name:'龍象真身訣',school:'body'}
  },EXP_PER_KILL:50
};
const room=(options={})=>({
  id:'arena-1234567890123456',revision:10,status:'active',mode:'pve',
  manualExp:{u1:{'sword-wind':25},u2:{'body-rock':300}},
  manualKills:{u1:{}},...options
});
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
const opts={esc:escape,bookArt:id=>'/assets/books/'+id+'.png'};

test('a new room, resumed first snapshot or wrong mode never fabricates a live gain',()=>{
  const old=room(),next=room({revision:11,manualExp:{u1:{'sword-wind':40}}});
  assert.equal(manualXpDelta(null,next,'u1',catalog),null);
  assert.equal(manualXpDelta(room({id:'different'}),next,'u1',catalog),null);
  assert.equal(manualXpDelta(room({mode:'pvp'}),next,'u1',catalog),null);
  assert.equal(manualXpDelta(old,room({mode:'pvp'}),'u1',catalog),null);
  assert.equal(manualXpDelta(old,room({status:'waiting'}),'u1',catalog),null);
});

test('same-room authoritative per-book delta returns only newly recorded EXP',()=>{
  const old=room(),next=room({revision:11,manualExp:{u1:{'sword-wind':60}}});
  const result=manualXpDelta(old,next,'u1',catalog);
  assert.equal(result.total,35);
  assert.equal(result.books[0].name,'流風劍訣');
  assert.equal(result.books[0].earned,35);
  assert.match(renderManualXpToast(result,opts),/\+35 EXP/);
  assert.match(renderManualXpToast(result,opts),/tc-manual-xp-entry--sword/);
});

test('unchanged, rewound and older-revision ledgers never replay a popup',()=>{
  const original=room(),same=room({revision:11});
  assert.equal(manualXpDelta(original,same,'u1',catalog),null);
  assert.equal(manualXpDelta(room({manualExp:{u1:{'sword-wind':100}}}),original,'u1',catalog),null);
  assert.equal(manualXpDelta(room({revision:12}),original,'u1',catalog),null);
});

test('only the requesting player ledger is counted and unknown IDs are ignored',()=>{
  const first=room(),second=room({revision:11,
    manualExp:{u1:{'sword-wind':26,'unknown':10000},u2:{'body-rock':1200}}});
  const delta=manualXpDelta(first,second,'u1',catalog);
  assert.equal(delta.total,1);
  assert.equal(delta.books.length,1);
  assert.equal(manualXpDelta(first,second,'u2',catalog)?.total,900);
});

test('mixed modern XP and legacy kills are accounted individually but only once',()=>{
  const first=room();
  const second=room({revision:11,
    manualExp:{u1:{'sword-wind':55}},
    manualKills:{u1:{'body-rock':2}}});
  const delta=manualXpDelta(first,second,'u1',catalog);
  assert.equal(delta.total,130);
  assert.deepEqual(Array.from(delta.books.map(b=>[b.id,b.earned])),
    [['body-rock',100],['sword-wind',30]]);
  assert.match(renderManualXpToast(delta,opts),/tc-manual-xp-entry--body/);
  assert.equal(manualXpDelta(second,second,'u1',catalog),null);
});

test('negative, invalid and non-finite input does not show experience',()=>{
  const old=room();
  const next=room({revision:11,
    manualExp:{u1:{'sword-wind':-3,'body-rock':Infinity,'sword-flight':'nan'}},
    manualKills:{u1:{'sword-sky':-3}}});
  assert.equal(manualXpDelta(old,next,'u1',catalog),null);
});

test('multi-book updates display concise top three and accurate combined total',()=>{
  const old=room({manualExp:{u1:{}}});
  const next=room({revision:11,manualExp:{u1:{
    'sword-wind':10,'body-rock':20,'sword-flight':30,'sword-sky':40,'body-dragon':50
  }}});
  const delta=manualXpDelta(old,next,'u1',catalog);
  assert.equal(delta.total,150);
  const html=renderManualXpToast(delta,opts);
  assert.equal((html.match(/tc-manual-xp-entry--/g)||[]).length,3);
  assert.match(html,/另外 2 本功法也獲得經驗/);
  assert.match(html,/\+150 EXP/);
});

test('HTML metadata is escaped; the renderer never mutates combat snapshots',()=>{
  const malicious={BY_BOOK:{
    'sword-wind':{name:'<svg onload=alert(1)>',school:'sword'}
  },EXP_PER_KILL:50};
  const old=room(),next=room({revision:11,manualExp:{u1:{'sword-wind':27}}});
  const before=JSON.stringify([old,next]);
  const html=renderManualXpToast(manualXpDelta(old,next,'u1',malicious),opts);
  assert.doesNotMatch(html,/<svg onload/);
  assert.match(html,/&lt;svg onload/);
  assert.equal(JSON.stringify([old,next]),before);
  assert.equal(renderManualXpToast(null,opts),'');
});
