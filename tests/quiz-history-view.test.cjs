'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const History = require('../public/cultivation/quiz-history-view.js');
const read = p => fs.readFileSync(path.join(__dirname, '../public', p), 'utf8');

test('history title, every option and explanation use exactly the live quiz math formatter', () => {
  const context = { window: {}, console };
  vm.runInNewContext(read('cultivation/quiz-math.js'), context);
  const live = context.window.quizMathRichText;
  const record = {
    question: String.raw`計算 \(x^2+\frac{1}{2}\) 且 x < 3`,
    options: [String.raw`$\frac{1}{2}$`, String.raw`\(x^2\)`, 'A&B', '5'],
    explanation: String.raw`由 \(\frac{1}{2}\) 得到 $x^2$，而且 x < 3`,
    isCorrect: false, userIdx: 0, correctIdx: 1, rankAtTime: '<img src=x onerror=alert(1)>'
  };
  const { html, classes } = History.normalize(record, '10/16/2026', live);
  assert.match(classes, /history-quiz-wrong/);
  for (const raw of [record.question, ...record.options, record.explanation]) {
    assert.ok(html.includes(live(raw)), 'history must share live quiz rich rendering for: ' + raw);
  }
  assert.match(html, /history-quiz-question/);
  assert.match(html, /history-quiz-option-text quiz-rich-option/);
  assert.match(html, /history-quiz-rich/);
  assert.match(html, /正確答案/);
  assert.match(html, /你的答案/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /class="history-quiz-details" hidden/);
});

test('history without choices still renders any saved explanation; early records have a readable fallback', () => {
  const saved = History.normalize({ question: '$a^2$', explanation: '公式 $a^2$', isCorrect: true }, '--', v => v);
  assert.match(saved.html, /舊紀錄未保存本題選項/);
  assert.match(saved.html, /公式 \$a\^2\$/);
  const early = History.normalize({ question: '舊數學題', isCorrect: false }, '--');
  assert.match(early.html, /早期答題紀錄未保留選項及解析/);
  assert.match(early.html, /舊數學題/);
});

test('explicit expansion toggles aria-expanded and hidden state', () => {
  const btn = { expanded: 'false', setAttribute(key, value) { if (key === 'aria-expanded') this.expanded = value; },
    getAttribute() { return this.expanded; } };
  const details = { hidden: true };
  const root = { querySelector(query) { return query.includes('expand') ? btn : details; } };
  assert.equal(History.toggle(root), true);
  assert.equal(btn.expanded, 'true');
  assert.equal(details.hidden, false);
  assert.equal(History.toggle(root), false);
  assert.equal(details.hidden, true);
});

test('history and Dongtian defer hidden MathJax typesetting until expanded', () => {
  const legacy = read('main-legacy.js');
  const dungeon = read('cultivation/dongtian.js');
  const entry = read('main.js');
  assert.match(legacy, /const historyView = window\.QAQuizHistoryView/);
  assert.match(legacy, /const rich = window\.quizMathRichText/);
  assert.match(legacy, /void window\.quizMathTypeset\?\.\(li\.querySelector\('\.history-quiz-details'\)\)/);
  assert.match(legacy, /historyQuestions = \[\.\.\.ul\.querySelectorAll\('\.history-quiz-question'\)\]/);
  assert.match(dungeon, /const rich = window\.quizMathRichText/);
  assert.match(dungeon, /if \(expanded\) void window\.quizMathTypeset\?\.\(details\)/);
  const mathPos = entry.indexOf("'./cultivation/quiz-math.js'");
  const histPos = entry.indexOf("'./cultivation/quiz-history-view.js'");
  assert.ok(mathPos > 0 && histPos > mathPos);
  assert.match(legacy, /auth\.currentUser\?\.uid !== uid \|\| epoch !== historyRequestEpoch/);
});

test('math history styles remain readable on mobile and preserve overflow for long formulas', () => {
  const css = read('styles/quiz-history.css');
  assert.match(css, /mjx-container\[display=true\]/);
  assert.match(css, /overflow-x:auto/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(css, /history-quiz-options/);
});
