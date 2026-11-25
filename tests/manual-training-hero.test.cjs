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

test('show level, XP, next mastery milestone and three original skills',()=>{
  const view=draw([makeBook()]);
  assert.match(view.html,/Lv. 4/);
  assert.match(view.html,/72 \/ 100 EXP/);
  assert.doesNotMatch(view.html,/class="manual-hero-goal"/);
  assert.doesNotMatch(view.html,/class="manual-anticipation"/);
  assert.match(view.html,/功法 Lv. 5/);
  assert.equal((view.html.match(/data-manual-jump-skill=/g)||[]).length,3);
  assert.doesNotMatch(view.html,/金丹境|修士境界/);
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
  assert.match(view.html,/靈紋完整/);
  assert.doesNotMatch(view.html,/最高等級/);
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
    upgrade:null,tierRealm:'元嬰'
  });
  const mid=draw([book]);
  assert.match(mid.html,/Lv. 10/);
  assert.doesNotMatch(mid.html,/Lv. 10 \/ 20|升至 Lv. 11|data-manual-upgrade/);
  assert.match(mid.html,/Lv.10 後需以武器技能擊殺靈獸累積 EXP/);
  assert.match(mid.html,/元嬰功法/);
  assert.match(mid.html,/manual-hero-tier-badge is-tier-nascent/);
  assert.match(mid.html,/本功法攻擊 \+10/);
  assert.doesNotMatch(mid.html,/功法已達最高等級/);
  const end=draw([makeBook('body-rock',{level:20,upgrade:null,progress:100})]);
  assert.match(end.html,/Lv. 20/);
  assert.doesNotMatch(end.html,/Lv. 20 \/ 20|最高等級/);
  assert.match(end.html,/靈紋完整/);
});

test('attack total from server and owned book tier are displayed without fabricating higher rank',()=>{
  const book=makeBook('body-rock',{level:8,tierRealm:'築基'});
  const view=draw([book],book.id,{attackBonus:28});
  assert.match(view.html,/築基功法/);
  assert.match(view.html,/本功法攻擊 \+8/);
  assert.match(view.html,/已獲功法合計 \+28/);
});

test('Lv14 shows one uncluttered level, and never offers paid upgrading or extra nodes',()=>{
  const html=draw([makeBook('body-rock',{
    level:14,expInLevel:30,expToNext:320,progress:10,upgrade:null
  })]).html;
  assert.match(html,/class="manual-hero-mastery-level">Lv. 14<\/span>/);
  assert.doesNotMatch(html,/Lv. 14 \/ 20|最高等級|data-manual-upgrade/);
  assert.equal((html.match(/class="manual-growth-mark /g)||[]).length,10);
  assert.equal((html.match(/is-milestone-(1|5|10)/g)||[]).length,3);
  assert.match(html,/style="width:100\.00%"/);
  assert.match(html,/Lv.10 後需以武器技能擊殺靈獸累積 EXP/);
});

test('weapon mastery and skill details share one exclusive slot below skills',()=>{
  const book=makeBook();
  book.skills[0].upgrade={targetLevel:2,gold:20};
  const state={library:[book],school:'body',gold:100,weaponIds:[book.id]};
  const drawSkill=id=>render(state,book.id,{...helpers,selectedSkillId:id,moveIdOf:x=>x}).html;
  const initial=drawSkill(null);
  assert.match(initial,/data-manual-detail-mode="mastery"><div class="manual-hero-details">/);
  assert(initial.indexOf('manual-hero-path-grid')<initial.indexOf('修煉熟練度'));
  assert.equal((initial.match(/修煉熟練度/g)||[]).length,1);
  assert.doesNotMatch(initial,/class="manual-focus-skill /);
  assert.match(initial,/data-manual-upgrade="body-rock"/);
  assert.doesNotMatch(initial,/aria-expanded="true"/);
  const skill=drawSkill('first');
  assert.match(skill,/data-manual-detail-mode="skill"><section class="manual-focus-skill /);
  assert.doesNotMatch(skill,/修煉熟練度|data-manual-upgrade=/);
  assert.match(skill,/data-skill-upgrade="first"/);
  assert.match(skill,/data-manual-close-skill/);
  assert.match(skill,/data-manual-jump-skill="first" aria-expanded="true"/);
  const locked=drawSkill('second');
  assert.match(locked,/data-manual-detail-mode="skill"/);
  assert.match(locked,/data-manual-skill="second"/);
  assert.doesNotMatch(locked,/修煉熟練度|data-skill-upgrade=/);
  assert.equal(drawSkill(null),initial);
  assert.equal(drawSkill('stale-id'),initial);
});
