'use strict';
// Each daily set covers five domains; the generation contract requires players
// to use supplied context, rather than recall an isolated fact or definition.
const Knowledge=require('./public/cultivation/knowledge-points.js');
const TOTAL=5;
// Scenarios/news/articles supply circumstances; the assessment target is a
// curriculum concept applied to those circumstances, never passage retrieval.
const APPLICATION_RULES=Object.freeze([
  '素養題的「新聞、時事、文章或資料」只能是情境／證據；真正考核的是運用指定年級已學學科知識解決新問題，不是閱讀理解測驗。',
  '出題順序：先選定一個具體課內概念，再設計與其有關的社會新聞、短文、事件、數據或實驗，最後要求應用、比較、計算、判斷因果或評估方案。',
  '禁止只問文章主旨、作者態度、哪件事曾被提及、哪個句子正確、誰在何時做了什麼，或只須抄出一段原文就能選答案的題目。',
  '檢查：如果學生完全不懂本科所選概念，只靠逐句搜尋或改寫材料便能回答，必須重出；若拿掉材料仍能只靠背誦回答，也必須重出。',
  '時事應連結課內概念；未經查證的最新法令、政治人物、事件日期、數字或新聞出處不可當作事實／唯一判斷依據。虛構情境明確寫「假設」，所需數據全提供。',
  '長文不是素養的必要條件。材料只保留解題所需資訊，不以閱讀篇幅或隱晦措辭增加難度。'
]);
const FORMS=Object.freeze(['scenario-modeling','data-interpretation','inverse-reasoning','error-analysis','concept-transfer']);
const DOMAINS=Object.freeze([
  {subject:'國文',focus:'語言運用、修辭論證與真實溝通判斷',context:'以新聞評論、公告、短文或社群貼文為材料，要求運用語用、修辭、論證、文體或寫作知識，選出最恰當的改寫、反駁或表達方式；不能只問文意、主旨或作者立場。'},
  {subject:'英文',focus:'語言知識的情境溝通與表達應用',context:'以英文信件、公告、新聞摘要或真實溝通需求為背景，要求實際選用正確文法、搭配詞、語氣或得體回覆；不能只問短文提到什麼、主旨或單純找字句。'},
  {subject:'數學',focus:'時事情境中的建模、數量關係與決策',context:'以生活報導、費率政策、統計或工程情境提供完整數據、單位及限制，要求建立與運用課內數學模型、比較解法或驗證方案；不能只問文中的數字是多少。'},
  {subject:'自然',focus:'新聞與科學資料中的原理解釋及實驗判斷',context:'提供能源、環境、生態或科學實驗情境及可核對數據，要求運用已學科學原理分析機制、控制變因或評估解釋；不能只從文章摘錄實驗結果。'},
  {subject:'社會',focus:'時事與史地公民概念的跨情境應用',context:'用新聞式公共事件、歷史資料、地理區域或政策案例為情境，要求運用明確的歷史因果、區域條件或公民法律經濟概念分析；不得只考文章主旨或單純資訊擷取，不引用未查證的現行規定，不將價值立場當唯一正解。'}
].map(Object.freeze));
function plan(user){
  const raw=String(user?.profile?.educationLevel||'').trim();
  const level=/^(國小|小學|國中|高中|高職|大學)/.test(raw)?raw.slice(0,32):'國中一年級';
  return DOMAINS.map((domain,index)=>({...domain,level,form:FORMS[index]}));
}
function prompt(expected){
  const domain=DOMAINS.find(x=>x.subject===expected.subject);
  return ['[今日閉關 · 素養題]',`這是每日五題的第 ${expected.index+1} 題。`,domain.context,...APPLICATION_RULES,
    '必須先提供足以作答的生活情境、文本、觀察或純文字資料，題目要求整合至少兩項資訊或依證據推論。刪掉材料後不可仍憑背誦直接作答。',
    '情境必須與推理有關，避免不必要的長文與修仙包裝；依指定年級調整文字、數量與推理負擔，小學低年級使用簡單詞彙與可理解的日常經驗。',
    '需要圖表時改為實際列出完整的純文字資料，不使用外部圖片或 HTML 表格；題幹可分段，數學公式使用 $...$。',
    '四個選項都應與情境相關，唯一正解由提供的材料與已學概念支持。解析明確指出材料中的依據、判斷步驟及關鍵迷思。',
    '在既有題目 JSON 加入 literacy_context（材料摘要，至少 15 字）、literacy_concept（實際運用的本科課內觀念，至少 4 字，不可只填閱讀理解或文章主旨）、literacy_task（說明如何運用該觀念分析材料，至少 8 字）；三者只供驗證，不得替代題幹中的完整材料。'].join('\n');
}
function assertQuestion(parsed,expected){
  if(!DOMAINS.some(x=>x.subject===expected.subject))throw new Error('閉關出題科目無效');
  if(typeof parsed.literacy_concept!=='string'||parsed.literacy_concept.trim().length<4||
    /^(?:閱讀理解|文章主旨|作者態度|資訊擷取|單純閱讀|文意判讀|找出原文)$/.test(parsed.literacy_concept.trim()))
    throw new Error('閉關素養題必須指定實際運用的課內觀念，不可僅考閱讀理解');
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
module.exports={TOTAL,FORMS,DOMAINS,APPLICATION_RULES,plan,prompt,assertQuestion};
