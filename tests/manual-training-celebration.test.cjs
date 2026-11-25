'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/manual-celebration.js'),'utf8');
const {detectManualCelebration,renderManualCelebration}=vm.runInNewContext(
  source.replace(/^import .*;\n/gm,'').replaceAll('export function ','function ')+
    '\n({detectManualCelebration,renderManualCelebration})',require('./helpers/presentations.cjs'),
  {filename:'manual-celebration.js'}
);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
const art={
  esc,
  bookArt:id=>'/assets/books/'+id+'.png',
  skillArt:skill=>'/assets/skills/'+(typeof skill==='string'?skill:skill?.id)+'.png',
  findSkill:id=>({id,name:id})
};
const book=(level=4,second=false,options={})=>({
  id:'sword-wind',name:'流風劍訣',school:'sword',owned:true,level,
  skills:[
    {id:'wind-slash',name:'流風斬',level:1,unlocked:true,mastered:true,realmReady:true},
    {id:'wind-step',name:'突進橫斬',level:1,unlocked:second,mastered:level>=5,realmReady:second,realmName:'築基'},
    {id:'wind-thousand',name:'遠線破擊',level:1,unlocked:false,mastered:level>=10,realmReady:false,realmName:'金丹'}
  ],...options
});
const state=(...books)=>({library:books});
const detect=(prev,next,context)=>detectManualCelebration(prev,next,context);
test('never celebrate first load, identical refresh, or a server-denied upgrade',()=>{
  const old=state(book(4,false));
  assert.equal(detect(null,old),null);
  assert.equal(detect(old,old),null);
  assert.equal(detect(old,state(book(4,false)),{kind:'upgrade',bookId:'sword-wind'}),null);
  assert.equal(detect({library:[]},{library:[]}),null);
});

test('a successful manual level gain produces a level change, but not an invented unlock',()=>{
  const result=detect(state(book(4,false)),state(book(5,false)),{kind:'upgrade',bookId:'sword-wind'});
  assert.equal(result.kind,'manual-upgrade');
  assert.equal(result.previousLevel,4);
  assert.equal(result.level,5);
  assert.doesNotMatch(result.extra,/修士境界/);
  assert.doesNotMatch(result.heading,/領悟/);
});

test('effective skill unlock gets a breakthrough reward with correct skill',()=>{
  const result=detect(state(book(4,false)),state(book(5,true)),{kind:'upgrade',bookId:'sword-wind'});
  assert.equal(result.kind,'unlock');
  assert.equal(result.skillId,'wind-step');
  assert.equal(result.level,5);
  assert.match(result.detail,/突進橫斬/);
  assert.match(renderManualCelebration(result,art),/招式領悟/);
});

test('skill upgrade only celebrates an actual server-side level increase',()=>{
  const first=book(4,false),second=book(4,false);
  second.skills[0].level=2;
  const reward=detect(state(first),state(second),{kind:'upgrade',skillId:'wind-slash'});
  assert.equal(reward.kind,'skill-upgrade');
  assert.equal(reward.level,2);
  assert.equal(reward.previousLevel,1);
  assert.match(renderManualCelebration(reward,art),/招式 Lv./);
  assert.equal(detect(state(second),state(second),{kind:'upgrade',skillId:'wind-slash'}),null);
});

test('newly obtained book causes reveal only for a prior owned-library baseline',()=>{
  const existing=state(book(4,false));
  const next=state(book(4,false),book(1,false,{id:'body-rock',name:'玄嶽鍛體訣',school:'body'}));
  const reward=detect(existing,next,{kind:'sync'});
  assert.equal(reward.kind,'discovery');
  assert.equal(reward.name,'玄嶽鍛體訣');
  assert.equal(reward.heading,'新功法入藏');
  assert.equal(reward.school,'body');
  assert.equal(detect(next,next,{kind:'sync'}),null);
  const starter=detect(state(),state(book(1)),{kind:'school'});
  assert.equal(starter.kind,'discovery');
  assert.equal(starter.heading,'初悟功法');
  assert.equal(detect(null,next,{kind:'sync'}),null);
});

test('newly discovered book takes precedence over XP gains; no duplicated unlock',()=>{
  const next=state(book(5,true),book(1,false,{id:'body-rock',school:'body'}));
  const reward=detect(state(book(4,false)),next,{kind:'sync'});
  assert.equal(reward.kind,'discovery');
  assert.equal(reward.bookId,'body-rock');
});

test('book and skill titles are escaped and do not inject attributes',()=>{
  const bad=book(5,true,{name:'<img src=x onerror=alert(1)>'});
  bad.skills[1].name='<svg onload=alert(2)>';
  const reward=detect(state(book(4,false)),state(bad));
  const html=renderManualCelebration(reward,art);
  assert.doesNotMatch(html,/<svg onload/);
  assert.doesNotMatch(html,/<img src=x onerror/);
  assert.match(html,/&lt;svg onload/);
  assert.match(html,/&lt;img src=x/);
  assert.equal((html.match(/--spark:/g)||[]).length,12);
  assert.match(html,/data-manual-celebration-dismiss/);
});

test('missing and unknown rewards render nothing',()=>{
  assert.equal(renderManualCelebration(null,art),'');
  assert.equal(renderManualCelebration({kind:'unknown'},art),'');
});
