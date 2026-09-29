'use strict';

// Generated questions are text only. Reject prompts that depend on an absent
// figure and explanations that explicitly contradict or correct the answer.
function questionQualityIssue({ q, correct, wrong, exp } = {}) {
  const stem = String(q || '');
  const explanation = String(exp || '');
  if (/(?:附圖|下圖|右圖|左圖|如圖所示|圖中所示)/.test(stem)) return '題目引用未提供的圖片';
  if (/[（(][A-D][）)]/.test(stem) && (stem.match(/[（(][A-D][）)]/g) || []).length >= 3) {
    return '題幹重複列出會再被排序的選項';
  }
  if (/(?:題目|數據|資料|條件|選項).{0,20}(?:矛盾|衝突|不一致|有誤)|(?:矛盾|衝突|不一致).{0,20}(?:題目|數據|資料|條件|選項)/.test(explanation)) {
    return '解析指出題目條件互相矛盾';
  }
  if (/(?:修正|更正).{0,16}(?:答案|正解)|(?:答案|正解).{0,12}(?:修正|更正)/.test(explanation)) {
    return '解析自行修正答案';
  }
  const alternatives = Array.isArray(wrong) ? wrong : [];
  for (const option of alternatives) {
    const value = String(option || '').trim();
    if (value.length >= 2 && explanation.includes(value) &&
        new RegExp('(?:正確答案|正解|答案應為|因此選|故選)[^。；\n]{0,20}' + escapeRegExp(value)).test(explanation)) {
      return '解析將錯誤選項稱為正解';
    }
  }
  return '';
}

// The browser shuffles the four answers. AI-authored A/B/C/D references in an
// explanation describe an imagined order and can point at the wrong choice.
function removeUnstableOptionLabels(explanation) {
  return String(explanation || '')
    .replace(/(?:選項|答案)\s*[（(]?[A-D][）)]?/gi, '相關敘述')
    .replace(/[（(][A-D][）)](?=\s*(?:的|是|為|正確|錯誤|與|雖|則|將|過度|強調))/gi, '相關敘述');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { questionQualityIssue, removeUnstableOptionLabels };
