'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/manual-hero-view.js'),'utf8');
const strip=s=>s.replace(/^import\s+.*;\s*$/gm,'')
  .replaceAll('export function ','function ');
const auxiliary=['manual-visual-progression.js','manual-anticipation.js','manual-skill-detail-view.js']
  .map(name=>strip(fs.readFileSync(path.join(__dirname,'../public/cultivation',name),'utf8')));
const render=vm.runInNewContext([...auxiliary,strip(source),'renderManualHero'].join('\n'),
  {}, {filename:'manual-hero-view.js'});
const esc=value=>String(value).replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
const helpers={
  esc,
  label:school=>school==='sword'?'劍修':'體修',
  bookArt:id=>'/assets/books/'+id+'.png',
  skillArt:skill=>'/assets/skills/'+skill.id+'.png'
};
const threeSkills=()=>[
  {id:'first',name:'直拳',level:1,levelRequired:1,cost:2,mastered:true,realmReady:true,unlocked:true,realmName:'煉氣'},
  {id:'second',name:'突進震拳',level:1,levelRequired:5,cost:3,mastered:false,realmReady:true,unlocked:false,realmName:'築基'},
  {id:'third',name:'崩山拳',level:1,levelRequired:10,cost:3,mastered:false,realmReady:false,unlocked:false,realmName:'金丹'}
];
const makeBook=(id='body-rock',overrides={})=>({
  id,name:'玄嶽鍛體訣',school:'body',owned:true,level:4,progress:72,
  expInLevel:72,expToNext:100,skills:threeSkills(),
  upgrade:{targetLevel:5,gold:56},...overrides
});
const draw=(library,selectedBookId='',overrides={})=>
  render({library,school:'body',gold:100,...overrides},selectedBookId,helpers);

test('empty view still offers two school choices and a first-manual explanation',()=>{
  const view=draw([]);
  assert.equal(view.bookId,'');
  assert.match(view.html,/data-manual-school="sword"/);
  assert.match(view.html,/data-manual-school="body"/);
  assert.match(view.html,/免費習得/);
});

test('show only owned manuals, preferring the currently selected school',()=>{
  const sword=makeBook('sword-wind',{name:'流風劍訣',school:'sword'});
  const body=makeBook();
  const hidden=makeBook('body-secret',{name:'尚未得到的功法',owned:false});
  const view=draw([sword,hidden,body]);
  assert.equal(view.bookId,'body-rock');
  assert.doesNotMatch(view.html,/尚未得到的功法/);
  assert.doesNotMatch(view.html,/data-feature-book=/);
  assert.match(view.html,/玄嶽鍛體訣/);
  const switched=draw([sword,body],'sword-wind');
  assert.equal(switched.bookId,'sword-wind');
  assert.match(switched.html,/流風劍訣/);
  assert.doesNotMatch(switched.html,/manual-hero-roster/);
});

test('show level, XP, next milestone, realm requirements and three original skills',()=>{
  const view=draw([makeBook()]);
  assert.match(view.html,/Lv. 4/);
  assert.match(view.html,/72 \/ 100 EXP/);
  assert.doesNotMatch(view.html,/class="manual-hero-goal"/);
  assert.doesNotMatch(view.html,/class="manual-anticipation"/);
  assert.match(view.html,/功法 Lv. 5/);
  assert.equal((view.html.match(/data-manual-jump-skill=/g)||[]).length,3);
  assert.match(view.html,/金丹境/);
  assert.match(view.html,/data-manual-upgrade="body-rock"/);
});

test('upgrade always uses the server price and disables on insufficient gold',()=>{
  const view=draw([makeBook()],undefined,{gold:5});
  assert.match(view.html,/56 靈石/);
  assert.match(view.html,/disabled title="靈石不足"/);
});

test('max-level and fully unlocked books show completion without a fabricated upgrade',()=>{
  const skills=threeSkills().map(skill=>({...skill,unlocked:true,mastered:true,realmReady:true}));
  const view=draw([makeBook('body-rock',{
    level:20,progress:100,expInLevel:0,expToNext:0,skills,upgrade:null
  })]);
  assert.match(view.html,/功法已達最高等級/);
  assert.doesNotMatch(view.html,/class="manual-hero-goal"/);
  assert.match(view.html,/aria-valuenow="100"/);
  assert.doesNotMatch(view.html,/data-manual-upgrade=/);
});

test('untrusted book and skill display strings are escaped',()=>{
  const book=makeBook('body-rock',{
    name:'<img src=x onerror=alert(1)>',
    skills:threeSkills().map((skill,i)=>i?skill:{...skill,name:'<b>假技能</b>'})
  });
  const view=draw([book]);
  assert.doesNotMatch(view.html,/<img src=x onerror=alert\(1\)>/);
  assert.match(view.html,/&lt;img src=x/);
  assert.match(view.html,/&lt;b&gt;假技能&lt;\/b&gt;/);
});

test('clicking one skill reveals a single authoritative detail with equipment and upgrade',()=>{
  const book=makeBook('body-rock');
  book.skills[0].upgrade={targetLevel:2,gold:20};
  const view=render({library:[book],school:'body',gold:50},'body-rock',{
    ...helpers,selectedSkillId:'first',equipped:[],
    moveIdOf:id=>id,
    descriptionWithDamage:(_,skill)=>skill.name+' 的傷害說明'
  });
  assert.match(view.html,/data-manual-skill="first"/);
  assert.match(view.html,/data-manual-equip="first"/);
  assert.match(view.html,/data-skill-upgrade="first"/);
  assert.match(view.html,/data-manual-close-skill/);
  assert.match(view.html,/aria-expanded="true"/);
  assert.match(view.html,/直拳 的傷害說明/);
  assert.equal((view.html.match(/class="manual-focus-skill /g)||[]).length,1);
  const closed=draw([book]).html;
  assert.doesNotMatch(closed,/data-manual-equip="first"/);
  assert.doesNotMatch(closed,/data-skill-upgrade="first"/);
});

test('a locked technique remains inspectable without an equipment or upgrade button',()=>{
  const book=makeBook();
  const view=render({library:[book],school:'body',gold:500},book.id,{
    ...helpers,selectedSkillId:'second',moveIdOf:id=>id,
    descriptionWithDamage:()=> '招式說明'
  });
  assert.match(view.html,/data-manual-skill="second"/);
  assert.match(view.html,/尚需 功法 Lv. 5/);
  assert.doesNotMatch(view.html,/data-manual-equip="second"/);
  assert.doesNotMatch(view.html,/data-skill-upgrade="second"/);
});

test('Lv10 is a third-technique milestone, not max level; Lv20 is the new cap',()=>{
  const book=makeBook('body-rock',{
    level:10,progress:35,expInLevel:84,expToNext:220,
    upgrade:{targetLevel:11,targetExp:1300,gold:272},tierRealm:'元嬰'
  });
  const mid=draw([book]);
  assert.match(mid.html,/Lv. 10 \/ 20/);
  assert.match(mid.html,/升至 Lv. 11/);
  assert.match(mid.html,/元嬰功法/);
  assert.match(mid.html,/本功法攻擊 \+10/);
  assert.doesNotMatch(mid.html,/功法已達最高等級/);
  const end=draw([makeBook('body-rock',{level:20,upgrade:null,progress:100})]);
  assert.match(end.html,/Lv. 20 \/ 20/);
  assert.match(end.html,/功法已達最高等級/);
});

test('attack total from server and owned book tier are displayed without fabricating higher rank',()=>{
  const book=makeBook('body-rock',{level:8,tierRealm:'築基'});
  const view=draw([book],book.id,{attackBonus:28});
  assert.match(view.html,/築基功法/);
  assert.match(view.html,/本功法攻擊 \+8/);
  assert.match(view.html,/已獲功法合計 \+28/);
});
