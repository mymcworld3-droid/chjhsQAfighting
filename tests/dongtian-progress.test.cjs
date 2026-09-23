'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const register = require('../dongtian-api.js');
const aiRouter = require('../ai-router.js');
const ui = fs.readFileSync(path.join(__dirname, '../public/cultivation/dongtian.js'), 'utf8');

function mockResponse() {
  const events = [];
  return {
    statusCode: 200, headers: {}, events,
    status(code) { this.statusCode = code; return this; },
    set(key, value) { this.headers[key] = value; return this; },
    flushHeaders() {},
    write(chunk) { events.push(...chunk.trim().split('\n').filter(Boolean).map(JSON.parse)); return true; },
    end(chunk = '') { if (chunk) this.write(chunk); this.ended = true; return this; },
    json(value) { this.body = value; this.ended = true; return this; }
  };
}

test('NDJSON reports confirmed per-batch progress and final cave after independent review', async () => {
  const original = aiRouter.generateJSON;
  const responses = [
    { questionCount: 11, name: '代數重點', subject: '數學', level: '國中一年級' },
    { questions: Array.from({ length: 5 }, (_, i) => ({ q: '算式 ' + (i + 1) + ' = ?', correct:'正解',wrong:['錯解1','錯解2','錯解3'],exp:'解析'+i,subject:'數學' })) },
    { questions: Array.from({ length: 5 }, (_, i) => ({ q: '算式 ' + (i + 6) + ' = ?', correct:'正解',wrong:['錯解1','錯解2','錯解3'],exp:'解析'+i,subject:'數學' })) },
    { questions: [{ q: '算式 11 = ?', correct:'正解',wrong:['錯解1','錯解2','錯解3'],exp:'解析11',subject:'數學' }] },
    { approved: true, confidence: 0.96, issues: [], summary: '符合要求' }
  ];
  let calls = 0;
  aiRouter.generateJSON = async () => ({ data: responses[calls++], provider:'test', model:'stub' });
  try {
    const routes = {};
    register({ post(name, fn) { routes[name] = fn; } });
    const res = mockResponse();
    await routes['/api/generate-dongtian']({
      get: () => 'application/x-ndjson',
      body: { text: '一次函數與方程式', creatorLevel:'國中一年級', questionAmount:'low' }
    }, res);
    assert.equal(calls, 5);
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /application\/x-ndjson/);
    assert.equal(res.ended, true);
    assert.deepEqual(res.events.map(e => e.type), [
      'planning','planned','batch-start','batch-complete','batch-start','batch-complete',
      'batch-start','batch-complete','review','complete'
    ]);
    assert.deepEqual(res.events.filter(e => e.type === 'batch-complete').map(e => [e.completed,e.total]), [[5,11],[10,11],[11,11]]);
    assert.equal(res.events.at(-1).dongtian.questions.length, 11);
    assert.equal(res.events.at(-1).doubleCheck.passed, true);
  } finally { aiRouter.generateJSON = original; }
});

test('NDJSON reports generation failures instead of fabricating completed questions', async () => {
  const original = aiRouter.generateJSON;
  let calls = 0;
  aiRouter.generateJSON = async () => {
    if (!calls++) return { data:{ questionCount:10,subject:'數學' } };
    throw Error('model unavailable');
  };
  try {
    const routes = {};
    register({ post(name, fn) { routes[name] = fn; } });
    const res = mockResponse();
    const savedError = console.error;
    console.error = () => {};
    try {
      await routes['/api/generate-dongtian']({
        get: () => 'application/x-ndjson',
        body:{ text:'代數', creatorLevel:'國中一年級', questionAmount:'low' }
      }, res);
    } finally { console.error = savedError; }
    assert.equal(res.ended, true);
    assert.deepEqual(res.events.map(e => e.type), ['planning','planned','batch-start','error']);
    assert.equal(res.events.at(-1).httpStatus, 500);
    assert.equal(res.events.some(e => e.type === 'complete'), false);
  } finally { aiRouter.generateJSON = original; }
});

test('progress parser handles network chunks that split JSON lines and streamed errors', async () => {
  const start = ui.indexOf('  async function readDongtianGeneration(');
  const end = ui.indexOf('  async function generateDongtian()', start);
  assert.ok(start > 0 && end > start);
  const context = vm.createContext({ TextDecoder, JSON, Error, String, Number });
  vm.runInContext(ui.slice(start, end), context);
  const readerResponse = (parts) => {
    let i = 0;
    return {
      headers:{ get: () => 'application/x-ndjson; charset=utf-8' },
      body:{ getReader: () => ({
        read: async () => i < parts.length
          ? { value:Buffer.from(parts[i++], 'utf8'), done:false }
          : { done:true },
        releaseLock() {}
      }) }
    };
  };
  const messages = [];
  const data = ' {"type":"planned","total":11,"completed":0}\n{"type":"batch-complete","total":11,"completed":5}\n{"type":"complete","dongtian":{"name":"測試"}}\n';
  const result = await context.readDongtianGeneration(readerResponse([data.slice(0,28),data.slice(28,92),data.slice(92)]), e => messages.push(e));
  assert.deepEqual(messages.map(e => e.type), ['planned','batch-complete']);
  assert.equal(result.dongtian.name, '測試');
  const broken = '{"type":"planned","total":11}\n{"type":"error","httpStatus":422,"error":"複核未通過"}\n';
  await assert.rejects(context.readDongtianGeneration(readerResponse([broken]), () => {}), e => e.httpStatus === 422 && e.message.includes('複核'));
  await assert.rejects(context.readDongtianGeneration(readerResponse(['{"type":"planned","total":11}\n']), () => {}), /中斷/);
});

test('creation view shows real generated counts, review and committed save separately', () => {
  assert.match(ui, /id="dt-generate-progress"/);
  assert.match(ui, /role="progressbar" aria-label="已生成題目"/);
  assert.match(ui, /'Accept': 'application\/x-ndjson'/);
  assert.match(ui, /event\.type === 'batch-complete'/);
  assert.match(ui, /event\.type === 'review'/);
  assert.ok(ui.indexOf("setProgress('題目複核完成，正在儲存洞天'") < ui.indexOf('await saveGeneratedDongtian('));
  assert.ok(ui.indexOf('await saveGeneratedDongtian(') < ui.indexOf("setProgress('洞天建立完成'"));
});
