'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../public/cultivation/manual-skill-detail-view.js'),'utf8');
const resource=fs.readFileSync(path.join(__dirname,'../public/cultivation/spirit-stone-ui.js'),'utf8');
const stoneCostMarkup=vm.runInNewContext(resource.replace(/^export /gm,'')+'\nstoneCostMarkup');
const render=vm.runInNewContext(src.replace(/^import .*;\n/gm,'').replace('export function renderManualSkillDetail','function renderManualSkillDetail')+
  '\nrenderManualSkillDetail',{stoneCostMarkup});
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[c]);
const book={id:'sword-wind',name:'流風劍訣',owned:true,skills:[
  {id:'a',name:'流風斬',cost:2,range:3,unlocked:true,level:1,
    mastered:true,realmReady:true,realmName:'煉氣',
    upgrade:{gold:20,targetLevel:2},kind:'attack'},
  {id:'b',name:'突進橫斬',cost:4,range:4,unlocked:false,level:1,
    mastered:false,realmReady:false,levelRequired:5,realmName:'築基'}
]};
const opts={
  esc,skillArt:skill=>'/skills/'+skill.id+'.png',
  descriptionWithDamage:(damage,skill)=>skill.name+' 傷害 '+damage,
  attack:230,gold:100,equipped:[],moveIdOf:id=>id
};
test('details are absent until a deliberate technique selection',()=>{
  assert.equal(render(book,null,opts),'');
  assert.equal(render(book,'missing',opts),'');
  assert.equal(render({...book,owned:false},'a',opts),'');
});
test('one learned skill displays description and server-confirmed action buttons',()=>{
  const html=render(book,'a',opts);
  assert.match(html,/data-manual-skill="a"/);
  assert.match(html,/data-manual-equip="a"/);
  assert.match(html,/data-skill-upgrade="a"/);
  assert.match(html,/data-manual-close-skill/);
  assert.match(html,/流風斬 傷害 230/);
  assert.match(html,/Lv. 2/);
  assert.ok(html.includes(stoneCostMarkup(20)));
});
test('already equipped technique does not offer duplicate equip operation',()=>{
  const html=render(book,'a',{...opts,equipped:['a']});
  assert.match(html,/此配置已裝備/);
  assert.match(html,/data-manual-equip="a" disabled/);
});
test('full deck cannot exceed three techniques',()=>{
  const html=render(book,'a',{...opts,equipped:['x','y','z']});
  assert.match(html,/配置已滿/);
  assert.match(html,/data-manual-equip="a" disabled/);
});
test('insufficient currency disables upgrade but does not invent resources',()=>{
  const html=render(book,'a',{...opts,gold:4});
  assert.match(html,/<button[^>]*data-skill-upgrade="a"[^>]* disabled/);
  assert.match(html,/靈石不足/);
});
test('mastery locked skills have no action buttons or cultivation gate',()=>{
  const html=render(book,'b',opts);
  assert.match(html,/功法 Lv. 5/);
  assert.doesNotMatch(html,/修士|築基境/);
  assert.doesNotMatch(html,/data-manual-equip=/);
  assert.doesNotMatch(html,/data-skill-upgrade=/);
});
test('malicious skill fields cannot be interpolated as HTML',()=>{
  const b={...book,skills:[{...book.skills[0],name:'<img src=x onerror=alert(1)>',realmName:'<svg onload=alert(2)>'}]};
  const html=render(b,'a',{...opts,descriptionWithDamage:()=>'<script>hello</script>'});
  assert.doesNotMatch(html,/<img src=x onerror/);
  assert.doesNotMatch(html,/<svg onload/);
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&lt;img src=x/);
  assert.doesNotMatch(html,/svg onload/);
});
