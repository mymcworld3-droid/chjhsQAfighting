'use strict';
// Each daily set covers five domains; the generation contract requires players
// to use supplied context, rather than recall an isolated fact or definition.
const Knowledge=require('./public/cultivation/knowledge-points.js');
const TOTAL=5;
const FORMS=Object.freeze(['scenario-modeling','data-interpretation','inverse-reasoning','error-analysis','concept-transfer']);
const DOMAINS=Object.freeze([
  {subject:'國文',focus:'閱讀理解、資訊取捨與文本推論',context:'提供一段完整的生活短文、公告或對話，依上下文推論、比較觀點或判斷資訊；不可只問成語解釋、字音字形。'},
  {subject:'英文',focus:'生活文本理解與溝通應用',context:'提供符合年級的英文短訊、告示、簡短對話或時刻資訊，依文本判斷溝通意圖或可採取的行動；不可只考單字翻譯或孤立文法。'},
  {subject:'數學',focus:'生活數量關係、資料解讀與決策',context:'提供完整數據、單位及生活限制，先解讀資訊再比較方案或作合理判斷；不可只包裝成故事的直接四則計算。'},
  {subject:'自然',focus:'觀察證據、實驗判讀與科學推論',context:'提供可核對的觀察資料或控制變因情境，依證據推論、比較解釋或判斷實驗設計；不可只問名詞定義。'},
  {subject:'社會',focus:'生活情境、資料判讀與公共議題',context:'提供完整的生活、地理、歷史或公共事務材料，依資訊比較原因、影響或合宜決策；不引用未查證的新政策，不把主觀立場當唯一正解。'}
].map(Object.freeze));
function plan(user){
  const raw=String(user?.profile?.educationLevel||'').trim();
  const level=/^(國小|小學|國中|高中|高職|大學)/.test(raw)?raw.slice(0,32):'國中一年級';
  return DOMAINS.map((domain,index)=>({...domain,level,form:FORMS[index]}));
}
function prompt(expected){
  const domain=DOMAINS.find(x=>x.subject===expected.subject);
  return ['[今日閉關 · 素養題]',`這是每日五題的第 ${expected.index+1} 題。`,domain.context,
    '必須先提供足以作答的生活情境、文本、觀察或純文字資料，題目要求整合至少兩項資訊或依證據推論。刪掉材料後不可仍憑背誦直接作答。',
    '情境必須與推理有關，避免不必要的長文與修仙包裝；依指定年級調整文字、數量與推理負擔，小學低年級使用簡單詞彙與可理解的日常經驗。',
    '需要圖表時改為實際列出完整的純文字資料，不使用外部圖片或 HTML 表格；題幹可分段，數學公式使用 $...$。',
    '四個選項都應與情境相關，唯一正解由提供的材料與已學概念支持。解析明確指出材料中的依據、判斷步驟及關鍵迷思。',
    '在既有題目 JSON 加入 literacy_context（材料摘要，至少 15 字）、literacy_task（玩家需要做的推理或判讀，至少 8 字）；兩者只供驗證，不得替代題幹中的完整材料。'].join('\n');
}
function assertQuestion(parsed,expected){
  if(!DOMAINS.some(x=>x.subject===expected.subject))throw new Error('閉關出題科目無效');
  if(typeof parsed.literacy_context!=='string'||parsed.literacy_context.trim().length<15||
    typeof parsed.literacy_task!=='string'||parsed.literacy_task.trim().length<8||
    !FORMS.includes(parsed.question_form)||Number(parsed.reasoning_steps)<2)
    throw new Error('閉關需包含完整情境、判讀任務與至少兩步推理，不能用記憶題代替素養題');
  const q=String(parsed.q||'').trim(),opts=[parsed.correct,...(Array.isArray(parsed.wrong)?parsed.wrong:[])].map(x=>String(x||'').trim());
  if(q.length<40||!String(parsed.exp||'').trim()||opts.length!==4||opts.some(x=>!x)||new Set(opts.map(x=>x.replace(/\s+/g,'').toLowerCase())).size!==4)
    throw new Error('閉關素養題的材料、解析或四個選項不完整');
  if(parsed.subject&&parsed.subject!==expected.subject)throw new Error('閉關題目與科目不符');
  Knowledge.assertLabel(parsed,expected.subject);
}
module.exports={TOTAL,FORMS,DOMAINS,plan,prompt,assertQuestion};
