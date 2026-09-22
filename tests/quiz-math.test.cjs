const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const root = join(__dirname, '../public');
const read = p => readFileSync(join(root,p), 'utf8');
const math = read('cultivation/quiz-math.js');
const main = read('main.js');
const battle = read('cultivation/battle-mode-v2.js');
const dongtian = read('cultivation/dongtian.js');
const tutorial = read('cultivation/battle-tutorial.js');
const legacy = read('main-legacy.js');
const server = readFileSync(join(__dirname, '../server.js'), 'utf8');

test('shared MathJax renderer loads before battle, story and Dongtian', () => {
  new vm.Script(math);
  const ix = p => main.indexOf("'" + p + "'");
  assert.ok(ix('./cultivation/quiz-math.js') > 0);
  for (const p of ['./cultivation/battle-mode-v2.js','./cultivation/battle-tutorial.js','./cultivation/dongtian.js']) {
    assert.ok(ix('./cultivation/quiz-math.js') < ix(p), p);
  }
});

test('standalone TeX formulas get delimiters, natural language remains HTML-escaped', () => {
  const context = {window: {},console};
  vm.runInNewContext(math,context);
  const rich = context.window.quizMathRichText;
  assert.equal(rich('<b>一般中文與 x < 3</b>'), '&lt;b&gt;一般中文與 x &lt; 3&lt;/b&gt;');
  assert.equal(rich(String.raw\`\frac{1}{2}\`), String.raw\`\\(\frac{1}{2}\\)\`);
  assert.equal(rich(String.raw\`答案為 \(\frac{1}{2}\)\`), String.raw\`答案為 \(\frac{1}{2}\)\`);
  assert.equal(rich(String.raw\`$x^2+1$\`), String.raw\`$x^2+1$\`);
});

test('typesetting is serialized and only processes connected nodes', async () => {
  let running = 0, parallel = false, count = 0, cleared = 0;
  const context = {console, window: {MathJax: {
    startup: {promise: Promise.resolve()},
    typesetClear(nodes) {cleared += nodes.length;},
    async typesetPromise(nodes) {
      running += 1; if (running > 1) parallel = true;
      count += nodes.length;
      await Promise.resolve();
      running -= 1;
    }
  }}};
  vm.runInNewContext(math, context);
  const first = {isConnected:true,innerHTML:''}, second = {isConnected:true,innerHTML:''};
  await Promise.all([context.window.quizMathSet(first,'$x$'), context.window.quizMathSet(second,'$y$')]);
  assert.equal(first.innerHTML,'$x$');
  assert.equal(second.innerHTML,'$y$');
  assert.equal(count,2);
  assert.equal(cleared,2);
  assert.equal(parallel,false);
});

test('all live question, choices and explanation surfaces use the shared formatter', () => {
  assert.match(battle,/qEl\.innerHTML = rich\(question\.q\)/);
  assert.match(battle,/rich\(option\)/);
  assert.match(battle,/quizMathTypeset\?\.\(\[qEl, optionsEl\]\)/);
  assert.match(battle,/expEl\.innerHTML = '<strong>解析：<\/strong>'/);
  assert.match(battle,/quizMathTypeset\?\.\(expEl\)/);
  assert.match(dongtian,/rich\(q\.q\)/);
  assert.match(dongtian,/rich\(option\.text\)/);
  assert.match(dongtian,/quizMathRichText \|\| escapeHtml\)\(q\.exp/);
  assert.match(dongtian,/quizMathTypeset\?\.\(slot\)/);
  assert.match(tutorial,/mathText\(SHEN_QUESTION\.q\)/);
  assert.match(tutorial,/mathText\(SHEN_QUESTION\.exp\)/);
  assert.match(tutorial,/mathText\(question\.q\)/);
  assert.match(tutorial,/mathText\(question\.exp\)/);
  assert.match(tutorial,/quizMathTypeset\?\.\(el\)/);
  assert.match(legacy,/quiz-rich-option/);
  assert.match(legacy,/quizMathRichText \|\| parseMarkdownImages\)\(opt\)/);
  assert.match(server,/LaTeX 排版/);
  assert.match(server,/題幹、正確選項、三個錯誤選項及解析/);
});
