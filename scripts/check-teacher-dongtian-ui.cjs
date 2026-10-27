'use strict';
const { chromium } = require('playwright'), http = require('node:http'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { setup } = require('../tests/helpers/d1-db.cjs');
const register = require('../teacher-dongtian-api.cjs');
const { createEntryHandler } = require('../dongtian-entry-api.cjs');
const { db: a, secondary: bd } = setup();
const root = path.resolve(__dirname, '../public'), handlers = new Map();
register({ post: (url, handler) => handlers.set(url, handler) }, {
  resolveA: () => ({ db: a, auth: { verifyIdToken: async token => ({ uid: token, aud: 'question-learning', iss: 'https://securetoken.google.com/question-learning' }) } }), resolveBD: () => ({ db: bd })
});
handlers.set('/api/dongtian/entry', createEntryHandler({ verifyPlayer: async req => req.get('authorization').slice(7), content: () => bd, progress: () => a }));
const generated = { name: '代數洞天', subject: '數學', level: '國中一年級', difficulty: 'medium', questions: [
  { id: 'old1', q: '\\(1+1\\) 等於多少？', correct: '2', wrong: ['1', '3', '4'], exp: '一加一等於二。', knowledge_points: [{ subject: '數學', id: 'math-1', name: '數與運算' }] },
  { id: 'old2', q: '2+2=?', correct: '4', wrong: ['1', '2', '3'], exp: '二加二等於四。' }
] };
const html = `<!doctype html><html lang="zh-Hant"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#0d110f;color:#eddfbf;font:14px system-ui}*{box-sizing:border-box}.hidden{display:none!important}main{height:calc(100dvh - 64px);overflow:auto}.page-section{height:100%}#bottom-nav{position:fixed;bottom:0;left:0;right:0;height:64px;background:#1b211c}#nav-grid{height:100%;display:grid;grid-template-columns:repeat(5,minmax(0,1fr))}#nav-grid button{background:none;color:#e1cfaa;border:0;min-width:0}#nav-grid button span{display:block;font-size:11px}#nav-grid button i{display:block;font-size:18px}button{font:inherit}button.nav-btn{display:flex;flex-direction:column;align-items:center;justify-content:center}</style><main><section id="page-home" class="page-section active-page">宗門</section><section id="page-settings" class="page-section hidden">設定</section></main><nav id="bottom-nav"><div id="nav-grid">${[['page-home','宗門'],['page-training','修煉'],['page-store','坊市'],['page-social','仙盟'],['page-settings','設定']].map(([target,label])=>`<button class="nav-btn" data-target="${target}">${label}</button>`).join('')}</div></nav><script>window.__uid='teacher';window.__auth=[];window.switchToPage=id=>{document.querySelectorAll('.page-section').forEach(e=>{e.classList.toggle('hidden',e.id!==id);e.classList.toggle('active-page',e.id===id)});document.querySelectorAll('.nav-btn').forEach(e=>e.classList.toggle('active-nav-btn',e.dataset.target===id));};</script><script type="module" src="/cultivation/teacher-dongtian.js"></script></html>`;
let generationInputs;
const server = http.createServer(async (req, res) => {
  const send = (data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); return res.end(html); }
    if (url.pathname === '/cultivation/data/project-repository.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end("export const getMainUser=()=>window.__uid?{uid:window.__uid}:null;export const authenticatedMainFetch=(url,init)=>fetch(url,{...init,headers:{...init.headers,Authorization:'Bearer '+window.__uid,'Content-Type':'application/json'}});"); }
    if (url.pathname.startsWith('/api/')) {
      let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw);
      if (url.pathname === '/api/generate-dongtian') {
        generationInputs = body; res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        res.write(JSON.stringify({ type: 'planned', completed: 0, total: 2 }) + '\n');
        res.write(JSON.stringify({ type: 'batch-complete', completed: 1, total: 2 }) + '\n');
        return res.end(JSON.stringify({ type: 'complete', dongtian: generated }) + '\n');
      }
      const handler = handlers.get(url.pathname); if (!handler) return send({ ok: false }, 404);
      const reply = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(data) { send(data, this.code); } };
      return await handler({ body, get: name => req.headers[name.toLowerCase()] }, reply);
    }
    const file = path.resolve(root, '.' + url.pathname); if (!file.startsWith(root + '/') || !fs.existsSync(file)) return send({}, 404);
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(fs.readFileSync(file));
  } catch (error) { send({ ok: false, error: error.message }, 500); }
});
async function ready(page) { await page.waitForFunction(() => !document.getElementById('page-teacher-dongtian')?.inert); }
async function click(page, action, index = 0) { await page.locator(`[data-td-action="${action}"]`).nth(index).click(); await ready(page); }
async function as(page, uid) { await page.evaluate(uid => { window.__uid = uid; window.__auth.forEach(cb => cb()); }, uid); }
async function entry(page, id) { return page.evaluate(async id => { const r = await fetch('/api/dongtian/entry', { method: 'POST', headers: { Authorization: 'Bearer ' + window.__uid, 'Content-Type': 'application/json' }, body: JSON.stringify({ dongtianId: id }) }); return { status: r.status, data: await r.json() }; }, id); }
(async () => {
  await a.doc('users/teacher').set({ uid: 'teacher', displayName: '陳老師', isAdmin: false });
  await a.doc('classroomTeacherAccounts/teacher').set({ status: 'approved', version: 1 });
  await a.doc('classroomProfiles/teacher').set({ classIds: ['class-1'] });
  await a.doc('classrooms/class-1').set({ id: 'class-1', name: '七年一班', teacherName: '陳老師', ownerUid: 'teacher', status: 'active', members: [{ uid: 'student', name: '學生', seat: '1' }], assignmentIds: [] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 850 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await page.route('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const getAuth=()=>({});export const onAuthStateChanged=(a,cb)=>{window.__auth.push(cb);cb();};' }));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.locator('#nav-teacher-dongtian').waitFor(); await page.locator('#nav-teacher-dongtian').click(); await ready(page);
    await click(page, 'source'); await page.locator('[name=text]').fill('整數加法與代數教材');
    await page.locator('[name=images]').setInputFiles({ name: 'lesson.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/4b8AAAAASUVORK5CYII=', 'base64') });
    await click(page, 'generate'); assert.equal(generationInputs.images.length, 1);
    assert.match(await page.locator('[data-td-message]').innerText(), /尚未儲存或公開/);
    await page.locator('[name=q-0]').fill('教師直接改題 <img src=x onerror=window.__xss=true>');
    await page.locator('[name=option-0-2]').fill('5'); await page.locator('[name=answer-0]').selectOption('2');
    await page.locator('[name=exp-0]').fill('教師直接修改的解析');
    await page.locator('[name=visibility]').selectOption('class');
    await page.locator('#td-editor summary').click(); await page.locator('[name=pass]').fill('75');
    await page.locator('[name=feedback]').selectOption('completion'); await page.locator('[name=shuffleQuestions]').check(); await page.locator('[name=shuffleOptions]').uncheck();
    await click(page, 'down', 0); assert.match(await page.locator('[name=q-1]').inputValue(), /教師直接改題/);
    await click(page, 'save-preview'); assert.equal(await page.locator('.cc-question img').count(), 0);
    await page.locator('#td-reviewed').check(); await click(page, 'publish');
    const cave = (await bd.collection('dongtians').get()).docs[0].data(), id = cave.id;
    assert.equal(cave.visibility, 'class'); assert.equal(cave.settings.passPercent, 75); assert.equal(cave.questions[1].correct, '5');
    await click(page, 'assign');
    const fixed = (await a.collection('classroomAssignments').get()).docs[0].data(); assert.equal(fixed.status, 'draft'); assert.match(fixed.questions[1].question, /教師直接改題/);
    for (const viewport of [{ width: 1366, height: 850 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'responsive studio does not overflow');
      const nav = await page.locator('#nav-teacher-dongtian').boundingBox(); assert.ok(nav.x >= 0 && nav.x + nav.width <= viewport.width);
    }
    await as(page, 'student'); await page.waitForFunction(() => !document.getElementById('nav-teacher-dongtian'));
    assert.equal((await entry(page, id)).status, 200);
    const reported = await page.evaluate(async ({ id, questionId }) => {
      const response = await fetch('/api/dongtian/teacher-report', { method: 'POST', headers: { Authorization: 'Bearer ' + window.__uid, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, questionId, reason: '題目條件可能不足，請老師確認' }) }); return response.json();
    }, { id, questionId: cave.questions[0].id }); assert.equal(reported.ok, true);
    assert.doesNotMatch(await page.locator('#page-teacher-dongtian').innerText(), /教師直接改題/);
    await as(page, 'outsider'); assert.equal((await entry(page, id)).status, 403);
    await as(page, 'teacher'); await page.locator('#nav-teacher-dongtian').waitFor(); await page.locator('#nav-teacher-dongtian').click(); await ready(page); await click(page, 'reports');
    assert.match(await page.locator('#page-teacher-dongtian').innerText(), /題目條件可能不足/);
    await page.locator('[name=resolution]').fill('已確認條件並完成修正'); await click(page, 'resolve-report');
    assert.match(await page.locator('#page-teacher-dongtian').innerText(), /已處理/); await click(page, 'return-edit');
    await page.locator('[name=visibility]').selectOption('private'); await click(page, 'save-preview');
    assert.equal(await page.locator('[data-td-action=copy-code]').isDisabled(), true);
    await as(page, 'student'); assert.equal((await entry(page, id)).status, 403);
    await as(page, 'teacher'); await page.locator('#nav-teacher-dongtian').waitFor(); await page.locator('#nav-teacher-dongtian').click(); await ready(page); await click(page, 'copy');
    const copies = (await bd.collection('dongtians').get()).docs; assert.equal(copies.length, 2); assert.equal(copies.filter(s => s.data().status === 'draft').length, 1);
    await a.doc('classroomTeacherAccounts/teacher').update({ status: 'revoked' });
    await page.evaluate(() => window.dispatchEvent(new Event('xiuxian:teacher-access'))); await page.waitForFunction(() => !document.getElementById('nav-teacher-dongtian'));
    assert.doesNotMatch(await page.locator('#page-teacher-dongtian').innerText(), /教師直接改題/);
    assert.equal(await page.evaluate(() => window.__xss), undefined); assert.deepEqual(errors, []);
    // Execute the production runner functions against a real browser DOM.
    const source = fs.readFileSync(path.join(root, 'cultivation/dongtian.js'), 'utf8');
    const runner = source.slice(source.indexOf('  function renderRunner()'), source.indexOf('  function removeModerationModal()'));
    const finish = source.slice(source.indexOf('  async function finishDongtian()'), source.indexOf('  async function completeProgress('));
    await page.evaluate(({ runner, finish, generated }) => {
      const overlay = document.createElement('div'); overlay.id = 'dongtian-overlay'; overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#0b0f0c;padding:20px'; document.body.appendChild(overlay);
      const cave = { ...generated, teacherManaged: true, instructions: '請依序作答', settings: { shuffleOptions: false, feedback: 'completion', passPercent: 75 }, questions: generated.questions.map(q => ({ ...q, optionOrder: ['1', '2', '3', '4'] })) };
      Object.assign(window, { state: { session: { dongtian: cave, index: 0, answers: [], startedAt: Date.now() } }, ensureOverlay: () => overlay,
        escapeHtml: value => String(value ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])),
        shuffle: values => [...values].reverse(), difficultyLabel: () => '標準', openQuestionReport() {}, exitDongtian() {}, closeAfterSession() {},
        completeProgress: async () => true, writeDongtianHistory: async () => {}, firstCompletionSpiritStones: () => 0, firstCompletionCultivation: () => 0, rewardTier: () => '測試',
        OWNER_CULTIVATION_REWARD: 1, OWNER_GOLD_REWARD: 5 });
      Object.assign(window, new Function(runner + ';return {renderRunner,answerDongtian};')());
      window.finishDongtian = new Function(finish + ';return finishDongtian;')(); window.renderRunner();
    }, { runner, finish, generated });
    assert.match(await page.locator('[data-dt-answer="0"]').innerText(), /A\s*1/);
    await page.locator('[data-dt-answer="0"]').click();
    assert.equal(await page.locator('#dt-options .correct,#dt-options .wrong').count(), 0);
    assert.match(await page.locator('.dt-explain').innerText(), /完成整份洞天後/);
    await page.evaluate(() => { state.session.index = 1; renderRunner(); });
    await page.locator('[data-dt-answer="3"]').click(); await page.evaluate(() => finishDongtian());
    assert.match(await page.locator('.dt-result').innerText(), /及格標準 75% · 尚未達標/);
    await page.locator('.dt-result details summary').click();
    assert.match(await page.locator('.dt-result details').innerText(), /一加一等於二/);
    assert.match(await page.locator('.dt-result details').innerText(), /二加二等於四/);
    assert.deepEqual(errors, []);
    console.log('Teacher studio browser acceptance passed: teacher-only navigation; text/image generation stream; direct question/answer/explanation editing; ordering; publication and privacy; class assignment snapshots; responsive navigation; role revocation and account isolation.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
