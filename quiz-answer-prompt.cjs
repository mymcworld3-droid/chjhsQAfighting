'use strict';
const Knowledge = require('./public/cultivation/knowledge-points.js');

// One contract for regular practice, trials, and compact combat generation.
const QUESTION_PRESENTATION_RULES = [
  '[題幹不得洩題與符號格式]',
  '題幹不得直接告知正解，也不得只對正解或錯誤所在處加底線、粗體、括號、顏色或其他提示。文法找錯題的待判斷字詞一律不標記，四個選項直接提供原句中的字詞，讓玩家自行判斷。',
  '選項會隨機重排，q、correct、wrong 不得附上作答用 A/B/C/D 標記；解析只用選項內容。不要為一個單字加上 (A) 或用底線暴露錯誤位置。',
  '一般文字直接使用真正的 Unicode 符號（例如 ×、÷、≤、≥、π），不要輸出 HTML entity、字面上的 Unicode 跳脫碼或 Markdown／HTML 底線。',
  '每段 LaTeX 公式各自完整放在 $...$ 中，中文留在公式外；禁止裸露的反斜線指令。JSON 只跳脫一次，解析後不得殘留雙重反斜線；只用 MathJax 基本指令，不用自訂巨集或額外套件。'
].join('\n');
const QUESTION_RELIABILITY_RULES = [
  '[輸出前核對；只輸出題目 JSON，不輸出檢查過程]',
  '優先順序：事實與答案正確、條件完整 > 指定年級與範圍 > 指定難度 > 情境新穎與題型變化。不要為追求變化增加未教的知識或隱藏假設。',
  '1. 條件：明確寫出問什麼、所有必要數據、單位及適用條件；必要的文本或圖表資訊要實際提供，不靠讀者猜。',
  '2. 唯一性：先自行求出答案，再逐一驗證四個選項；correct 必須成立，每個 wrong 必須有明確不成立的理由。兩個都合理、只差表述或可同義替換時整題重寫。',
  '3. 一致性：用回代、單位、量級或原文依據再次核對；保留中間精度，若需近似須先指定取位。正解、解析最後結論與所問的量完全一致。',
  '無法核實事實或排除多解時，改出同範圍、同難度內可核對的題目；不得編造條件、引用或史實，不能只宣稱「已驗證」就當作正確。'
].join('\n');

const SUBJECT_CHECKS = Object.freeze({
  數學:'檢查定義域、分母不為零、正負號、端點與增根；機率須指明抽取方式及是否放回。點到直線距離保留常數項，用完整分子的絕對值除以法向量長度。',
  英文:'核對主謂一致、時態、冠詞、搭配及語境；答案須自然且唯一。找錯題恰有一處錯誤，改正後全句成立；其他選項不可也有合理錯法。',
  國文:'提供足夠上下文；引文、人名、作者及出處必須可靠，不憑字面斷言修辭或作者意圖。語意相近選項須能以文本明確區別。',
  物理:'寫清理想化條件、方向與正負號；量綱一致，分清大小與分量、速率與速度，須用常數時給定數值。',
  化學:'配平原子數與電荷；指明溫度、壓力、濃度、反應是否完全等必要條件，避免把質量、莫耳數與體積混用。',
  生物:'指明物種、組織及生理條件；區分一般情況與例外、相關與因果，不用過度絕對的敘述製造偽正解。',
  歷史:'核對年代、人物、事件先後與地區；分清史實及推論，不編造引文，避免把多重原因寫成唯一原因。',
  地理:'指明地區、季節、半球、尺度與時間條件；圖表題提供實際數據，區分天氣與氣候、總量與比例。',
  公民:'限定制度、地區與必要時點；區分事實與價值判斷，避用未核實的最新法條或政策作唯一正解。',
  地科:'核對時間尺度、方位、位置與觀測條件；指明半球或地點，避免混淆自轉、公轉及視運動。'
});
const RELIABILITY_EXAMPLES = Object.freeze({
  數學:{q:'計算 3 + 4 的值。',correct:'7',wrong:['6','8','9'],exp:'將 3 與 4 相加，得到 7。答案為 7。'},
  英文:{q:'依語境選出最適合的字：After running for an hour, Kevin felt very ___.',correct:'tired',wrong:['tiring','tire','tires'],exp:'此處描述 Kevin 感到疲倦，felt 後用形容詞 tired。答案為 tired。'}
});
function subjectReliabilityPrompt(subject, { examples = true } = {}) {
  const name = Knowledge.subject(subject);
  const check = SUBJECT_CHECKS[name] || '每個判斷都要有可核對的定義、題目數據或文本依據；不確定的冷僻事實不要出題。';
  return '[本科核對]\n' + check + (examples && RELIABILITY_EXAMPLES[name]
    ? '\n[格式示例；只示範一致性，不得抄題或用示例取代指定單元]\n' + JSON.stringify(RELIABILITY_EXAMPLES[name]) : '');
}
const ANSWER_AND_EXPLANATION_RULES = [
  QUESTION_RELIABILITY_RULES,
  QUESTION_PRESENTATION_RULES,
  '[答案與解析核對]',
  '先只依 q 的條件獨立求解，再填 correct，最後設計三個 wrong；不得先決定選項再湊解析。',
  '輸出前重新核算：檢查正負號、常數項、括號、分母、單位及題目問的是什麼，再逐一代入或判斷四個選項。',
  '計算題須用另一種方式回代或估算檢查；點到直線距離須保留常數項，以完整分子絕對值除以法向量長度。',
  '數值等號鏈每一步都要分別重算，多項相加時另行分組加總；開根號前先核對根號內的總和，不能因 correct 與解析寫了同一個錯數就視為通過。',
  '算得的結果、correct 的內容與 exp 的最後結論必須相同；分數約分、小數換算後也須一致，wrong 不得與正解等價。',
  '若結果不在選項內、多解、無解或無法核實，整題重寫 q、correct、wrong、exp，不得猜選項或用解析替錯誤答案辯護。',
  '[精簡解析]',
  '解析應含必要依據，以 2–4 個短句呈現，通常 60–120 個中文字，必要時最多 180 字（不含公式）。',
  '計算題只留「公式或關鍵關係 → 代入計算 → 結論」；觀念題只留判斷依據與結論。',
  '最後一句固定用「答案為〈correct 的完整內容〉。」；只寫選項內容，不寫 A/B/C/D 或選項排序。',
  '不重述題幹、不逐項分析錯誤選項、不展開顯然的算術步驟，不加常見迷思、教學旁白、鼓勵或驗題修訂報告。',
  '驗算在輸出前完成，不把驗算過程或長篇思考寫進 exp；不得為縮短文字而省略必要條件或截斷公式。'
].join('\n');

module.exports = { ANSWER_AND_EXPLANATION_RULES, QUESTION_PRESENTATION_RULES, QUESTION_RELIABILITY_RULES,
  subjectReliabilityPrompt, RELIABILITY_EXAMPLES };
