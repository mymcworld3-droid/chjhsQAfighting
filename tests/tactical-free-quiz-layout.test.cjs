'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'public/cultivation/tactical-combat.js'),'utf8');
const styles=fs.readFileSync(path.join(root,'public/styles/tactical-question-pair.css'),'utf8');
const mainHtml=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const mainCss=fs.readFileSync(path.join(root,'public/styles/quiz-scroll.css'),'utf8');
const mainJs=fs.readFileSync(path.join(root,'public/main-legacy.js'),'utf8');
const cut=(from,to)=>{
  const start=source.indexOf(from),end=source.indexOf(to,start);
  assert.ok(start>=0&&end>start,'source anchors must exist: '+from);
  return source.slice(start,end);
};
const sample=id=>({id,q:'第 '+id+' 題：下面哪個答案正確？',opts:['甲','乙','丙','丁'],subject:'國文',topic:'字義'});
const display=x=>String(x);
const sheet=new Function('rich','esc','pairChoices','state',
  cut('function questionSheet(','function setQuizContext(')+'return questionSheet;'
)(display,display,[-1,-1],{mode:'pve'});
const layout=new Function('quizTools','questionSheet','pairQuestions','state',
  cut('function pairWhiteboardMarkup(){','async function submitPair(){')+'return pairLayout;'
)(()=>'<section class="tc-question-tools"></section>',sheet,[sample('1'),sample('2')],{quizRound:0});

test('each stamina question repeats the actual free-question card, four answer rows and three footer controls',()=>{
  const stem=sheet(sample('1'),null,0);
  const common=['glass-panel p-6 rounded-2xl mb-4 border-l-4','quiz-card-tools absolute top-3 right-3',
    'text-6xl text-cyan-500/10 absolute -top-2 -left-2',
    'text-lg font-bold leading-relaxed relative z-10 text-white',
    'w-full text-left p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition border',
    'quiz-footer-actions'];
  for(const fragment of common){
    assert.ok(mainHtml.includes(fragment)||mainJs.includes(fragment),'main quiz lacks canonical fragment '+fragment);
    assert.ok(stem.includes(fragment),'stamina quiz has drifted from main quiz: '+fragment);
  }
  assert.equal((stem.match(/data-choice-for="0"/g)||[]).length,4);
  assert.equal((stem.match(/class="flex-1 py-3 text-gray-600 text-xs text-center/g)||[]).length,3);
  assert.match(stem,/quiz-whiteboard-toggle/);
});

test('two full size question sheets show at once, stacked, with one submit operation',()=>{
  const rendered=layout(null,[sample('1'),sample('2')]);
  assert.equal((rendered.match(/class="tc-pair-entry"/g)||[]).length,2);
  assert.equal((rendered.match(/data-submit-pair/g)||[]).length,1);
  assert.match(rendered,/一次送出兩題/);
  assert.match(rendered,/quiz-main-column tc-pair-column/);
  assert.match(rendered,/quiz-question-helper-layout helper-collapsed/);
  assert.match(styles,/\.tc-pair-list\{display:flex;flex-direction:column/);
  assert.doesNotMatch(styles,/grid-template-columns:repeat\(2/);
});

test('stamina sheet uses full available width without the main page 820px cap, retaining whiteboard and option sizing',()=>{
  assert.match(mainCss,/max-width:\s*820px/); // Legacy main page remains unchanged.
  assert.match(styles,/grid-template-columns:minmax\(0,1fr\)/);
  assert.match(styles,/width:100%!important;\s*max-width:none!important;/);
  assert.doesNotMatch(styles,/width:min\(820px,100%\)/);
  assert.match(mainCss,/min-height:\s*68px/);
  assert.match(styles,/min-height:68px/);
  assert.match(mainCss,/padding:\s*16px 20px/);
  assert.match(styles,/padding:16px 20px/);
  assert.match(styles,/padding:60px 32px 30px/);
  assert.match(source,/function redrawPairWhiteboard\(\)/);
  assert.match(layout(null,[sample('1'),sample('2')]),/data-pair-whiteboard-canvas/);
});

test('review reproduces the main feedback structure without changing either question',()=>{
  const reviewed=sheet(sample('1'),{
    q:sample('1').q,opts:sample('1').opts,answerIndex:0,choice:1,
    correct:false,gain:1,explanation:'依據條件可得甲'
  },0);
  assert.match(reviewed,/bg-slate-950\/50 p-4 rounded-lg/);
  assert.match(mainHtml,/bg-slate-950\/50 p-4 rounded-lg/);
  assert.match(reviewed,/題解參悟/);
  assert.match(reviewed,/bg-green-600/);
  assert.match(reviewed,/bg-red-600/);
  assert.match(styles,/\.tc-feedback-section\.glass-panel/);
});

test('the existing free-quiz cultivation animation is visible above the battle overlay',()=>{
  assert.match(source,/beginSoloCultivationFeedback/);
  assert.match(styles,/body\.tactical-open #solo-cultivation-feedback/);
  assert.match(styles,/z-index:25000/);
});


test('every form of question-stem text and rendered math uses pure black without recoloring answer options',()=>{
  assert.match(styles,/\.tc-question-sheet \.tc-question,\s*#tactical-combat \.tc-quiz \.tc-question-sheet \.tc-question \*\{\s*color:#000!important;/);
  assert.match(styles,/-webkit-text-fill-color:#000!important/);
  assert.match(styles,/mjx-container\[jax="SVG"\] svg/);
  assert.match(styles,/\.katex svg/);
  assert.match(styles,/svg :is\(text,tspan\)/);
  assert.match(styles,/\.tc-options > button\{/);
  assert.match(styles,/color:#eee8d5!important/);
});
