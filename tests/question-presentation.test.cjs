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
