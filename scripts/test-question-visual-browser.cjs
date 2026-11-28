'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),E=require('../public/cultivation/question-visual-engine.js');
const enc=s=>'[[QYVISUAL:'+JSON.stringify(s)+':QYVISUAL]]';
const graph=enc({type:'plot',x:[-2,2],y:[0,4],layers:[{type:'function',expr:['^','x',2]}]});
const table=enc({type:'table',headers:['x','y'],rows:[[1,1],[2,4]]});
(async()=>{const browser=await chromium.launch({headless:true});try{
for(const viewport of [{width:390,height:844},{width:844,height:390},{width:768,height:1024}]){
 const page=await browser.newPage({viewport});
 await page.setContent('<main id="quiz-container"><div id="question-text"></div><div id="options-container"><button id="pick" type="button"><span>選項 A</span></button></div></main>');
 await page.addStyleTag({path:path.join(root,'public/styles/question-presentation.css')});
 await page.addScriptTag({path:path.join(root,'public/cultivation/question-visual-engine.js')});
 await page.addScriptTag({path:path.join(root,'public/cultivation/question-visual-ui.js')});
 await page.evaluate(({graph,table})=>{window.count=0;const E=window.QAQuestionVisualEngine;
 document.getElementById('question-text').innerHTML=E.renderInline('題幹'+graph+table);
 document.getElementById('pick').innerHTML='<span id="letter">選項 A</span>'+E.renderInline(graph);
 document.getElementById('pick').onclick=()=>window.count++;
 },{graph,table});
 assert.equal(await page.locator('svg[role="img"]').count(),2);
 await page.locator('#pick [data-qy-zoom]').click();await page.locator('dialog[open]').waitFor();
 assert.equal(await page.evaluate(()=>window.count),0);
 await page.getByRole('button',{name:'＋',exact:true}).click();
 const width=await page.locator('.qy-visual-dialog-copy').evaluate(n=>n.getBoundingClientRect().width);
 const available=await page.locator('.qy-visual-dialog-body').evaluate(n=>n.clientWidth);
 assert(width>available);
 await page.getByRole('button',{name:'關閉',exact:true}).click();
 await page.locator('#letter').click();assert.equal(await page.evaluate(()=>window.count),1);
 await page.evaluate(g=>document.getElementById('question-text').innerHTML=window.QAQuestionVisualEngine.renderInline(g.slice(0,-5)),graph);
 await page.locator('#letter').click();assert.equal(await page.evaluate(()=>window.count),1);assert(await page.locator('#qy-visual-block-notice').isVisible());
 await page.close();
}
console.log('question visual browser: phone portrait, landscape, tablet passed');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
