'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/manual-library-view.js'),'utf8');
const {filterOwnedManuals,renderManualCollectionHeader,renderManualCollectionSummary}=
  vm.runInNewContext(source.replaceAll('export function ','function ')+
    '\n({filterOwnedManuals,renderManualCollectionHeader,renderManualCollectionSummary})',{},
    {filename:'manual-library-view.js'});
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
const tools={
  esc,
  bookArt:id=>'/assets/books/'+id+'.png',
  skillArt:skill=>'/assets/skills/'+skill.id+'.png',
  label:school=>school==='sword'?'劍修':'體修'
};
const book=(id='sword-wind',school='sword',options={})=>({
  id,name:school==='sword'?'流風劍訣':'玄嶽鍛體訣',
  school,owned:true,level:4,expInLevel:62,expToNext:100,progress:62,
  skills:[
    {id:id+'-a',name:'第一招',level:1,levelRequired:1,cost:2,
      unlocked:true,mastered:true,realmReady:true,realmName:'煉氣'},
    {id:id+'-b',name:'第二招',level:1,levelRequired:5,cost:4,
      unlocked:false,mastered:false,realmReady:false,realmName:'築基'},
    {id:id+'-c',name:'第三招',level:1,levelRequired:10,cost:5,
      unlocked:false,mastered:false,realmReady:false,realmName:'金丹'}
  ],...options
});
const library=[
  book('sword-wind','sword'),
  book('body-rock','body'),
  book('secret','body',{name:'尚未取得的功法',owned:false})
];
const draw=(item=library[0],focus='',equipped=[])=>
  renderManualCollectionSummary(item,focus,equipped,tools);

test('filter all, sword and body only includes actually owned manuals',()=>{
  const state={library};
  assert.deepEqual(Array.from(filterOwnedManuals(state).map(x=>x.id)),['sword-wind','body-rock']);
  assert.deepEqual(Array.from(filterOwnedManuals(state,'sword').map(x=>x.id)),['sword-wind']);
  assert.deepEqual(Array.from(filterOwnedManuals(state,'body').map(x=>x.id)),['body-rock']);
  assert.equal(filterOwnedManuals(state,'unknown').length,2);
  assert.equal(filterOwnedManuals({library:[]}).length,0);
});

test('header reports ownership counts and offers keyboard-accessible filters',()=>{
  const head=renderManualCollectionHeader({library},'body',tools);
  assert.match(head,/功法收藏/);
  assert.match(head,/2 本/);
  assert.match(head,/data-manual-collection-filter="all"/);
  assert.match(head,/data-manual-collection-filter="sword"/);
  assert.match(head,/data-manual-collection-filter="body" aria-pressed="true"/);
  assert.match(head,/data-manual-refresh/);
});

test('book card displays level, exact server mastery, preview and locked realm conditions',()=>{
  const card=draw();
  assert.match(card,/manual-library-cover/);
  assert.match(card,/manual-book-art/);
  assert.match(card,/Lv. 4/);
  assert.match(card,/62 \/ 100 EXP/);
  assert.match(card,/aria-valuenow="62"/);
  assert.match(card,/已領悟 1 \/ 3 招/);
  assert.equal((card.match(/manual-library-skill-picture/g)||[]).length,3);
  assert.match(card,/下一招：第二招/);
  assert.match(card,/功法 Lv. 5/);
  assert.match(card,/築基境/);
  assert.match(card,/fa-lock/);
  assert.doesNotMatch(card,/展示中/);
});

test('focused and equipped book is visibly distinguished without claiming a new main mechanic',()=>{
  const item=library[0];
  const card=draw(item,item.id,[item.skills[0].id]);
  assert.match(card,/展示中/);
  assert.match(card,/此配置已裝 1 招/);
  assert.doesNotMatch(card,/主修功法/);
});

test('max level shows completion and respects separately unmet realm requirements',()=>{
  const item=book('sword-wind','sword',{level:10,progress:5,
    skills:book().skills.map(x=>({...x,unlocked:true,mastered:true,realmReady:true}))});
  const card=draw(item,item.id);
  assert.match(card,/功法已達最高等級/);
  assert.match(card,/aria-valuenow="100"/);
  assert.match(card,/三招皆已領悟/);
  assert.doesNotMatch(card,/下一招：/);
  const realmBlocked=book('sword-wind','sword',{level:10,skills:book().skills.map((x,i)=>({
    ...x,mastered:true,unlocked:i===0,realmReady:i===0
  }))});
  const blocked=draw(realmBlocked);
  assert.match(blocked,/下一招：第二招/);
  assert.match(blocked,/築基境/);
});

test('only safe escaped metadata enters summary markup',()=>{
  const item=book('sword-wind','sword',{name:'<img src=x onerror=alert(1)>',
    skills:book().skills.map((x,i)=>i?x:{...x,name:'<svg onload=alert(2)>'})});
  const card=draw(item);
  assert.doesNotMatch(card,/<img src=x onerror/);
  assert.doesNotMatch(card,/<svg onload/);
  assert.match(card,/&lt;img src=x/);
  assert.match(card,/&lt;svg onload/);
});
