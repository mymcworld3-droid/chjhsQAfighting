// 答題紀錄與問道共用安全 LaTeX 轉換：不讓題幹／解析走不同的渲染方式。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QAQuizHistoryView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const rich = (value, format) => (typeof format === 'function' ? format(value ?? '') :
    escape(value ?? '').replace(/\n/g, '<br>'));
  const normalize = (log, time, format) => {
    const opts = Array.isArray(log?.options) ? log.options.slice(0, 8) : [];
    const correctIdx = Number.isInteger(log?.correctIdx) ? log.correctIdx : -1;
    const userIdx = Number.isInteger(log?.userIdx) ? log.userIdx : -1;
    const hasOptions = opts.length > 0;
    const hasExplanation = String(log?.explanation || '').trim().length > 0;
    const hasDetails = hasOptions || hasExplanation;
    const options = opts.map((option, i) => {
      const isAnswer = i === correctIdx, isSelected = i === userIdx;
      const classes = ['history-quiz-option', isAnswer ? 'is-correct' : '',
        isSelected && !isAnswer ? 'is-wrong' : '', isSelected ? 'is-selected' : ''].filter(Boolean).join(' ');
      const label = String.fromCharCode(65 + i);
      const suffix = isAnswer ? '<span class="history-quiz-label">正確答案</span>' :
        isSelected ? '<span class="history-quiz-label">你的答案</span>' : '';
      return '<div class="' + classes + '"><span class="history-quiz-letter" aria-hidden="true">' +
        label + '</span><div class="history-quiz-option-text quiz-rich-option">' +
        rich(option, format) + '</div>' + suffix + '</div>';
    }).join('');
    const details = hasDetails ?
      '<div class="history-quiz-details" hidden>' +
      (hasOptions ? '<div class="history-quiz-options" aria-label="本題選項">' + options + '</div>' :
        '<p class="history-quiz-legacy">舊紀錄未保存本題選項。</p>') +
      '<section class="history-quiz-explanation"><h4>題目解析</h4>' +
      '<div class="history-quiz-rich">' + (hasExplanation ? rich(log.explanation, format) : '此題未保存解析。') +
      '</div></section></div>' :
      '<div class="history-quiz-details" hidden><p class="history-quiz-legacy">早期答題紀錄未保留選項及解析。</p></div>';
    return {
      html: '<div class="history-quiz-topline"><time>' + escape(time || '--') + '</time>' +
        '<span class="history-quiz-outcome ' + (log?.isCorrect ? 'is-correct' : 'is-wrong') + '">' +
        (log?.isCorrect ? '答對' : '答錯') + '</span></div>' +
        '<div class="history-quiz-question">' + rich(log?.question || '（未保留題幹）', format) + '</div>' +
        '<button type="button" class="history-quiz-expand" aria-expanded="false" ' +
        'aria-label="展開題目選項與解析">查看選項與解析 <span aria-hidden="true">⌄</span></button>' +
        details + '<div class="history-quiz-caption">' + escape(log?.rankAtTime || '問道') + '</div>',
      classes: 'history-quiz-entry ' + (log?.isCorrect ? 'history-quiz-right' : 'history-quiz-wrong')
    };
  };
  function toggle(item, expanded) {
    const button = item?.querySelector?.('.history-quiz-expand');
    const details = item?.querySelector?.('.history-quiz-details');
    if (!button || !details) return false;
    const next = typeof expanded === 'boolean' ? expanded : button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(next));
    button.setAttribute('aria-label', next ? '收合題目選項與解析' : '展開題目選項與解析');
    details.hidden = !next;
    return next;
  }
  return Object.freeze({ normalize, toggle });
});
