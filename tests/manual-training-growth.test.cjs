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
    read('manual-anticipation.js'),
    read('manual-skill-detail-view.js'),
    read('manual-hero-view.js'),
    read('manual-library-view.js'),
    '({manualVisualState,manualSkillVisualState,renderManualVisualMilestones,renderManualHero,renderManualCollectionSummary,filterOwnedManuals})'
  ].join('\n'),require('./helpers/resource-ui.cjs'));

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
    [10,'refined','大成'],[19,'refined','大成'],[20,'complete','圓滿'],[300,'complete','圓滿'],[-1,'seed','初息']];
  for(const [level,stage,label] of cases){
    assert.equal(manualVisualState({level}).stage,stage);
    assert.equal(manualVisualState({level}).label,label);
  }
  assert.equal(manualVisualState({level:'not a number'}).stage,'seed');
});

test('only ten route stations and exactly three skill-unlock milestones are shown',()=>{
  const html=renderManualVisualMilestones(makeBook(5),escape);
  assert.equal((html.match(/class="manual-growth-mark /g)||[]).length,10);
  assert.equal((html.match(/is-reached/g)||[]).length,5);
  assert.equal((html.match(/is-current/g)||[]).length,1);
  assert.equal((html.match(/is-milestone-(1|5|10)/g)||[]).length,3);
  assert.match(html,/data-manual-growth-stage="inscribed"/);
  assert.match(html,/role="progressbar"/);
  assert.match(html,/aria-valuenow="49"/);
  assert.match(html,/招式依武器熟練等級解鎖/);
  assert.equal((html.match(/<small>1<\/small>|<small>5<\/small>|<small>10<\/small>/g)||[]).length,3);
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

test('stale server unlocks stay dim without displaying obsolete realm requirements',()=>{
  const h=hero(makeBook(10,'sword'));
  assert.match(h,/manual-hero--tier-refined/);
  assert.match(h,/data-manual-skill-visual="level-locked"/);
  assert.doesNotMatch(h,/修士境界/);
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
  for(const [level,stage] of [[2,'seed'],[5,'inscribed'],[8,'surge'],[10,'refined'],[20,'complete']]){
    const book=makeBook(level,'body');
    const html=card(book);
    assert.match(html,new RegExp('data-manual-stage="'+stage+'"'));
    assert.match(html,/manual-library-brief-state/);
    assert.match(html,/manual-book-art/);
    assert.doesNotMatch(html,/manual-library-skill-art/);
  }
});

test('gallery never repeats skill prerequisites already shown in the featured hero',()=>{
  const item=makeBook(5);
  const html=card(item);
  assert.doesNotMatch(html,/修士境界不足/);
  assert.doesNotMatch(html,/功法等級未達/);
  assert.doesNotMatch(html,/is-realm-locked/);
  const view=hero(item);
  assert.doesNotMatch(view,/is-realm-locked/);
  assert.match(view,/is-level-locked/);
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

test('Lv20 keeps the same original three skill-unlock milestones',()=>{
  const b=makeBook(20,'body',{progress:100,expInLevel:0,expToNext:0});
  const html=hero(b);
  assert.equal((html.match(/class="manual-hero-mastery"/g)||[]).length,1);
  assert.doesNotMatch(html,/功法氣象/);
  assert.doesNotMatch(html,/class="manual-growth"/);
  assert.doesNotMatch(html,/class="manual-hero-track"/);
  assert.doesNotMatch(html,/class="manual-hero-level"/);
  assert.match(html,/<span class="manual-hero-stage-badge">圓滿<\/span>\s*<span class="manual-hero-mastery-status">靈紋完整<\/span>/);
  assert.match(html,/Lv. 20/);
  assert.doesNotMatch(html,/Lv. 20 \/ 20|最高等級/);
  assert.doesNotMatch(html,/功法修至最高等級，靈紋完整/);
  assert.doesNotMatch(html,/class="manual-hero-goal"/);
  assert.doesNotMatch(html,/class="manual-hero-roster"/);
  assert.equal((html.match(/class="manual-growth-mark /g)||[]).length,10);
  assert.equal((html.match(/is-milestone-(1|5|10)/g)||[]).length,3);
  assert.match(html,/style="width:100\.00%"/);
  assert.match(html,/aria-valuenow="100"/);
});

test('the 1–10 skill rail fills at Lv10 and never grows after that',()=>{
  const first=makeBook(1,'sword',{progress:0});
  const one=renderManualVisualMilestones(first,escape);
  const four=renderManualVisualMilestones(makeBook(4,'sword',{progress:50}),escape);
  const ten=renderManualVisualMilestones(makeBook(10,'sword',{progress:0}),escape);
  const twenty=renderManualVisualMilestones(makeBook(20,'sword',{progress:100}),escape);
  const percent=markup=>Number(markup.match(/style="width:([0-9.]+)%"/)?.[1]);
  assert.equal(percent(one),0);
  assert(percent(four)>38 && percent(four)<40);
  assert.equal(percent(ten),100);
  assert.equal(percent(twenty),100);
  const fourteen=renderManualVisualMilestones(makeBook(14,'sword',{progress:22}),escape);
  assert.equal(percent(fourteen),100);
  assert.equal((fourteen.match(/class="manual-growth-mark /g)||[]).length,10);
  assert.match(fourteen,/目前 Lv. 14/);
  assert.doesNotMatch(fourteen,/<small>14<\/small>/);
  assert.match(one,/<small>1<\/small>/);
  assert.match(one,/<small>5<\/small>/);
  assert.match(one,/<small>10<\/small>/);
  assert.doesNotMatch(one,/<small>20<\/small>/);
  assert.equal((one.match(/is-milestone is-reached/g)||[]).length,0);
});

test('unmaxed books show stage badge and exact EXP inside the same card',()=>{
  const html=hero(makeBook(5,'sword',{expInLevel:38,expToNext:120,progress:31.67}));
  assert.match(html,/<span class="manual-hero-stage-badge">凝紋<\/span>/);
  assert.match(html,/38 \/ 120 EXP/);
  assert.doesNotMatch(html,/功法已達最高等級/);
});
