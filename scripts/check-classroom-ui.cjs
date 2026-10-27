'use strict';
// Optional browser acceptance check: node scripts/check-classroom-ui.cjs
// Requires Playwright; no production credentials, AI requests, or remote data.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setup } = require('../tests/helpers/d1-db.cjs');
const { perform } = require('../classroom-api.cjs');
const root = path.join(__dirname, '../public');
const { db } = setup();
const legacy = fs.readFileSync(path.join(root, 'main-legacy.js'), 'utf8');
const markup = legacy.match(/pageSocial.innerHTML = `([\s\S]*?)`;\s*main.appendChild\(pageSocial\)/)[1];
const social = new Function('t', 'return `' + markup + '`;')(key => key);
const switcher = legacy.match(/window.switchSocialTab = \(tab\) => \{[\s\S]*?\n};/)[0];
const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>班級驗收</title><style>
body{margin:0;background:#0d110f;color:#e8ddc5;font:14px system-ui;height:100vh}*{box-sizing:border-box}.hidden{display:none!important}.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1;min-height:0}.h-full{height:100%}.overflow-hidden{overflow:hidden}.overflow-y-auto{overflow-y:auto}.relative{position:relative}.absolute{position:absolute}.gap-2{gap:8px}.p-4{padding:16px}.px-4{padding-left:16px;padding-right:16px}.py-2{padding-top:8px;padding-bottom:8px}.mb-2{margin-bottom:8px}button{font:inherit;color:inherit;background:#30281d;border:1px solid #78664b;border-radius:7px;cursor:pointer}h2{font-size:21px;margin:0}.ui-social-heading{padding:14px 0 2px;border-bottom:1px solid #776247}.ui-social-tabs button{min-height:40px}.bg-cyan-600{background:#76603b}
</style><body><button id="btn-social-nav" data-target="page-social" onclick="window.__allianceEntered=true" style="position:fixed;bottom:0;right:0;z-index:10">仙盟入口測試</button><div id="page-social" class="h-full flex flex-col">${social}</div><script>window.__uid='teacher';window.__authCallbacks=[];window.getCurrentUserData=()=>({stats:{totalScore:0}});window.beginSceneTransition=()=>()=>{};window.loadFriendList=()=>{};let chatUnsub=null;function listenToGlobalChat(){};${switcher}</script><script type="module" src="/cultivation/classroom.js"></script><script type="module" src="/cultivation/cultivation-progression-v2.js"></script></body></html>`;
let delayReport = false;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); return res.end(html); }
    if (url.pathname === '/cultivation/data/project-repository.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end("export const getMainUser=()=>window.__uid?{uid:window.__uid}:null;export const authenticatedMainFetch=(url,init)=>fetch(url,{...init,headers:{Authorization:'Bearer '+window.__uid,'Content-Type':'application/json'}});");
    }
    if (url.pathname === '/data-store.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end('export const getFirestore=()=>({});export const doc=()=>({});export const updateDoc=async()=>{};'); }
    if (url.pathname.startsWith('/api/')) {
      let data = ''; for await (const chunk of req) data += chunk;
      const body = JSON.parse(data), uid = req.headers.authorization?.slice(7);
      let result;
      if (url.pathname === '/api/generate-quiz') result = { text: JSON.stringify({ question: '\\(2+2\\) 等於多少？', correct: '4', wrong: ['1', '2', '3'], explanation: '二加二等於四。', knowledge_points: [{ subject: '數學', id: 'math-1', name: '數與運算' }] }) };
      else result = { ok: true, ...await perform(db, uid, body) };
      if (delayReport && body.action === 'report') await new Promise(resolve => setTimeout(resolve, 500));
      res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(result));
    }
    const file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root + '/') || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(fs.readFileSync(file));
  } catch (error) { res.statusCode = error.status || 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: error.message })); }
});
async function ready(page) { await page.waitForFunction(() => !document.querySelector('#section-classes')?.inert && document.querySelector('.cc-shell')?.getAttribute('aria-busy') !== 'true'); }
async function click(page, action, index = 0) { await page.locator(`[data-action="${action}"]`).nth(index).click(); await ready(page); }
async function as(page, uid) { await page.evaluate(uid => { window.__uid = uid; window.__authCallbacks.forEach(cb => cb()); }, uid); await page.evaluate(() => window.QAClassrooms.open()); await ready(page); }
async function measure(page) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no document overflow'); }
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const getAuth=()=>({});export const onAuthStateChanged=(auth,cb)=>{window.__authCallbacks.push(cb);cb();};' }));
    await page.route('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const getApp=()=>({});' }));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(origin); await page.waitForFunction(() => window.QAClassrooms && window.XIUXIAN_UNLOCKS);
    await page.locator('#btn-social-nav').click(); assert.equal(await page.evaluate(() => window.__allianceEntered), true);
    assert.equal(await page.locator('#btn-social-nav.progression-locked').count(), 0);
    await page.evaluate(() => window.switchSocialTab('classes')); await ready(page);
    await page.locator('[data-form=create] [name=name]').fill('七年一班');
    await page.locator('[data-form=create] [name=teacherName]').fill('陳老師');
    await click(page, 'create');
    const code = await page.locator('.cc-code').innerText();
    await click(page, 'new-assignment');
    await page.locator('[name=title]').fill('加法練習');
    await page.locator('[name=question-0]').fill('1 + 1 = ? <img src=x onerror=alert(1)>');
    for (let i = 0; i < 4; i++) await page.locator(`[name=option-0-${i}]`).fill(String(i + 1));
    await page.locator('[name=answer-0]').selectOption('1');
    await page.locator('[name=point-0]').selectOption('math-1');
    await page.locator('summary').filter({ hasText: '協助出題' }).click();
    await page.locator('[name=topic]').fill('整數加法'); await click(page, 'generate-question');
    assert.equal(await page.locator('[name=question-1]').count(), 1);
    await click(page, 'save-preview'); assert.equal(await page.locator('.cc-question img').count(), 0);
    await page.locator('#cc-reviewed').check(); await click(page, 'publish');
    await measure(page);
    await as(page, 'student'); await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-form=join] [name=joinCode]').fill(code);
    await page.locator('[data-form=join] [name=name]').fill('王同學'); await page.locator('[data-form=join] [name=seat]').fill('2');
    await click(page, 'join'); await measure(page);
    await click(page, 'work');
    assert.equal(await page.locator('[data-action=answer][aria-pressed=true]').count(), 0);
    await click(page, 'answer', 0);
    await page.reload(); await page.waitForFunction(() => window.QAClassrooms);
    await page.evaluate(() => { window.__uid = 'student'; window.__authCallbacks.forEach(cb => cb()); window.switchSocialTab('classes'); }); await ready(page);
    await click(page, 'class'); await click(page, 'work');
    assert.equal(await page.locator('[data-action=answer][aria-pressed=true]').innerText(), 'A. 1');
    await click(page, 'next-question'); await click(page, 'answer', 0); await click(page, 'submit');
    assert.match(await page.locator('.cc-stat').innerText(), /50/);
    await click(page, 'correct', 1); assert.match(await page.locator('.cc-status').filter({ hasText: '已完成訂正' }).innerText(), /已完成/);
    await measure(page);
    if (process.env.CLASSROOM_CAPTURE_DIR) { fs.mkdirSync(process.env.CLASSROOM_CAPTURE_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.CLASSROOM_CAPTURE_DIR, 'student-portrait.png') }); }
    await as(page, 'teacher'); await page.setViewportSize({ width: 1366, height: 850 });
    await click(page, 'class'); await click(page, 'report');
    assert.match(await page.locator('tbody').innerText(), /王同學[\s\S]*50[\s\S]*1 \/ 1/);
    const download = page.waitForEvent('download'); await click(page, 'export'); assert.equal((await download).suggestedFilename(), 'classroom-grades.csv');
    await measure(page);
    if (process.env.CLASSROOM_CAPTURE_DIR) await page.screenshot({ path: path.join(process.env.CLASSROOM_CAPTURE_DIR, 'teacher-landscape.png') });
    delayReport = true; await page.locator('[data-action=refresh]').click(); await page.waitForTimeout(40);
    await as(page, 'outsider'); await page.waitForTimeout(600);
    assert.doesNotMatch(await page.locator('#section-classes').innerText(), /王同學|加法練習|50 分/);
    await page.evaluate(() => window.switchSocialTab('friends'));
    assert.equal(await page.locator('#section-classes').isVisible(), false);
    await page.evaluate(() => window.switchSocialTab('chat'));
    assert.equal(await page.locator('#section-chat').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('Classroom browser acceptance passed: teacher drafting/AI/preview/publish; student join/resume/grade/correct; report/export; responsive layout; account isolation; social tabs.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
