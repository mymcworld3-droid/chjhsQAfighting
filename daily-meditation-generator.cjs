'use strict';
const Literacy=require('./daily-meditation-literacy.cjs');
const {quickQuizPrompt}=require('./fast-quiz-prompt.cjs');
const {questionQualityIssue,removeUnstableOptionLabels}=require('./question-quality.cjs');
function validate(parsed,expected,previous=[]){
  Literacy.assertQuestion(parsed,expected);
  if(!Number.isFinite(Number(parsed.reasoning_steps)))throw Error('每日閉關缺少推理步數');
  if(previous.includes(parsed.q))throw Error('每日閉關題目重複');
  const issue=questionQualityIssue(parsed);
  if(issue)throw Error('每日閉關題目未通過品質檢查：'+issue);
}
function createGenerator(router){
  return async function generateQuestion(expected,previous=[]){
    let failure;
    for(let attempt=0;attempt<3;attempt++)try{
      const prompt=quickQuizPrompt({mode:'meditation-literacy',subject:expected.subject,level:expected.level,
        topic:expected.focus,rank:0,difficulty:'medium',previousQuestions:previous,targetForm:expected.form,
        quality:{cognitive:2,steps:2},randomSeed:expected.date+':'+expected.index+':'+attempt})+'\n'+Literacy.prompt(expected)+
        '\n全服各年級使用同一組今日題目。以題幹已提供的生活材料為依據，避免需要高年級專門先備知識。';
      const routed=await router.generateJSON(prompt,{task:'quiz-generate',parallel:false,timeoutMs:90000,
        validate:parsed=>validate(parsed,expected,previous)});
      const parsed={...routed.data,exp:removeUnstableOptionLabels(routed.data.exp)};
      validate(parsed,expected,previous);
      const reviewPrompt=[
        '你是獨立題目審核員。不要相信參考標示答案，先依題幹所問的極性獨立解題並逐項判定。',
        '確認生活材料完整、至少兩步判讀、四個選項恰一個符合所問、事實和運算與單位正確、解析結論一致。',
        'validIndices 列出所有符合題目所問的 0-based 選項索引。歧義、多解、無解或證據不足一律 approved=false。',
        '只有獨立核對後 validIndices 恰為 [0]、解析無誤才可 approved=true。不可用自評信心代替證據。',
        '題目資料：'+JSON.stringify({q:parsed.q,options:[parsed.correct,...parsed.wrong],exp:parsed.exp,subject:expected.subject}),
        '只回傳 JSON：{"approved":false,"validIndices":[],"reason":"具體理由"}'
      ].join('\n');
      const reviewed=await router.generateJSON(reviewPrompt,{task:'quiz-review',parallel:false,timeoutMs:90000,
        excludeModels:routed.model?[routed.model]:[],validate:data=>{
          if(typeof data?.approved!=='boolean'||typeof data.reason!=='string'||!Array.isArray(data.validIndices)||
            data.validIndices.some(x=>!Number.isInteger(x)||x<0||x>3)||new Set(data.validIndices).size!==data.validIndices.length)throw Error('閉關審核格式錯誤');
        }});
      if(reviewed.data.approved!==true||reviewed.data.validIndices.length!==1||reviewed.data.validIndices[0]!==0)
        throw Error('閉關獨立審核未通過');
      return parsed;
    }catch(error){failure=error;}
    throw failure;
  };
}
module.exports={createGenerator,validate,generateQuestion:(...args)=>createGenerator(require('./ai-router'))(...args)};
