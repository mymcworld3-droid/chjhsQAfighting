'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('public/cultivation/study-question-bridge.js','utf8').replace('export function','function');
function node(){const classes=new Set();return {innerHTML:'原按鈕',textContent:'',onclick:null,children:[],classList:{add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)}};}
test('tower questions stay on the native page and share learning rendering/answers once, including restored free-study state',async()=>{
 const nodes=new Map(['page-quiz','feedback-section','solo-progress-panel','btn-next-step','options-container'].map(id=>[id,node()]));
 nodes.get('options-container').children=[node(),node(),node(),node()];
 const previous={id:'original-free',data:{q:'原本自由問道',opts:['A','B','C','D']},badge:'自由問道'},window={currentActiveQuiz:previous},navigation=[],renders=[],answers=[];
 let owner='u',finished=false,finishAnswer;
 window.switchToPage=(id,options)=>{navigation.push([id,options]);if(id==='page-quiz')nodes.get('page-quiz').classList.add('active-page');};
 const document={getElementById:id=>nodes.get(id)||null,querySelector:()=>({id:'page-home'}),createElement(){throw Error('native question flow must not create a dialog');}};
 const api=vm.runInNewContext(source+'\ncreateStudyQuestionBridge;',{window,document,Date,Promise});
 const bridge=api({userId:()=>owner,rankName:()=> '金丹',render:(...args)=>renders.push(args),answer:(...args)=>{answers.push(args);return new Promise(resolve=>finishAnswer=resolve);},resetWhiteboard(){},resetHelper(){},beginSession:()=>({saved:true}),endSession:(saved,same)=>{finished=saved.saved&&same;}});
 const q={id:'tower-question',q:'塔題',opts:['A','B','C','D'],subject:'物理',level:'高中二年級',topic:'圓周運動',adaptive:{scopeId:'selected-scope',outline:[]},recoveryOrigin:'先前錯題',help:2};
 const callbacks={runId:'run',onAnswer(){},onContinue(){},onSkip(){}};
 bridge.open(q,callbacks);assert.equal(navigation[0][0],'page-quiz');assert.equal(navigation[0][1].preserveTrialTower,true);
 assert.equal(window.currentActiveQuiz.adaptive.scopeId,'selected-scope');assert.equal(window.currentActiveQuiz.recoveryOrigin,'先前錯題');assert.equal(window.currentActiveQuiz.adaptiveHelp,2);assert.equal(renders.length,1);
 bridge.open(q,callbacks);assert.equal(renders.length,1);assert.equal(navigation.length,1);
 const review={questionId:q.id,selectedChoice:1,correctIndex:0,explanation:'解析'};
 bridge.review(review,callbacks.onContinue);bridge.review(review,callbacks.onContinue);assert.equal(answers.length,1);assert.equal(nodes.get('btn-next-step').onclick,callbacks.onContinue);
 finishAnswer();await bridge.waitForAnswer();bridge.end();assert.equal(window.currentActiveQuiz,previous);assert.equal(finished,true);assert.equal(navigation.at(-1)[0],'page-home');
 assert.equal(nodes.get('btn-next-step').innerHTML,'原按鈕');
});
