'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const read=name=>fs.readFileSync(path.join(__dirname,'../public/cultivation',name),'utf8')
  .replace(/^import\s+.*;\s*$/gm,'')
  .replace(/^export function /gm,'function ');
const {manualVisualState,manualSkillVisualState,renderManualVisualMilestones,
  renderManualHero,renderManualCollectionSummary,filterOwnedManuals}=
  vm.runInNewContext([
    read('manual-visual-progression.js'),
    read('manual-hero-view.js'),
    read('manual-library-view.js'),
    '({manualVisualState,manualSkillVisualState,renderManualVisualMilestones,renderManualHero,renderManualCollectionSummary,filterOwnedManuals})'
  ].join('\n'),{});

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
const helpers={
  esc:escape,
  bookArt:id=>'/assets/books/'+id+'.png',
  skillArt:skill=>'/assets/skills/'+skill.id+'.png',
  label:school=>school==='sword'?'劍修':'體修'
};
const makeBook=(level,school='sword',options={})=>({
  id:school==='sword'?'sword-wind':'body-rock',
  name:school==='sword'?'流風劍訣':'玄嶽鍛體訣',
  school,owned:true,level,progress:45,
  expInLevel:45,expToNext:100,upgrade:level<10?{targetLevel:level+1,gold:110}:null,
  skills:[
    {id:'first',name:'第一招',level:1,cost:2,levelRequired:1,mastered:true,realmReady:true,unlocked:true},
    {id:'second',name:'第二招',level:1,cost:4,levelRequired:5,
      mastered:level>=5,realmReady:false,realmName:'築基',unlocked:false},
    {id:'third',name:'第三招',level:1,cost:5,levelRequired:10,
      mastered:level>=10,realmReady:false,realmName:'金丹',unlocked:false}
  ],...options
});
const state=book=>({school:book.school,gold:500,library:[book],loadouts:[],equipped:[]});
const hero=book=>renderManualHero(state(book),book.id,helpers).html;
const card=book=>renderManualCollectionSummary(book,book.id,[],helpers);

test('four visual stages use exact level boundaries, clamping unexpected values',()=>{
  const cases=[[1,'seed','初息'],[4,'seed','初息'],
    [5,'inscribed','凝紋'],[7,'inscribed','凝紋'],
    [8,'surge','盛氣'],[9,'surge','盛氣'],
    [10,'complete','圓滿'],[300,'complete','圓滿'],[-1,'seed','初息']];
  for(const [level,stage,label] of cases){
    assert.equal(manualVisualState({level}).stage,stage);
    assert.equal(manualVisualState({level}).label,label);
  }
  assert.equal(manualVisualState({level:'not a number'}).stage,'seed');
});

test('ten segment markers distinguish reached, current and level-5/10 skill milestones',()=>{
  const html=renderManualVisualMilestones(makeBook(5),escape);
  assert.equal((html.match(/class="manual-growth-mark /g)||[]).length,10);
  assert.equal((html.match(/is-reached/g)||[]).length,5);
  assert.equal((html.match(/is-current/g)||[]).length,1);
  assert.equal((html.match(/is-milestone/g)||[]).length,3);
  assert.match(html,/data-manual-growth-stage="inscribed"/);
  assert.match(html,/不增加額外戰力/);
  assert.match(html,/技能仍需符合修士境界才解鎖/);
});

test('stages and aura rings are visible with original stable cover and clickable skill',()=>{
  const html=hero(makeBook(8));
  assert.match(html,/manual-hero--tier-surge/);
  assert.match(html,/data-manual-visual-level="8"/);
  assert.match(html,/manual-hero-qi-ring/);
  assert.match(html,/class="manual-hero-cover" src="\/assets\/books\/sword-wind.png"/);
  assert.match(html,/data-manual-jump-skill="first"/);
  assert.match(html,/data-manual-upgrade="sword-wind"/);
});

test('level threshold alone does not light up skills blocked by player realm',()=>{
  const h=hero(makeBook(10,'sword'));
  assert.match(h,/manual-hero--tier-complete/);
  assert.match(h,/data-manual-skill-visual="realm-locked"/);
  assert.match(h,/修士境界未達/);
  assert.doesNotMatch(h,/三招皆已領悟/);
});

test('actual unlocked skill gains a confirmation mark; locked node remains dim',()=>{
  const b=makeBook(5,'body');
  b.skills[1].realmReady=true;
  b.skills[1].unlocked=true;
  const html=hero(b);
  assert.equal((html.match(/is-learned/g)||[]).length,2);
  assert.match(html,/data-manual-skill-visual="learned"/);
  assert.match(html,/data-manual-skill-visual="level-locked"/);
  assert.match(html,/manual-hero--body/);
});

test('collection badges reflect exactly the same visual stages as the hero',()=>{
  for(const [level,stage] of [[2,'seed'],[5,'inscribed'],[8,'surge'],[10,'complete']]){
    const book=makeBook(level,'body');
    const html=card(book);
    assert.match(html,new RegExp('data-manual-stage="'+stage+'"'));
    assert.match(html,/manual-library-stage-badge/);
    assert.match(html,/manual-book-art/);
    assert.match(html,/manual-library-skill-art/);
  }
});

test('realm locks stay distinct from level locks in gallery preview',()=>{
  const html=card(makeBook(5));
  assert.match(html,/is-realm-locked/);
  assert.match(html,/is-level-locked/);
  assert.match(html,/修士境界不足/);
  assert.match(html,/功法等級未達/);
});

test('visual projection never modifies authoritative input data',()=>{
  const book=makeBook(7);
  const src=JSON.stringify(book);
  const all=state(book);
  const snapshot=JSON.stringify(all);
  hero(book);card(book);
  renderManualVisualMilestones(book,escape);
  assert.equal(JSON.stringify(book),src);
  assert.equal(JSON.stringify(all),snapshot);
  assert.equal(filterOwnedManuals(all).length,1);
});

test('book names and image alt remain escaped',()=>{
  const book=makeBook(8,'sword',{name:'<img src=x onerror=alert(1)>'});
  assert.doesNotMatch(hero(book),/<img src=x onerror=alert/);
  assert.doesNotMatch(card(book),/<img src=x onerror=alert/);
  assert.match(hero(book),/&lt;img src=x/);
  assert.match(card(book),/&lt;img src=x/);
});
