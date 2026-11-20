// Presentation-only learning analysis. Raw answers and answer keys are never passed here.
export function summarizeLearningAnalysis(rows = []) {
  const newest = [...new Map(rows.map(row => [row.id, row])).values()];
  const chronological = [...newest].reverse();
  const topics = new Map();
  let marked = 0, totalQuestions = 0, submissions = 0, scoreSum = 0, scoreCount = 0;
  for (let i = 0; i < chronological.length; i++) {
    const a = chronological[i];
    marked += Number(a.markedQuestions || 0);
    totalQuestions += Number(a.questionCount || 0);
    if (a.submitted != null) {
      submissions += a.submitted;
      if (a.average != null && a.submitted) { scoreSum += a.average * a.submitted; scoreCount += a.submitted; }
    } else if (a.workStatus === 'submitted' && Number.isFinite(a.score)) {
      submissions++;
      scoreSum += a.score; scoreCount++;
    }
    for (const p of a.knowledgePoints || []) {
      const key = p.subject + '/' + p.id;
      let stat = topics.get(key);
      if (!stat) {
        stat = { id: p.id, name: p.name, subject: p.subject, correct: 0, total: 0,
          assignmentCount: 0, questionCount: 0, earlier: { correct: 0, total: 0 },
          later: { correct: 0, total: 0 } };
        topics.set(key, stat);
      }
      stat.correct += p.correct || 0;
      stat.total += p.total || 0;
      stat.questionCount += p.questionCount || 0;
      if (p.total > 0) stat.assignmentCount++;
      const period = i < Math.floor(chronological.length / 2) ? stat.earlier : stat.later;
      period.correct += p.correct || 0;
      period.total += p.total || 0;
    }
  }
  const allTopics = [...topics.values()].sort((a, b) =>
    (a.total ? a.correct / a.total : 1) - (b.total ? b.correct / b.total : 1) ||
    b.total - a.total || a.name.localeCompare(b.name, 'zh-Hant'));
  return {
    assignments: newest, topics: allTopics,
    weak: allTopics.filter(p => p.total >= 5 && p.assignmentCount >= 2 && p.correct / p.total < .7),
    assignmentCount: newest.length, totalQuestions, markedQuestions: marked, submissions,
    firstAverage: scoreCount ? Math.round(scoreSum / scoreCount * 100) / 100 : null
  };
}
export function renderLearningAnalysis(state, helpers) {
  const { escape: esc, button, date, status } = helpers;
  const analysis = state.learning || { rows: [], nextCursor: null };
  const rows = analysis.rows || [];
  const student = analysis.student;
  const subject = state.learningSubject || 'all';
  const filtered = rows.filter(row => subject === 'all' || row.subject === subject);
  const model = summarizeLearningAnalysis(filtered);
  const subjects = ['all', ...new Set(rows.map(row => row.subject))];
  const percent = (correct, total) => total ? Math.round(correct / total * 100) : null;
  const ratio = (correct, total) => {
    const value = percent(correct, total);
    return value === null ? '無已繳交樣本' : value + '%（' + correct + '／' + total + ' 次首次作答）';
  };
  const escapedAttr = (name, value) => ' data-' + name + '="' + esc(value) + '"';
  const bars = model.assignments.slice(0, 12).reverse().map(row => {
    const done = row.submitted != null ? row.submitted : row.workStatus === 'submitted' ? 1 : 0;
    const max = row.studentCount ?? 1;
    const value = row.average != null ? row.average : row.score;
    const correction = student && row.workStatus === 'submitted'
      ? ' · 已訂正 ' + row.correctedCount + '／' + row.wrongCount + ' 道錯題' : '';
    return '<div class="cc-learning-trend-row"><div class="cc-learning-trend-caption"><strong>' +
      esc(row.title) + '</strong><small>' + esc(row.subject) + ' · ' +
      (student ? status(row.workStatus) : '已繳交 ' + done + '／' + max) + correction + '</small></div>' +
      '<div class="cc-learning-trend-main"><div class="cc-learning-track" role="progressbar" ' +
      'aria-label="' + esc(row.title + '首次作答平均') + '" aria-valuemin="0" aria-valuemax="100" ' +
      (value == null ? 'aria-valuetext="尚無已繳交樣本"' :
        'aria-valuenow="' + Math.max(0, Math.min(100, value)) + '"') + '>' +
      (value == null ? '' : '<span style="width:' + Math.max(0, Math.min(100, value)) + '%"></span>') +
      '</div><small>' + (value == null ? '—' : value + ' 分') + '</small></div></div>';
  }).join('');
  const topicCards = model.topics.filter(p => p.total > 0).slice(0, 30).map(p => {
    const old = percent(p.earlier.correct, p.earlier.total),
      recent = percent(p.later.correct, p.later.total);
    const comparable = old !== null && recent !== null && p.earlier.total >= 3 &&
      p.later.total >= 3 && model.assignmentCount >= 2;
    return '<article class="cc-card cc-learning-topic"><div class="cc-learning-topic-header">' +
      '<div><span class="cc-muted">' + esc(p.subject) + '</span><h4>' + esc(p.name) + '</h4></div>' +
      '<strong>' + percent(p.correct, p.total) + '%</strong></div>' +
      '<p class="cc-muted">' + p.correct + '／' + p.total + ' 次首次作答正確 · ' +
      p.assignmentCount + ' 份作業 · ' + p.questionCount + ' 道標記題目</p>' +
      (comparable ? '<p class="cc-muted">前半已載入作業 ' + old + '% → 後半 ' + recent +
        '%（不同作業難度可能不同）</p>' : '') +
      (state.classroom?.status === 'active'
        ? button('learning-remediate', student ? '建立班級補強草稿' : '建立補強草稿',
          escapedAttr('subject', p.subject) + escapedAttr('point-id', p.id) + escapedAttr('topic', p.name))
        : '') + '</article>';
  }).join('');
  const weakSummary = model.weak.length ?
    '<section class="cc-learning-section"><div class="cc-section-title"><h3>建議優先複習</h3></div>' +
    '<p class="cc-muted">僅列出至少 2 份作業、5 次首次作答，且正確率低於 70% 的已標記知識點；僅作教學線索。' +
    (student ? '由此建立的仍是班級作業草稿，不會自動單獨派給該學生。' : '') + '</p>' +
    '<div class="cc-learning-weak">' + model.weak.slice(0, 5).map(p =>
      '<div class="cc-learning-weak-row"><strong>' + esc(p.name) +
      '</strong><span>' + ratio(p.correct, p.total) + '</span>' +
      (state.classroom?.status === 'active' ? button('learning-remediate',
        student ? '建立班級補強草稿' : '建立補強草稿',
        escapedAttr('subject', p.subject) + escapedAttr('point-id', p.id) + escapedAttr('topic', p.name)) : '') +
      '</div>').join('') + '</div></section>' : '';
  const subjectsHtml = '<div class="cc-learning-filters" aria-label="學習分析科目篩選">' +
    subjects.map(s => button('learning-subject', s === 'all' ? '全部科目' : esc(s),
      escapedAttr('subject', s) + ' aria-pressed="' + (subject === s) + '"')).join('') + '</div>';
  const tabs = '<div class="cc-learning-kpis">' + [
    ['已分析作業', model.assignmentCount + ' 份'],
    ['已繳交紀錄', model.submissions + ' 筆'],
    ['首次成績平均', model.firstAverage == null ? '—' : model.firstAverage + ' 分'],
    ['知識點標記', model.markedQuestions + '／' + model.totalQuestions + ' 題']
  ].map(([name, value]) => '<div class="cc-metric"><span>' + name + '</span><strong>' + value + '</strong></div>').join('') + '</div>';
  const history = '<section class="cc-learning-section"><div class="cc-section-title"><h3>作業歷程</h3></div>' +
    '<p class="cc-muted">依派題先後顯示最近 12 份已載入作業。長條為首次作答平均分數，並非能力測量。</p>' +
    (bars ? '<div class="cc-card cc-learning-trends">' + bars + '</div>' : '<p class="cc-empty">目前尚無可顯示的作業。</p>') + '</section>';
  const topicsBlock = '<section class="cc-learning-section"><div class="cc-section-title"><h3>知識點分析</h3></div>' +
    '<p class="cc-muted">只統計已繳交作業中有標記知識點的題目；未標記題目不納入觀念統計。</p>' +
    (topicCards ? '<div class="cc-learning-topic-grid">' + topicCards + '</div>' :
      '<p class="cc-empty">已載入作業尚無可計算的知識點樣本。請先在作業題目標記知識點。</p>') + '</section>';
  const studentExtra = student ? '<p class="cc-muted">個人紀錄只由教師按需查看，學生在未交卷時不會出現在得分平均分母。</p>' : '';
  const page = analysis.nextCursor
    ? '<div class="cc-learning-load">' + button('learning-more',
      '載入更早作業（' + (student ? '最多 8 份' : '最多 4 份') + '／批）', 'class="cc-primary"') + '</div>'
    : '<p class="cc-muted cc-learning-finished">已檢查目前可用的全部歷史作業。</p>';
  return '<div class="cc-learning-view"><header class="cc-toolbar"><div>' +
    '<h3>' + (student ? '個人學習檔案 · ' + esc(student.name) : '長期成績與學習分析') + '</h3>' +
    '<p class="cc-muted">' + esc(analysis.className || state.classroom?.name || '') +
    (student ? ' · ' + esc(student.seat || '未填座號') : '') + '</p></div>' +
    '<div class="cc-actions">' + button('learning-back', '返回' + (state.learningReturnTab === 'students' ? '學生名單' : '成績分頁')) +
    button('learning-refresh', '重新統計') +
    (!student ? button('learning-students', '查看個別學生') : '') + '</div></header>' +
    '<p class="cc-muted cc-learning-note">已載入 ' + rows.length + ' 份已發布或已結束作業，從最近的 ' +
    (analysis.scanned || 0) + ' 份記錄位置讀取。' +
    ' 統計對象：' + (student ? '這位學生' : '目前在班的 ' + (analysis.studentCount ?? 0) + ' 位學生') + '。' +
    (analysis.nextCursor ? ' 尚有較早作業，以下數字不是全歷史總計。' : '') + '</p>' +
    studentExtra + subjectsHtml + tabs + weakSummary + history + topicsBlock + page + '</div>';
}
