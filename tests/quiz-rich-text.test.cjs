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

test('question, every option and explanation use the same safe formatter', () => {
  assert.match(legacy, /questionTextEl\.innerHTML = parseMarkdownImages\(data\.q\)/);
  assert.match(legacy, /quiz-rich-option[^\n]*formatQuizRichText\(optText\)/);
  assert.match(legacy, /fbText\.innerHTML = formatQuizRichText\(explanation\)/);
  assert.match(legacy, /function parseMarkdownImages\(text\) \{[\s\S]*return formatQuizRichText\(text\)/);
});

test('MathJax is rerun for options and explanation after rich-text rendering', () => {
  assert.match(legacy, /typesetClear\?\.\(mathTargets\)/);
  assert.match(legacy, /typesetPromise\(mathTargets\)/);
  assert.match(legacy, /typesetClear\?\.\(\[fbText\]\)/);
  assert.match(legacy, /typesetPromise\?\.\(\[fbText\]\)/);
});
