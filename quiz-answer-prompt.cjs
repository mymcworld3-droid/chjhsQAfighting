'use strict';

// One contract for regular practice, trials, and compact combat generation.
const QUESTION_PRESENTATION_RULES = [
  '[題幹不得洩題與符號格式]',
  '題幹不得直接告知正解，也不得只對正解或錯誤所在處加底線、粗體、括號、顏色或其他提示。文法找錯題的待判斷字詞一律不標記，四個選項直接提供原句中的字詞，讓玩家自行判斷。',
  '選項會隨機重排，q、correct、wrong 不得附上作答用 A/B/C/D 標記；解析只用選項內容。不要為一個單字加上 (A) 或用底線暴露錯誤位置。',
  '一般文字直接使用真正的 Unicode 符號（例如 ×、÷、≤、≥、π），不要輸出 HTML entity、字面上的 Unicode 跳脫碼或 Markdown／HTML 底線。',
  '每段 LaTeX 公式各自完整放在 $...$ 中，中文留在公式外；禁止裸露的反斜線指令。JSON 只跳脫一次，解析後不得殘留雙重反斜線；只用 MathJax 基本指令，不用自訂巨集或額外套件。'
].join('\n');
const ANSWER_AND_EXPLANATION_RULES = [
  QUESTION_PRESENTATION_RULES,
  '[答案與解析核對]',
  '先只依 q 的條件獨立求解，再填 correct，最後設計三個 wrong；不得先決定選項再湊解析。',
  '輸出前重新核算：檢查正負號、常數項、括號、分母、單位及題目問的是什麼，再逐一代入或判斷四個選項。',
  '計算題須用另一種方式回代或估算檢查；點到直線距離須保留常數項，以完整分子絕對值除以法向量長度。',
  '算得的結果、correct 的內容與 exp 的最後結論必須相同；分數約分、小數換算後也須一致，wrong 不得與正解等價。',
  '若結果不在選項內、多解、無解或無法核實，整題重寫 q、correct、wrong、exp，不得猜選項或用解析替錯誤答案辯護。',
  '[精簡解析]',
  '解析應含必要依據，以 2–4 個短句呈現，通常 60–120 個中文字，必要時最多 180 字（不含公式）。',
  '計算題只留「公式或關鍵關係 → 代入計算 → 結論」；觀念題只留判斷依據與結論。',
  '最後一句固定用「答案為〈correct 的完整內容〉。」；只寫選項內容，不寫 A/B/C/D 或選項排序。',
  '不重述題幹、不逐項分析錯誤選項、不展開顯然的算術步驟，不加常見迷思、教學旁白、鼓勵或驗題修訂報告。',
  '驗算在輸出前完成，不把驗算過程或長篇思考寫進 exp；不得為縮短文字而省略必要條件或截斷公式。'
].join('\n');

module.exports = { ANSWER_AND_EXPLANATION_RULES, QUESTION_PRESENTATION_RULES };
