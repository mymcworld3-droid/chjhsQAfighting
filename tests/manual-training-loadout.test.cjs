'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../public/cultivation/manual-loadout-view.js'),'utf8');
const {selectSkillForSlot,renderManualLoadout}=vm.runInNewContext(
  source.replace('export function selectSkillForSlot','function selectSkillForSlot')
    .replace('export function renderManualLoadout','function renderManualLoadout')+
    '\n({selectSkillForSlot,renderManualLoadout})',{},
  {filename:'manual-loadout-view.js'}
);
const moves={a:'slash',b:'punch',c:'thrust',a2:'slash',unknown:null};
const moveOf=id=>moves[id]||null;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
const tools={esc,skillArt:skill=>'/assets/skills/'+skill.id+'.png',moveIdOf:moveOf};
const book=(name,school,skills,owned=true)=>({
  id:name,name,school,owned,
  skills:skills.map(([id,skillName,unlocked=true])=>({
    id,name:skillName,unlocked,level:2,cost:2,manualId:name,school
  }))
});
const library=[
  book('流風劍訣','sword',[['a','流風斬'],['a2','共用斬'],['c','劍突進',false]]),
  book('拳法','body',[['b','直拳']]),
  book('尚未得到','body',[['unknown','不能出現']],false)
];
const state=(overrides={})=>({
  school:'sword',activeLoadout:0,library,
  loadouts:[
    {name:'配置一',skillIds:['a','b']},
    {name:'突進測試',skillIds:['a2']},
    {name:'第三組',skillIds:[]}
  ],...overrides
});
const ui=(selected=0,picker=null,st=state())=>renderManualLoadout(st,selected,picker,tools);

test('add a new skill into a slot and replace existing slot without mutating source',()=>{
  const original=['a','b'];
  assert.deepEqual(Array.from(selectSkillForSlot(original,2,'c',moveOf)),['a','b','c']);
  assert.deepEqual(Array.from(selectSkillForSlot(original,1,'c',moveOf)),['a','c']);
  assert.deepEqual(original,['a','b']);
});

test('swapping an equipped skill keeps its identity and avoids duplicates',()=>{
  assert.deepEqual(Array.from(selectSkillForSlot(['a','b'],1,'a',moveOf)),['b','a']);
  assert.deepEqual(Array.from(selectSkillForSlot(['a','b'],0,'b',moveOf)),['b','a']);
  assert.deepEqual(Array.from(selectSkillForSlot(['a','b'],2,'a2',moveOf)),['b','a2']);
  assert.deepEqual(Array.from(selectSkillForSlot(['a','b'],0,'a2',moveOf)),['a2','b']);
});

test('invalid slot, unknown move and a full array cannot create invalid equipment',()=>{
  assert.equal(selectSkillForSlot(['a'],3,'b',moveOf),null);
  assert.equal(selectSkillForSlot(['a'],0,'unknown',moveOf),null);
  assert.equal(selectSkillForSlot(['a'],NaN,'b',moveOf),null);
  assert.equal(selectSkillForSlot(['a','b','c'],4,'a',moveOf),null);
  assert.deepEqual(Array.from(selectSkillForSlot(['a','b','c'],2,'a',moveOf)),['c','b','a']);
});

test('three preset tabs reflect selected vs active without applying merely by viewing',()=>{
  const view=ui(1);
  assert.match(view,/data-loadout-select="0"/);
  assert.match(view,/data-loadout-select="1"/);
  assert.match(view,/data-loadout-select="2"/);
  assert.match(view,/正在編輯未使用的配置/);
  assert.match(view,/data-loadout-apply/);
  assert.doesNotMatch(view,/data-loadout-apply disabled/);
  assert.match(view,/value="突進測試"/);
  assert.match(view,/maxlength="20"/);
  const live=ui(0);
  assert.match(live,/目前使用中/);
  assert.match(live,/data-loadout-apply disabled/);
});

test('picker only shows owned unlocked techniques and exactly three slots',()=>{
  const view=ui(0,2);
  assert.equal((view.match(/data-manual-pick-slot="/g)||[]).length,3);
  assert.equal((view.match(/data-manual-pick-skill="/g)||[]).length,3);
  assert.match(view,/data-manual-remove="a"/);
  assert.match(view,/data-manual-remove="b"/);
  assert.doesNotMatch(view,/data-manual-remove="c"/);
  assert.doesNotMatch(view,/尚未得到/);
  assert.doesNotMatch(view,/劍突進/);
  assert.match(view,/交換位置/);
  assert.match(view,/manual-picker-grid/);
  assert.match(view,/data-manual-close-picker/);
  assert.match(view,/manual-slot-art/);
});

test('empty slot is an action; picker is hidden until requested',()=>{
  const view=ui(2);
  assert.match(view,/空白技能槽/);
  assert.match(view,/點此選擇已領悟的招式/);
  assert.doesNotMatch(view,/data-manual-pick-skill/);
  assert.doesNotMatch(view,/data-manual-picker/);
});

test('empty library handles lack of selectable skills without broken markup',()=>{
  const view=ui(2,0,state({library:[]}));
  assert.match(view,/目前沒有可裝備的招式/);
  assert.doesNotMatch(view,/data-manual-pick-skill=/);
});

test('server-provided player names and skill names remain escaped',()=>{
  const malicious=state({
    loadouts:[{name:'<svg/onload=alert(1)>',skillIds:['a']},...state().loadouts.slice(1)],
    library:[book('<script>alert(2)</script>','sword',[['a','<img src=x onerror=alert(3)>']])]
  });
  const view=ui(0,0,malicious);
  assert.doesNotMatch(view,/<svg\/onload=/);
  assert.doesNotMatch(view,/<script>alert\(2\)<\/script>/);
  assert.doesNotMatch(view,/<img src=x onerror=/);
  assert.match(view,/&lt;svg/);
  assert.match(view,/&lt;img/);
});
