// 客觀能力診斷：確保統計分數與生成式 AI 的角色分開。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QAAbilityInsights = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const DOMAINS = Object.freeze([
    { id: 'language', name: '語文', subjects: ['國文', '英文'] },
    { id: 'math', name: '數學', subjects: ['數學', '數學A', '數學B', '數學甲', '數學乙'] },
    { id: 'society', name: '社會', subjects: ['歷史', '地理', '公民'] },
    { id: 'science', name: '自然', subjects: ['物理', '化學', '生物', '地球科學'] },
    { id: 'tech', name: '科技', subjects: ['資訊科技'] }
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
  function build(map, schema = {}) {
    const subjects = new Set([...Object.keys(schema || {}), ...Object.keys(map || {})]);
    const topics = [];
    for (const subjectName of subjects) {
      const subject = cleanLabel(subjectName);
      if (!subject || !subjectName || typeof (map || {})[subjectName] === 'string') continue;
      const source = (map || {})[subjectName] || {};
      const suggested = Array.isArray(schema?.[subjectName]) ? schema[subjectName] : [];
      const topicNames = new Set([...suggested, ...Object.keys(source)]);
      for (const originalTopic of topicNames) {
        const topic = cleanLabel(originalTopic);
        if (!topic) continue;
        topics.push(row(subject, topic, source[originalTopic]));
      }
    }
    const subjectStats = [...new Set(topics.map(x => x.subject))].map(name => {
      const rows = topics.filter(x => x.subject === name);
      return { name, ...sum(rows), topicCount: rows.length, studiedTopics: rows.filter(x => x.total).length };
    });
    const domainStats = DOMAINS.map(domain => {
      const rows = topics.filter(x => domain.subjects.includes(x.subject));
      return { id: domain.id, name: domain.name, ...sum(rows), topicCount: rows.length,
        studiedTopics: rows.filter(x => x.total).length };
    });
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
    return { topics, subjects: subjectStats, domains: domainStats, ...sum(practiced),
      strengths, weaknesses, unmeasured, priorities, studiedTopics: practiced.length,
      availableTopics: topics.length };
  }
  function recentTrend(records, subject = null, now = Date.now()) {
    const accepted = (Array.isArray(records) ? records : [])
      .filter(x => x && typeof x.isCorrect === 'boolean' && (!subject || x.subject === subject))
      .map(x => ({ ...x, ms: isoDay(x.timestamp) })).filter(x => x.ms && x.ms <= now && x.ms > now - 14 * 86400000);
    const recent = accepted.filter(x => x.ms > now - 7 * 86400000);
    const previous = accepted.filter(x => x.ms <= now - 7 * 86400000);
    const percentage = rows => rows.length ? Math.round(rows.filter(x => x.isCorrect).length / rows.length * 100) : null;
    return { recent: { count: recent.length, accuracy: percentage(recent) },
      previous: { count: previous.length, accuracy: percentage(previous) },
      delta: recent.length >= 5 && previous.length >= 5 ? percentage(recent) - percentage(previous) : null };
  }
  function aiSummary(report, subject = null, trend = null) {
    const rows = (subject ? report.topics.filter(x => x.subject === subject) : report.topics)
      .filter(x => x.total > 0).sort((a, b) => a.estimate - b.estimate).slice(0, 20);
    return { subject: cleanLabel(subject || '綜合'), total: Math.min(200000, report.total),
      correct: Math.min(200000, report.correct), studiedTopics: report.studiedTopics,
      availableTopics: report.availableTopics,
      topics: rows.map(x => ({ subject: x.subject, topic: x.topic, total: x.total,
        correct: x.correct, estimate: x.estimate, confidence: x.confidence })),
      priorities: report.priorities.filter(x => !subject || x.subject === subject).slice(0, 4)
        .map(x => ({ subject: x.subject, topic: x.topic, total: x.total, estimate: x.estimate })),
      ...(trend ? { trend } : {}) };
  }
  return Object.freeze({ DOMAINS, row, sum, build, recentTrend, aiSummary });
});
