const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const legacy = fs.readFileSync(path.join(__dirname, '..', 'public/main-legacy.js'), 'utf8');
const formatter = legacy.slice(legacy.indexOf('function escapeHtml(text)'), legacy.indexOf('// 保留舊名稱'));
const context = {};
vm.runInNewContext(formatter, context);

test('formula inequalities, aligned rows and HTML-like text remain literal browser text', () => {
  const rich = context.formatQuizRichText;
  assert.equal(rich('$a<b$'), '$a&lt;b$');
  assert.equal(rich(String.raw`\[\begin{aligned}x&<y\\y&>0\end{aligned}\]`),
    String.raw`\[\begin{aligned}x&amp;&lt;y\\y&amp;&gt;0\end{aligned}\]`);
  assert.equal(rich(String.raw`\(\text{<img src=x onerror=alert(1)>}\)`),
    String.raw`\(\text{&lt;img src=x onerror=alert(1)&gt;}\)`);
  assert.equal(rich('範圍 $0 &lt; x &lt; 3$'), '範圍 $0 &lt; x &lt; 3$');
});

test('escaped dollars and valid formulas survive formatting alongside images', () => {
  const input = String.raw`售價 \$20，答案 $\frac{1}{2}$ ![圖](/quiz.png)`;
  const output = context.formatQuizRichText(input);
  assert.ok(output.includes(String.raw`售價 \$20，答案 $\frac{1}{2}$`));
  assert.ok(output.includes('<img src="/quiz.png"'));
  assert.equal(context.formatQuizRichText(String.raw`$\frac{1}{2$`), String.raw`$\frac{1}{2$`);
});

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
  assert.ok(legacy.includes('const renderedQuestion = (window.quizMathRichText || formatQuizRichText)(data.q);'));
  assert.ok(legacy.includes('questionTextEl.innerHTML = renderedQuestion;'));
  assert.ok(legacy.includes('quiz-rich-option'));
  assert.ok(legacy.includes('(window.quizMathRichText || formatQuizRichText)(optText)'));
  assert.ok(legacy.includes('window.quizMathSet(fbText, explanationText)'));
  assert.match(legacy, /function parseMarkdownImages\(text\) \{[\s\S]*return formatQuizRichText\(text\)/);
});

test('MathJax is rerun for the full options set and feedback after dynamic updates', () => {
  assert.ok(legacy.includes('window.quizMathClear?.([questionTextEl, container]);'));
  assert.ok(legacy.includes('const mathTargets = [questionTextEl, container, whiteboardQuestionEl].filter(Boolean);'));
  assert.ok(legacy.includes('if (window.quizMathTypeset) void window.quizMathTypeset(mathTargets);'));
  assert.ok(legacy.includes('window.quizMathSet(fbText, explanationText)'));
  assert.ok(legacy.includes('window.quizMathSet(fbText, currentExp)'));
});

test('source table cells, underlines and scientific scripts render as safe text', () => {
  const rich = context.formatQuizRichText;
  const result = rich('比較 <u>最不可能</u>：H<sub>2</sub>O、2<sup>3</sup>\n| 類別 | 數值 |\n| 甲 | $\\frac{1}{2}$ |');
  assert.ok(result.includes('<u>最不可能</u>'));
  assert.ok(result.includes('H<sub>2</sub>O'));
  assert.ok(result.includes('2<sup>3</sup>'));
  assert.ok(result.includes('<table'));
  assert.ok(result.includes(String.raw`$\frac{1}{2}$`));
  assert.ok(result.includes('<td'));
  assert.equal(rich('<sup onclick="alert(1)">3</sup>'), '&lt;sup onclick=&quot;alert(1)&quot;&gt;3&lt;/sup&gt;');
  assert.ok(rich('| <script>alert(1)</script> | 題目 |\n| 甲 | 乙 |').includes('&lt;script&gt;'));
});

test('absolute-value formulas stay within one table cell and bank figures retain natural sizing', () => {
  const html = context.formatQuizRichText('| 式子 | 值 |\n| $|x|$ | 1 |');
  assert.ok(html.includes('$|x|$'));
  assert.equal((html.match(/<td /g) || []).length, 4);
  assert.ok(context.formatQuizRichText('![圖](/assets/banks/exam/Q1-figure-1.png)').includes('w-auto'));
  assert.ok(context.formatQuizRichText('![圖](/quiz.png)').includes('w-full'));
});

test('literal currency in text tables does not merge columns into math', () => {
  const output = context.formatQuizRichText(String.raw`| 價格 | 數量 |
| \$5 | 1 |
| \$6 | 2 |`);
  assert.equal((output.match(/<td /g) || []).length, 6);
  assert.ok(output.includes(String.raw`\$5`));
});
