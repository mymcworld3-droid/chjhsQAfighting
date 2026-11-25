'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/tactical-manual-recap.js'),'utf8');
const {manualBattleEarnings,renderManualBattleRecap}=vm.runInNewContext(
  source.replace(/^import .*;\n/gm,'').replaceAll('export function ','function ')+'\n({manualBattleEarnings,renderManualBattleRecap})',
  require('./helpers/presentations.cjs'),{filename:'tactical-manual-recap.js'}
);
const manuals={
  BY_BOOK:{
    'sword-wind':{id:'sword-wind',name:'流風劍訣',school:'sword'},
    'body-rock':{id:'body-rock',name:'玄嶽鍛體訣',school:'body'}
  },
  EXP_PER_KILL:50,
  totalExpForLevel:level=>({1:0,2:40,3:100,4:180,5:280,6:400,7:540,8:700,9:880,10:1080})[level]||0
};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
const options={esc,bookArt:id=>'/assets/books/'+id+'.png'};
const room=(change={})=>({
  id:'arena-1234567890123456',status:'finished',mode:'pve',rewarded:['u1'],
  manualExp:{u1:{'sword-wind':70},u2:{'body-rock':999}},
  manualKills:{u1:{'body-rock':2}},...change
});
const book=(level=4,opts={})=>({
  id:'sword-wind',name:'流風劍訣',school:'sword',owned:true,level,
  totalExp:180,expInLevel:40,expToNext:100,progress:40,
  skills:[
    {id:'first',name:'流風斬',unlocked:true,mastered:true,realmReady:true,levelRequired:1},
    {id:'second',name:'突進橫斬',unlocked:false,mastered:level>=5,realmReady:false,realmName:'築基',levelRequired:5},
    {id:'third',name:'遠線破擊',unlocked:false,mastered:false,realmReady:false,realmName:'金丹',levelRequired:10}
  ],...opts
});
test('no EXP claim before finished + settled and no PvP manual EXP',()=>{
  assert.equal(manualBattleEarnings(room({status:'active'}),'u1',manuals),null);
  assert.equal(manualBattleEarnings(room({rewarded:[]}), 'u1',manuals),null);
  assert.equal(manualBattleEarnings(room({mode:'pvp'}),'u1',manuals),null);
  assert.equal(renderManualBattleRecap(room({rewarded:[]}), 'u1',manuals,null,options),'');
});
test('combine modern per-room EXP with legacy recorded kills, counted once',()=>{
  const r=manualBattleEarnings(room(),'u1',manuals);
  assert.equal(r.total,170);
  assert.deepEqual(Array.from(r.books.map(x=>[x.id,x.earned])),
    [['body-rock',100],['sword-wind',70]]);
  assert.equal(manualBattleEarnings(room(),'u2',manuals),null);
});
test('unknown books and invalid/negative/non-finite XP values are never rendered',()=>{
  const r=manualBattleEarnings(room({
    manualExp:{u1:{'sword-wind':-9,'other':'9999999','body-rock':'Infinity'}},
    manualKills:{u1:{'sword-wind':-2,'body-rock':'nan'}}
  }),'u1',manuals);
  assert.equal(r.total,0);
  assert.equal(r.books.length,0);
  assert.doesNotMatch(renderManualBattleRecap(room({
    manualExp:{u1:{'other':100}},manualKills:{u1:{}}
  }),'u1',manuals,null,options),/data-manual-recap-book=/);
});
test('reward breakdown is readable while authoritative mastery snapshot is loading',()=>{
  const html=renderManualBattleRecap(room(),'u1',manuals,null,options);
  assert.match(html,/本場熟練度成果/);
  assert.match(html,/\+170/);
  assert.match(html,/流風劍訣/);
  assert.match(html,/玄嶽鍛體訣/);
  assert.match(html,/正在同步功法等級/);
  assert.equal((html.match(/data-manual-recap-book=/g)||[]).length,2);
});
test('server-confirmed mastery supplies next level and level-5 unlock XP requirement',()=>{
  const html=renderManualBattleRecap(room(),'u1',manuals,{library:[book()]},options);
  assert.match(html,/Lv. 4/);
  assert.match(html,/40 \/ 100/);
  assert.match(html,/尚需 60 EXP 升級/);
  assert.match(html,/尚需 100 EXP/);
  assert.match(html,/下一招 · 突進橫斬/);
  assert.match(html,/aria-valuenow="40"/);
});
test('stale level-5 unlock state requests confirmation without a realm condition',()=>{
  const html=renderManualBattleRecap(room(),'u1',manuals,{
    library:[book(5,{totalExp:310,expInLevel:30,expToNext:120,progress:25})]
  },options);
  assert.match(html,/Lv. 5/);
  assert.match(html,/招式尚未解鎖，請在功法閣確認/);
  assert.doesNotMatch(html,/築基境|修士境界/);
  assert.doesNotMatch(html,/三招皆已領悟/);
});
test('level 10 has more mastery levels ahead, even with all three skills learned',()=>{
  const skills=book().skills.map(x=>({...x,unlocked:true,mastered:true,realmReady:true}));
  const html=renderManualBattleRecap(room(),'u1',manuals,{
    library:[book(10,{totalExp:1080,expInLevel:0,expToNext:220,progress:0,skills})]
  },options);
  assert.doesNotMatch(html,/功法已達最高等級/);
  assert.match(html,/三招皆已領悟/);
  assert.match(html,/尚需 220 EXP 升級/);
  assert.match(html,/aria-valuenow="0"/);
});
test('failed post-battle mastery sync never pretends to be loading forever',()=>{
  const html=renderManualBattleRecap(room(),'u1',manuals,null,
    {...options,syncFailed:true});
  assert.match(html,/最新功法等級暫時無法取得/);
  assert.doesNotMatch(html,/正在同步功法等級與下一招目標/);
  assert.match(html,/\+170/);
});
test('zero EXP gives an accurate empty recap rather than a fabricated gain',()=>{
  const html=renderManualBattleRecap(room({
    manualExp:{u1:{}},manualKills:{u1:{}}
  }),'u1',manuals,null,options);
  assert.match(html,/本場沒有記錄功法 EXP/);
  assert.doesNotMatch(html,/\+50/);
});
test('HTML escaped book title and mastery status cannot inject markup',()=>{
  const custom={...manuals,BY_BOOK:{'sword-wind':{
    id:'sword-wind',name:'<img src=x onerror=alert(1)>',school:'sword'
  }}};
  const html=renderManualBattleRecap(room({manualExp:{u1:{'sword-wind':10}},manualKills:{u1:{}}}),
    'u1',custom,{library:[book(4,{name:'bad',skills:book().skills.map((s,i)=>i?{...s,name:'<svg onload=alert(1)>'}:s)})]},options);
  assert.doesNotMatch(html,/<img src=x onerror=/);
  assert.doesNotMatch(html,/<svg onload=/);
  assert.match(html,/&lt;img/);
  assert.match(html,/&lt;svg/);
});
test('rendering does not mutate finished battle ledgers or the library',()=>{
  const r=room(),m={library:[book()]};
  const before=JSON.stringify([r,m]);
  renderManualBattleRecap(r,'u1',manuals,m,options);
  assert.equal(JSON.stringify([r,m]),before);
});

test('only level 20 is shown as full mastery in post-battle recap',()=>{
  const skills=book().skills.map(x=>({...x,unlocked:true,mastered:true,realmReady:true}));
  const h=renderManualBattleRecap(room(),'u1',manuals,{
    library:[book(20,{totalExp:4180,expInLevel:0,expToNext:0,progress:100,skills})]
  },options);
  assert.match(h,/Lv. 20/);
  assert.match(h,/功法已達最高等級/);
  assert.match(h,/aria-valuenow="100"/);
});
