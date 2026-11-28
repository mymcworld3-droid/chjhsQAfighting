'use strict';
// Opt-in real-provider diagnostic. No database writes, player accounts, or forced visual ratio.
if(process.env.QA_VISUAL_LIVE!=='1'){
  console.error('Opt in with QA_VISUAL_LIVE=1; this uses configured AI provider quota.');
  process.exit(2);
}
try{require('dotenv').config({quiet:true})}catch{}
const AI=require('../ai-router.js');
const {quickQuizPrompt}=require('../fast-quiz-prompt.cjs');
const {VISUAL_PROMPT,VISUAL_REVIEW}=require('../question-visual-prompt.cjs');
const {questionQualityIssue}=require('../question-quality.cjs');
const Knowledge=require('../public/cultivation/knowledge-points.js');
const E=require('../public/cultivation/question-visual-engine.js');
const subjects=[
 ['數學','二次函數'],['物理','速度與時間關係'],['化學','反應速率'],
 ['生物','生態系與族群'],['地科','天氣觀測'],['地理','氣候與人口'],
 ['歷史','史事時間順序'],['公民','市場供需'],['國文','閱讀與資訊判讀'],['英文','閱讀與資訊判讀']
];
async function main(){
 if(!AI.getStatus().length){console.error('No configured AI provider.');process.exitCode=2;return;}
 const results=[];
 for(const [subject,topic] of subjects){
   try{
     const prompt=quickQuizPrompt({mode:'battle-fast',subject,level:'高中二年級',topic,difficulty:'medium'})+'\n'+VISUAL_PROMPT;
     const g=await AI.generateJSON(prompt,{task:'quiz-generate',parallel:false,timeoutMs:90000,validate:q=>{
       if(typeof q?.q!=='string'||typeof q.correct!=='string'||!Array.isArray(q.wrong)||q.wrong.length!==3||!q.wrong.every(x=>typeof x==='string')||typeof q.exp!=='string')throw Error('invalid question shape');
       Knowledge.assertLabel(q,subject);
       const issue=questionQualityIssue(q);if(issue)throw Error(issue);
     }});
     const q=g.data, fields=[q.q,q.correct,...q.wrong,q.exp];
     const visuals=fields.reduce((n,f)=>n+E.inspectInline(f).count,0);
     const review=await AI.generateJSON([VISUAL_REVIEW,'獨立依題幹作答，核對範圍、唯一正解與解析。只有唯一正解為索引0且解析成立才可 approved=true。',JSON.stringify({subject,topic,q:q.q,options:[q.correct,...q.wrong],exp:q.exp}),'只輸出 JSON {"approved":false,"validIndices":[],"reason":"理由"}'].join('\n'),{task:'quiz-review',excludeModels:g.model?[g.model]:[],parallel:false,timeoutMs:90000,validate:r=>{
       if(typeof r?.approved!=='boolean'||!Array.isArray(r.validIndices)||typeof r.reason!=='string')throw Error('invalid review');
     }});
     const approved=review.data.approved===true&&review.data.validIndices.length===1&&review.data.validIndices[0]===0;
     results.push({subject,visuals,approved,distinctModel:g.model!==review.model});
   }catch(error){results.push({subject,approved:false,errorCode:error.code||'validation-or-provider-error'});}
 }
 console.log(JSON.stringify({results,visualQuestions:results.filter(r=>r.approved&&r.visuals>0).length},null,2));
 if(results.some(r=>!r.approved))process.exitCode=1;
 // A plain-text result is legitimate. Zero visual coverage means the live visual path is not yet demonstrated.
 if(!results.some(r=>r.approved&&r.visuals>0)){console.error('No approved visual question sampled; live visual generation remains unverified.');process.exitCode=1;}
}
main().catch(()=>{console.error('Live diagnostic did not complete.');process.exitCode=1;});
