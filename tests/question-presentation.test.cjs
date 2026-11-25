'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {stemMarkup,optionMarkup}=require('../public/cultivation/question-presentation.js');
test('literal text is escaped and line breaks are preserved',()=>{
  assert.equal(stemMarkup('金幣 < 3 & A\n下一行'),'金幣 &lt; 3 &amp; A<br>下一行');
});
test('existing formatter receives original input unchanged',()=>{
  const value='$x<3$';let got;
  assert.equal(stemMarkup(value,v=>{got=v;return '<math>formula</math>';}),'<math>formula</math>');
  assert.equal(got,value);
});
test('four ordered options disclose no answer state by default',()=>{
  for(let i=0;i<4;i++){
    const value=['甲','乙','丙','丁'][i],html=optionMarkup(value,i);
    assert.ok(html.includes('data-qy-option-letter>'+String.fromCharCode(65+i)+'</span>'));
    assert.ok(html.includes('data-qy-option-content>'+value+'</span>'));
    assert.ok(!html.includes('✓')&&!html.includes('data-answer'));
  }
});
test('explicit review marker and legacy option content type work',()=>{
  const html=optionMarkup('乙',1,{correctMark:true,contentClass:'dt-option-math',contentTag:'b'});
  assert.ok(html.includes('dt-option-math'));assert.ok(html.includes('乙 ✓</b>'));
  assert.ok(optionMarkup('<script>',2).includes('&lt;script&gt;'));
});
test('image and table markup from guarded renderer are retained',()=>{
  for(const html of ['<div><img src="/assets/banks/a.webp"></div>','<div class="overflow-x-auto"><table><tr><td>1</td></tr></table></div>']){
    assert.ok(optionMarkup('圖表',0,{rich:()=>html}).includes(html));
  }
});

const feedback = require('../public/cultivation/question-presentation.js');
test('review state is explicit and deferred results remain neutral',()=>{
  assert.equal(feedback.optionState(0,{answered:true,reveal:true,correctIndex:0,selectedIndex:1}),'correct');
  assert.equal(feedback.optionState(1,{answered:true,reveal:true,correctIndex:0,selectedIndex:1}),'wrong');
  assert.equal(feedback.optionState(0,{answered:true,reveal:false,correctIndex:0,selectedIndex:1}),'');
  assert.equal(feedback.optionState(1,{answered:true,reveal:false,correctIndex:0,selectedIndex:1}),'selected');
  assert.equal(feedback.optionState(0,{answered:false,reveal:true,correctIndex:0}),'');
  assert.doesNotMatch(feedback.feedbackMarkup({state:'answered',explanation:'secret'}),/secret|data-qy-explanation/);
  assert.match(feedback.feedbackMarkup({state:'correct',explanation:'<script>'}),/&lt;script&gt;/);
});
test('metrics preserve denominators and never invent zero-question accuracy',()=>{
  assert.equal(feedback.scoreText(2,3),'2 / 3');
  assert.equal(feedback.accuracyText(2,3),'67%');
  assert.equal(feedback.accuracyText(0,0),'—');
  assert.equal(feedback.accuracyText(4,3),'—');
  assert.equal(feedback.progressMarkup(0,0),'');
  assert.match(feedback.progressMarkup(1,2),/aria-valuenow="1"/);
  assert.match(feedback.progressMarkup(1,2),/width:50%/);
});

test('phase 13 status is explicit, accessible and escaped',()=>{
  assert.match(feedback.learningStatusMarkup('preparing','<script>'),/data-qy-learning-status="preparing".*&lt;script&gt;/);
  assert.match(feedback.learningStatusMarkup('unknown'),/data-qy-learning-status="neutral"/);
  const attrs=new Map(),node={setAttribute:(k,v)=>attrs.set(k,v),hasAttribute:k=>attrs.has(k)};
  feedback.setLearningStatus(node,'reviewing','核對中');
  assert.equal(node.textContent,'核對中');assert.equal(attrs.get('role'),'status');
  feedback.setLearningStatus(node,'error','重試');assert.equal(attrs.get('data-qy-learning-status'),'error');
  assert.equal(feedback.reportState('confirmed'),'confirmed');assert.equal(feedback.reportState('rejected'),'rejected');assert.equal(feedback.reportState('unknown'),'incomplete');
});
test('phase 13 disclosure is native and collapsed',()=>{
  const doc={createElement:tag=>({tag,children:[],setAttribute(k,v){this[k]=v;},appendChild(n){this.children.push(n);}})};
  const {panel,summary}=feedback.createDisclosure(doc,{id:'lesson',kind:'lesson',title:'<script>'});
  assert.equal(panel.tag,'details');assert.equal(panel.open,false);assert.equal(panel['data-qy-disclosure'],'lesson');assert.equal(summary.tag,'summary');assert.equal(summary.textContent,'<script>');assert.equal(panel.children[0],summary);
});
