const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../public/main-legacy.js'), 'utf8');
const start = source.indexOf('const UI_TEXT = {');
const end = source.indexOf('// 🛠️ 管理員 Debugger', start);

test('legacy English or invalid language preferences cannot change Chinese interface labels', () => {
  for (const preference of ['en', 'invalid-locale']) {
    const next = { getAttribute: () => 'btn_next_q' };
    const loading = { getAttribute: () => 'loading_title' };
    const placeholder = { getAttribute: () => 'placeholder_weak' };
    let refreshed = 0;
    const context = {
      window: {},
      localStorage: { getItem() { assert.fail('removed language preference must not be read: ' + preference); } },
      document: { querySelectorAll: selector => selector === '[data-i18n]' ? [next, loading] : [placeholder] },
      updateUIStats() { refreshed += 1; }
    };
    vm.runInNewContext(source.slice(start, end), context);
    context.window.updateTexts();
    assert.equal(next.innerText, '繼續悟道');
    assert.equal(loading.innerText, '雲端大腦運算中');
    assert.equal(placeholder.placeholder, '輸入想加強的科目...');
    assert.equal(context.window.toggleLanguage, undefined);
    assert.equal(refreshed, 1);
    assert.equal(context.t('msg_buy_confirm', { price: 25 }), '確定要花費 25 積分購買嗎？');
  }
});
