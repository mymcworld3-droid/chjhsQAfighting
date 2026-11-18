'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/manual-library-view.js'),'utf8');
const strip=s=>s.replace(/^import\s+.*;\s*$/gm,'')
  .replaceAll('export function ','function ');
const auxiliary=['manual-visual-progression.js','manual-anticipation.js']
  .map(name=>strip(fs.readFileSync(path.join(__dirname,'../public/cultivation',name),'utf8')));
const {filterOwnedManuals,renderManualCollectionHeader,renderManualCollectionSummary}=
  vm.runInNewContext([...auxiliary,strip(source),
    '({filterOwnedManuals,renderManualCollectionHeader,renderManualCollectionSummary})'].join('\n'),
    {},{filename:'manual-library-view.js'});
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

test('shelf card only displays owned book, current level and one stage',()=>{
  const card=draw();
  assert.match(card,/class="manual-book-top manual-library-choice"/);
  assert.match(card,/manual-library-cover/);
  assert.match(card,/Lv. 4/);
  assert.match(card,/data-feature-book="sword-wind"/);
  assert.match(card,/aria-pressed="false"/);
  assert.match(card,/初息/);
  assert.doesNotMatch(card,/62 \/ 100 EXP/);
  assert.doesNotMatch(card,/manual-library-exp-track/);
  assert.doesNotMatch(card,/manual-library-skill-picture/);
  assert.doesNotMatch(card,/data-manual-upgrade=/);
  assert.doesNotMatch(card,/下一招：/);
});

test('the selected book is visibly marked but not claimed as a combat loadout',()=>{
  const book=library[0],card=draw(book,book.id,[book.skills[0].id]);
  assert.match(card,/展示中/);
  assert.match(card,/aria-pressed="true"/);
  assert.doesNotMatch(card,/此配置已裝/);
  assert.doesNotMatch(card,/主修功法/);
});

test('maxed and approaching manuscripts get one brief status only',()=>{
  const max=book('sword-wind','sword',{level:20,progress:100});
  const card=draw(max,max.id);
  assert.match(card,/圓滿/);
  assert.doesNotMatch(card,/功法已達最高等級/);
  assert.doesNotMatch(card,/三招皆已領悟/);
  const next=book('sword-wind','sword',{
    level:4,totalExp:270,progress:90
  });
  const near=renderManualCollectionSummary(next,'',[],{
    ...tools,totalExpForLevel:l=>l===5?280:0
  });
  assert.match(near,/突破在即/);
  assert.equal((near.match(/manual-library-brief-state/g)||[]).length,1);
});

test('only safe escaped metadata enters summary markup',()=>{
  const item=book('sword-wind','sword',{name:'<img src=x onerror=alert(1)>',
    skills:book().skills.map((x,i)=>i?x:{...x,name:'<svg onload=alert(2)>'})});
  const card=draw(item);
  assert.doesNotMatch(card,/<img src=x onerror/);
  assert.doesNotMatch(card,/<svg onload/);
  assert.match(card,/&lt;img src=x/);
  assert.doesNotMatch(card,/&lt;svg onload/); // No duplicate skill metadata on collection cards.
});

test('a level-10 manual reads 大成, while a level-20 manual is actually 圓滿',()=>{
  const refined=draw(book('sword-wind','sword',{level:10,progress:0,tierRealm:'元嬰'}));
  assert.match(refined,/Lv. 10/);
  assert.match(refined,/大成/);
  assert.match(refined,/元嬰功法/);
  assert.match(refined,/manual-library-school-tag is-tier-nascent/);
  assert.doesNotMatch(refined,/圓滿/);
  const max=draw(book('sword-wind','sword',{level:20,progress:100,tierRealm:'元嬰'}));
  assert.match(max,/圓滿/);
});
