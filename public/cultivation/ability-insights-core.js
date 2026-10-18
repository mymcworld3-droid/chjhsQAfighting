// 客觀能力診斷：確保統計分數與生成式 AI 的角色分開。
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./knowledge-points.js') : root.QAKnowledgePoints);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QAAbilityInsights = api;
})(typeof globalThis === 'object' ? globalThis : this, function (Knowledge) {
  'use strict';
  const DOMAINS = Knowledge.SUBJECTS;
  const FORMS = Object.freeze([
    ['direct-application', '基本應用'], ['inverse-reasoning', '逆向推理'],
    ['error-analysis', '錯誤辨識'], ['scenario-modeling', '情境建模'],
    ['data-interpretation', '資料判讀'], ['comparison', '比較辨析'],
    ['multi-step', '多步推理'], ['concept-transfer', '概念遷移']
  ]);
  const finiteCount = n => Number.isFinite(Number(n)) ? Math.min(10000000, Math.max(0, Math.floor(Number(n)))) : 0;
  const cleanLabel = value => String(value ?? '').trim().slice(0, 55);
  const isoDay = value => {
    const stamp = value?.toDate?.() || (typeof value?.seconds === 'number' ? new Date(value.seconds * 1000) : new Date(value));
    return stamp instanceof Date && Number.isFinite(stamp.getTime()) ? stamp.getTime() : 0;
  };
  const posterior = (correct, total) => {
    if (!total) return null;
    // Beta(2,2) regularization avoids presenting 1/1 as 100% mastery.
    const alpha = correct + 2, beta = total - correct + 2;
    return Math.round(100 * alpha / (alpha + beta));
  };
  const margin = (correct, total) => {
    if (!total) return null;
    const a = correct + 2, b = total - correct + 2;
    const variance = a * b / ((a + b) ** 2 * (a + b + 1));
    return Math.round(196 * Math.sqrt(variance)); // 1.96 * 100 * posterior SD
  };
  function row(subject, topic, input) {
    const total = finiteCount(input?.total), correct = Math.min(total, finiteCount(input?.correct));
    const estimate = posterior(correct, total);
    const spread = margin(correct, total);
    const quality = total >= 20 ? '較高' : total >= 8 ? '中等' : '不足';
    let status = '尚未練習';
    if (total > 0 && total < 5) status = '需要更多題';
    else if (total >= 5 && estimate < 60) status = '優先補強';
    else if (total >= 5 && estimate < 78) status = '持續鞏固';
    else if (total >= 5 && estimate >= 78) status = '表現穩定';
    return { subject, topic, total, correct, rawAccuracy: total ? Math.round(100 * correct / total) : null,
      estimate, uncertainty: spread, confidence: quality, status };
  }
  function sum(rows) {
    const total = rows.reduce((n, r) => n + r.total, 0);
    const correct = rows.reduce((n, r) => n + r.correct, 0);
    return { total, correct, estimate: posterior(correct, total),
      rawAccuracy: total ? Math.round(correct / total * 100) : null,
      uncertainty: margin(correct, total), confidence: total >= 20 ? '較高' : total >= 8 ? '中等' : '不足' };
  }
  function build(map = {}) {
    const totals = Knowledge.totals(map);
    const topics = [];
    for (const subject of Knowledge.SUBJECTS) {
      for (const point of subject.points) {
        topics.push({ ...row(subject.name, point.name, map?.[subject.name]?.[point.id]), knowledgePointId:point.id });
      }
    }
    const subjectStats = [...new Set(topics.map(x => x.subject))].map(name => {
      const rows = topics.filter(x => x.subject === name);
      return { name, ...sum([totals.subjects[name]]), topicCount: rows.length, studiedTopics: rows.filter(x => x.total).length };
    });
    const domainStats = subjectStats.map((stats, index) => ({ ...stats, id:DOMAINS[index].id }));
    const practiced = topics.filter(x => x.total > 0);
    const strengths = practiced.filter(x => x.total >= 5 && x.estimate >= 78)
      .sort((a, b) => b.estimate - a.estimate || b.total - a.total).slice(0, 4);
    const weaknesses = practiced.filter(x => x.total >= 5 && x.estimate < 60)
      .sort((a, b) => a.estimate - b.estimate || b.total - a.total).slice(0, 5);
    const unmeasured = topics.filter(x => x.total < 5)
      .sort((a, b) => a.total - b.total).slice(0, 8);
    const priorities = [...weaknesses, ...practiced.filter(x => x.total >= 5 && x.estimate < 78)
      .sort((a, b) => a.estimate - b.estimate).slice(0, 5), ...unmeasured]
      .filter((x, i, all) => all.findIndex(v => v.subject === x.subject && v.topic === x.topic) === i).slice(0, 5);
    return { topics, subjects: subjectStats, domains: domainStats, ...sum([totals.all]),
      strengths, weaknesses, unmeasured, priorities, studiedTopics: practiced.length,
      availableTopics: topics.length };
  }
  function matchesSubject(record, subject) {
    if (!subject) return true;
    const labels = Knowledge.labels(record);
    return labels.length ? labels.some(point => point.subject === subject) : Knowledge.subject(record?.subject) === subject;
  }
  function recentTrend(records, subject = null, now = Date.now()) {
    const accepted = (Array.isArray(records) ? records : [])
      .filter(x => x && typeof x.isCorrect === 'boolean' && matchesSubject(x,subject))
      .map(x => ({ ...x, ms: isoDay(x.timestamp) })).filter(x => x.ms && x.ms <= now && x.ms > now - 14 * 86400000);
    const recent = accepted.filter(x => x.ms > now - 7 * 86400000);
    const previous = accepted.filter(x => x.ms <= now - 7 * 86400000);
    const percentage = rows => rows.length ? Math.round(rows.filter(x => x.isCorrect).length / rows.length * 100) : null;
    return { recent: { count: recent.length, accuracy: percentage(recent) },
      previous: { count: previous.length, accuracy: percentage(previous) },
      delta: recent.length >= 5 && previous.length >= 5 ? percentage(recent) - percentage(previous) : null };
  }
  function skillStats(records, subject = null) {
    // Only count an explicitly labeled reasoning form, never guess it from a wrong answer.
    const accepted = (Array.isArray(records) ? records : []).filter(x =>
      x && typeof x.isCorrect === 'boolean' && matchesSubject(x,subject));
    return FORMS.map(([code, name]) => {
      const subset = accepted.filter(x => x.questionForm === code);
      return { code, ...row('推理題型', name,
        { total: subset.length, correct: subset.filter(x => x.isCorrect).length }) };
    });
  }
  function aiSummary(report, subject = null, trend = null, skills = []) {
    const scope = subject ? report.topics.filter(x => x.subject === subject) : report.topics;
    const rows = scope.filter(x => x.total > 0)
      .sort((a, b) => a.estimate - b.estimate).slice(0, 20);
    const selectedRows = scope;
    const scopedStats = subject ? report.subjects.find(x => x.name === subject) || sum([]) : report;
    return { subject: cleanLabel(subject || '綜合'), total: Math.min(200000, scopedStats.total),
      correct: Math.min(200000, scopedStats.correct),
      studiedTopics: selectedRows.filter(x => x.total).length,
      availableTopics: selectedRows.length,
      topics: rows.map(x => ({ subject: x.subject, topic: x.topic, total: x.total,
        correct: x.correct, estimate: x.estimate, confidence: x.confidence })),
      priorities: [...scope.filter(x => x.total >= 5 && x.estimate < 60),
        ...scope.filter(x => x.total >= 5 && x.estimate >= 60 && x.estimate < 78),
        ...scope.filter(x => x.total < 5)]
        .sort((a, b) => {
          const order = x => x.total >= 5 && x.estimate < 60 ? 0 :
            x.total >= 5 && x.estimate < 78 ? 1 : 2;
          return order(a) - order(b) || (a.estimate ?? 100) - (b.estimate ?? 100);
        }).slice(0, 4)
        .map(x => ({ subject: x.subject, topic: x.topic, total: x.total, estimate: x.estimate })),
      skills: (Array.isArray(skills) ? skills : []).filter(x => x.total).slice(0, 8)
        .map(x => ({ name: x.topic, total: x.total, correct: x.correct })),
      ...(trend ? { trend } : {}) };
  }
  return Object.freeze({ DOMAINS, FORMS, row, sum, build, recentTrend, skillStats, aiSummary });
});
