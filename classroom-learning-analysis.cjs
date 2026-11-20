'use strict';
// Derived summaries only. Never return answers, correct options, raw submission documents,
// or other student records from these helpers.
const round = value => Math.round(value * 100) / 100;
const submitted = s => s?.status === 'submitted' && Array.isArray(s.answers);
function knowledgeSummary(assignment, records) {
  const points = new Map();
  let markedQuestions = 0;
  for (let i = 0; i < assignment.questions.length; i++) {
    const q = assignment.questions[i];
    const labels = Array.isArray(q.knowledge_points) ? q.knowledge_points : [];
    if (labels.length) markedQuestions++;
    for (const p of labels) {
      if (!p || typeof p.id !== 'string' || typeof p.subject !== 'string') continue;
      const key = p.subject + '/' + p.id;
      const stat = points.get(key) || { id: p.id, name: String(p.name || p.id), subject: p.subject,
        correct: 0, total: 0, questionCount: 0 };
      stat.questionCount++;
      for (const s of records) {
        if (!submitted(s)) continue;
        stat.total++;
        if (s.answers[i] === q.answerIndex) stat.correct++;
      }
      points.set(key, stat);
    }
  }
  return { knowledgePoints: [...points.values()], markedQuestions };
}
function correctedWrongCount(assignment, s) {
  if (!submitted(s)) return 0;
  const corrected = new Set();
  for (const correction of s.corrections || []) {
    if (!correction.correct) continue;
    const index = assignment.questions.findIndex(q => q.id === correction.questionId);
    if (index >= 0 && s.answers[index] !== assignment.questions[index].answerIndex) corrected.add(index);
  }
  return corrected.size;
}
function summarizeClassAssignment(assignment, members, records) {
  const complete = records.filter(submitted);
  const inProgress = records.filter(s => s?.status === 'in-progress').length;
  const validScores = complete.map(s => s.score).filter(Number.isFinite);
  const { knowledgePoints, markedQuestions } = knowledgeSummary(assignment, complete);
  return {
    id: assignment.id, title: assignment.title, subject: assignment.subject, status: assignment.status,
    publishedAtMs: assignment.publishedAtMs || assignment.createdAtMs || null,
    dueAtMs: assignment.dueAtMs || null, questionCount: assignment.questions.length,
    markedQuestions, studentCount: members.length, submitted: complete.length,
    inProgress, notStarted: members.length - complete.length - inProgress,
    average: validScores.length ? round(validScores.reduce((sum, x) => sum + x, 0) / validScores.length) : null,
    firstCorrect: complete.reduce((total, s) => total + s.correctCount, 0),
    firstAttempts: complete.reduce((total, s) => total + s.total, 0),
    knowledgePoints
  };
}
function summarizeStudentAssignment(assignment, student) {
  const s = student || null;
  const done = submitted(s);
  const { knowledgePoints, markedQuestions } = knowledgeSummary(assignment, done ? [s] : []);
  return {
    id: assignment.id, title: assignment.title, subject: assignment.subject, status: assignment.status,
    publishedAtMs: assignment.publishedAtMs || assignment.createdAtMs || null,
    dueAtMs: assignment.dueAtMs || null,
    questionCount: assignment.questions.length, markedQuestions,
    workStatus: done ? 'submitted' : s?.status === 'in-progress' ? 'in-progress' : 'not-started',
    score: done ? s.score : null, correctCount: done ? s.correctCount : null, total: done ? s.total : null,
    submittedAtMs: done ? s.submittedAtMs : null,
    wrongCount: done ? s.total - s.correctCount : null,
    correctedCount: done ? correctedWrongCount(assignment, s) : 0,
    knowledgePoints
  };
}
module.exports = { summarizeClassAssignment, summarizeStudentAssignment, knowledgeSummary, correctedWrongCount };
