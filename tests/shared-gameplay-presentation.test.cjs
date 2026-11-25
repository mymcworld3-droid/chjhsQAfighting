'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {QABattlePresentation:B,QAWeaponPresentation:W,QACommunityPresentation:C,QAQuestionEditorPresentation:E}=require('./helpers/presentations.cjs');
const Questions=require('../public/cultivation/question-presentation.js');
const Rewards=require('../public/cultivation/daily-meditation-rewards.js');

test('DOM and canvas health share bounded values without mutating the actor',()=>{
  for(const [hp,max,expected] of [[75,100,75],[-5,100,0],[120,100,100],[10,0,0],[Infinity,100,0]]){
    const actor={name:'靈獸',hp,maxHp:max,bot:true},before={...actor},calls=[];
    const ctx={fillStyle:'',fillRect(...args){calls.push(args);}};
    const h=B.drawHealth(ctx,actor,0,0,100,4);
    assert.equal(h.percent,expected);assert.equal(calls[1][2],expected);
    assert.match(B.healthMarkup(actor),new RegExp('aria-valuenow="'+h.current+'"'));
    assert.deepEqual(actor,before);
  }
  assert.match(B.healthMarkup({name:'<img>',hp:1,maxHp:2}),/&lt;img&gt;/);
  assert.equal(B.health({hp:1250,maxHp:2000}).text,'1,250 / 2,000');
});
test('combat feedback distinguishes damage, critical, shield, healing and stamina with words and signs',()=>{
  assert.deepEqual(B.eventLines({damage:1250,critical:true,heal:12,gain:0}).map(x=>x.text),['暴擊 −1,250','+12 生命','體力 +0']);
  assert.deepEqual(B.eventLines({absorbed:20,shield:5}).map(x=>x.text),['護盾 −20','護盾 +5']);
  assert.equal(B.eventLines({text:'擊退 · 準備已打斷'})[0].text,'擊退 · 準備已打斷');
  const result=B.resultMetrics({correct:2,answered:3,hp:50,maxHp:100},Questions);
  assert.match(result,/2 \/ 3/);assert.match(result,/67%/);assert.match(result,/生命 50 \/ 100/);
  assert.match(B.resultMetrics({hp:0,maxHp:100},Questions),/—/);
});
test('all six weapons use the same fixed art in identity, mastery and earned-reward cards',()=>{
  for(const id of ['sword-wind','sword-flight','sword-sky','body-rock','body-dragon','body-tiger']){
    assert(fs.existsSync('public'+W.art(id)));
    const book={id,name:'<武器>',school:id.startsWith('body')?'body':'sword',tierRealm:'築基',level:5,expInLevel:20,expToNext:80};
    assert(W.identityMarkup(book,{slot:1}).includes(W.art(id)));
    assert.equal(Rewards.entries({weapon:{...book,quantity:1}})[0].image,W.art(id));
    assert.match(W.identityMarkup(book),/&lt;武器&gt;/);assert.match(W.identityMarkup(book,{slot:1}),/武器二/);
    assert.match(W.masteryMarkup(book),/aria-valuenow="25"/);
  }
  assert.equal(W.art('x\" onerror=alert(1)'), '');
});
test('unknown mastery is not presented as a measured zero and capped mastery is always complete',()=>{
  assert.equal(W.mastery({level:4}).percent,null);
  assert.match(W.masteryMarkup({level:4}),/aria-valuetext="熟練度尚未同步"/);
  assert.doesNotMatch(W.masteryMarkup({level:4}),/aria-valuenow/);
  assert.equal(W.mastery({level:20}).percent,100);
  assert.equal(W.mastery({level:5,expInLevel:900,expToNext:100}).percent,100);
  assert.equal(W.mastery({level:5,expInLevel:-10,expToNext:100}).percent,0);
  assert.match(W.realmMarkup('築基',{kind:'character'}),/data-qy-realm-kind="character"/);
  assert.match(W.realmMarkup('結丹',{kind:'difficulty'}),/data-qy-realm-kind="difficulty"/);
  assert.deepEqual([W.difficultyState({locked:true}).key,W.difficultyState({clears:1}).key,W.difficultyState({resume:true}).key,W.difficultyState().key],['locked','complete','active','ready']);
});
test('social views escape player data and never treat chat text as markup',()=>{
  assert.doesNotMatch(C.identityMarkup({name:'<img src=x onerror=1>'}),/<img/);
  assert.match(C.invitationHeader('道友'),/待處理/);
  assert.match(C.statusMarkup('submitted'),/已繳交/);
  const stamp={},attrs={},node={setAttribute:(k,v)=>attrs[k]=v,querySelector:()=>stamp};
  C.decorateMessage(node,{mine:true,time:1000});assert.equal(attrs['data-qy-message'],'self');assert.equal(stamp.dateTime,'1970-01-01T00:00:01.000Z');
  assert.doesNotThrow(()=>C.decorateMessage(node,{time:Number.MAX_VALUE}));
  assert.match(C.metricMarkup('正確率',null),/—/);
  assert.equal(C.messageTime(Number.MAX_VALUE),'');
  assert.equal(C.messageTime(null),'');
  assert.match(C.messageTime(Date.UTC(2026,10,25,5,2)),/01:02/);
});
test('weapon skill details preserve context values, escape text and keep copy counts tied to the account',()=>{
  const skill={id:'test',name:'<招式>',cost:3,range:4,unlocked:true,level:2};
  const html=W.skillMarkup(skill,{description:'造成 <200%> 傷害',cost:1});
  assert.match(html,/1 體力 · 4 格/);assert.match(html,/Lv. 2/);
  assert.match(html,/&lt;招式&gt;/);assert.match(html,/&lt;200%&gt;/);
  assert.equal(skill.cost,3);
  assert.equal(W.copiesText({weaponCopies:{築基:2,結丹:1}}),'築基 × 2 · 結丹 × 1');
  assert.equal(W.copiesText({}),'');
});
test('both teacher editors share escaped fields and previews while preserving their field contracts',()=>{
  const q={question:'<script>bad</script>',options:['甲','乙','丙','丁'],answerIndex:2,explanation:'<svg onload=1>'},before=structuredClone(q);
  const a=E.fields(q,1),b=E.fields(q,1,{questionName:'q-',explanationName:'exp-'});
  assert.match(a,/name="question-1"/);assert.match(b,/name="q-1"/);assert.match(b,/name="exp-1"/);
  for(const html of [a,b]){
    assert.match(html,/name="option-1-3"/);assert.match(html,/value="2" selected/);
    assert.match(html,/data-qy-editor-preview/);assert.doesNotMatch(html,/<script>|<svg/);
  }
  assert.deepEqual(q,before);assert.doesNotMatch(E.preview({...q,answerIndex:null}),/✓ 正確答案/);
});
test('weapon celebration shares the persisted receipt guard with reward animation and rejects stale accounts',()=>{
  const source=fs.readFileSync(require.resolve('../public/cultivation/daily-meditation-rewards.js'),'utf8'),storage=new Map();
  const load=()=>{
    const ctx={QAWeaponPresentation:W,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}};
    vm.runInNewContext(source,ctx);return ctx.QARewardPresentation;
  };
  const options={uid:'one',receiptId:'weapon:sword-wind:5',sound:false,isCurrent:()=>true};
  assert.equal(load().celebrateEvent({...options,isCurrent:()=>false}),false);
  assert.equal(load().celebrateEvent(options),true);assert.equal(load().celebrateEvent(options),false);
  assert.equal(load().celebrateEvent({...options,uid:'two'}),true);
  assert.equal(load().celebrateEvent({...options,receiptId:'weapon:sword-wind:6'}),true);
});
