const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const legacy = fs.readFileSync(path.join(__dirname, '..', 'public/main-legacy.js'), 'utf8');

test('quiz rich-text formatter protects special symbols before rendering HTML', () => {
  assert.match(legacy, /function normalizeQuizSymbols\(text\)/);
  assert.match(legacy, /&\(\?:lt\|#60\);/);
  assert.match(legacy, /&\(\?:le\|leq\);/);
  assert.match(legacy, /&times;/);
  assert.match(legacy, /function formatQuizRichText\(text\)/);
  assert.match(legacy, /working = escapeHtml\(working\)\.replace\(\/\\n\/g, '<br>'\)/);
});

test('quiz rich-text formatter protects images and MathJax segments separately', () => {
  assert.match(legacy, /sanitizeQuizImageUrl/);
  assert.match(legacy, /Markdown 圖片/);
  assert.match(legacy, /MathJax 區段/);
  assert.match(legacy, /\/\\\$\\\$\[\\s\\S\]\*\?\\\$\\\$\/g/);
  assert.match(legacy, /\/\\\\\\\[\[\\s\\S\]\*\?\\\\\\\]\/g/);
  assert.match(legacy, /\/\\\\\\\(\[\\s\\S\]\*\?\\\\\\\)\/g/);
});

test('solo question, all four choices and explanation share the safe queued renderer', () => {
  assert.match(legacy, /const renderedQuestion = \\(window\\.quizMathRichText \\|\\| formatQuizRichText\\)\\(data\\.q\\)/);
  assert.match(legacy, /questionTextEl\\.innerHTML = renderedQuestion/);
  assert.match(legacy, /quiz-rich-option[^\\n]*quizMathRichText \\|\\| formatQuizRichText\\)\\(optText\\)/);
  assert.match(legacy, /window\\.quizMathSet\\(fbText, explanationText\\)/);
  assert.match(legacy, /function parseMarkdownImages\\(text\\) \\{[\\s\\S]*return formatQuizRichText\\(text\\)/);
});

test('MathJax is rerun for the full options set and feedback after dynamic updates', () => {
  assert.match(legacy, /window\\.quizMathClear\\?\\.\\(\\[questionTextEl, container\\]\\)/);
  assert.match(legacy, /const mathTargets = \\[questionTextEl, container, whiteboardQuestionEl\\]\\.filter\\(Boolean\\)/);
  assert.match(legacy, /if \\(window\\.quizMathTypeset\\) void window\\.quizMathTypeset\\(mathTargets\\)/);
  assert.match(legacy, /window\\.quizMathSet\\(fbText, explanationText\\)/);
  assert.match(legacy, /window\\.quizMathSet\\(fbText, currentExp\\)/);
});
