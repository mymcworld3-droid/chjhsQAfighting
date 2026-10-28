'use strict';
const {randomUUID} = require('node:crypto');

const GOALS = Object.freeze({
  'direct-application': '直接運用指定範圍的一個定義、規則或關係，檢驗基本理解。',
  'inverse-reasoning': '給定結果或結論，反向判斷所需的條件、原因或未知量。',
  'error-analysis': '提供一段短小的錯誤判斷或解法，辨認唯一需要修正的關鍵。',
  'scenario-modeling': '把簡短具體情境轉成指定概念的關係，再回答一個明確問題。',
  'data-interpretation': '提供少量完整的純文字資料，判讀唯一能由資料支持的結論。',
  comparison: '比較兩個相近案例的差異或成立條件，辨認唯一正確的比較。',
  'multi-step': '依指定推理步數連接同一核心觀念的步驟，不增加額外前置技能。',
  'concept-transfer': '以另一種表示方式運用相同概念，檢驗理解而非僅替換數字。'
});
const QUESTION_FORMS = Object.freeze(Object.keys(GOALS));
const SIMPLE_FORMS = new Set(['direct-application', 'comparison', 'error-analysis']);
const ANGLES = ['概念成立的條件', '關鍵資訊的取捨', '規則的適用情形', '結果與依據的對應'];

function createQuizTaskPlan({targetForm, forms = QUESTION_FORMS, previousMeta = [], difficulty, mode, batchId = randomUUID()} = {}) {
  const simple = difficulty === 'easy' || mode === 'raid-quick-simple';
  const available = [...new Set(forms)].filter(form => Object.hasOwn(GOALS, form) && (!simple || SIMPLE_FORMS.has(form)));
  if (!available.length) throw Error('沒有符合出題限制的任務題型');
  const recent = new Set(previousMeta.slice(-5).map(item => item.question_form));
  const fresh = available.filter(form => !recent.has(form));
  const preferred = fresh.length ? fresh : available;
  const first = preferred.includes(targetForm) ? targetForm : preferred[0];
  const order = [first, ...preferred.filter(form => form !== first), ...available.filter(form => !preferred.includes(form))];
  const tasks = new Map();
  function get(index) {
    if (!Number.isSafeInteger(index) || index < 0) throw Error('出題任務序號無效');
    if (!tasks.has(index)) tasks.set(index, Object.freeze({
      id: `quiz-task-${batchId}-${index + 1}`, index,
      form: order[index % order.length],
      goal: GOALS[order[index % order.length]],
      angle: ANGLES[Math.floor(index / order.length) % ANGLES.length], simple
    }));
    return tasks.get(index);
  }
  function prompt(base, index) {
    const task = get(index);
    return base + '\n[並行出題任務]\n任務規格 JSON：' + JSON.stringify({
      generation_task_id: task.id, question_form: task.form, goal: task.goal, angle: task.angle
    }) + '\n本 API 只完成這一個任務，輸出一道完整且可獨立作答的單選題。不同任務必須使用不同的作答目標及解題骨架，不能只更換數字、人名或地點。' +
      '\n保持上文指定的科目、年級、單元、知識點與難度；任務分工不得擴張範圍或增加推理步數。' +
      (simple ? '\n本任務只需一步直接判斷或應用；錯誤辨析也只能檢查一個明確步驟，不設陷阱。' : '') +
      '\n回傳 JSON 必須包含與任務規格完全相同的 generation_task_id、question_form；任務編號與分工說明不得出現在題幹、選項或解析。';
  }
  function validate(data, index) {
    const task = get(index);
    if (data?.generation_task_id !== task.id || data?.question_form !== task.form)
      throw Error('AI 回應與分派的出題任務或題型不符');
    if (simple && Number(data.reasoning_steps) > 1) throw Error('入門出題任務不得超過一步推理');
    return true;
  }
  return Object.freeze({get, prompt, validate});
}
module.exports = {QUESTION_FORMS, createQuizTaskPlan};
