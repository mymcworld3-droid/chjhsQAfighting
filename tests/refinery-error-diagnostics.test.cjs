'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Errors = require('../public/cultivation/refinery-errors.js');
const register = require('../artifact-generation-api.js');
const router = require('../ai-router.js');
const source = fs.readFileSync(require.resolve('../public/cultivation/refinery-ai-jobs.js'), 'utf8');

test('refinery diagnostics distinguish AI quota, auth, timeout, format, data quota and commit permission failures', () => {
  for (const [error, stage, expected] of [
    [{ message: 'No AI provider configured' }, 'generation', 'refinery-ai-config'],
    [{ message: 'HTTP 401' }, 'generation', 'refinery-ai-auth'],
    [{ message: 'HTTP 403' }, 'generation', 'refinery-ai-auth'],
    [{ httpStatus: 404, message: 'model missing' }, 'generation', 'refinery-ai-model'],
    [{ httpStatus: 400 }, 'generation', 'refinery-ai-request'],
    [{ message: 'SAFETY content blocked' }, 'generation', 'refinery-ai-blocked'],
    [{ message: 'HTTP 429 quota exceeded' }, 'generation', 'refinery-ai-quota'],
    [{ code: 'resource-exhausted' }, 'generation', 'refinery-ai-quota'],
    [{ code: 'resource-exhausted' }, 'catalog-commit', 'refinery-data-quota'],
    [{ message: 'AI request timeout' }, 'generation', 'refinery-ai-timeout'],
    [new SyntaxError('Unexpected token in JSON'), 'generation', 'refinery-ai-json'],
    [{ message: 'fetch failed' }, 'generation', 'refinery-ai-network'],
    [{ httpStatus: 503, message: 'HTTP 503' }, 'generation', 'refinery-ai-service'],
    [{ code: 'permission-denied' }, 'catalog-commit', 'refinery-save-permission'],
    [{ code: 'unavailable' }, 'catalog-read', 'refinery-data-unavailable'],
    [{ message: '本命法寶屬性已達上限，無法保證逐項提升' }, 'artifact-validation', 'refinery-refinement'],
    [{ message: '煉器任務已變更，請重新整理' }, 'catalog-read', 'refinery-job']
  ]) assert.equal(Errors.classify(error, stage), expected);
});
test('permission errors preserve jobs; ambiguous commits require resynchronization; image failures keep awarded items', () => {
  const permission = Errors.describe({ code: 'permission-denied', refineryStage: 'catalog-commit' }, { jobId: 'job-1' });
  assert.equal(permission.outcome, 'preserved'); assert.equal(permission.retryable, false);
  assert.match(permission.title, /生成已完成.*存檔權限/);
  assert.equal(Errors.describe({ code: 'unavailable', refineryStage: 'catalog-commit' }).outcome, 'unknown');
  assert.match(Errors.notice(Errors.describe({ code: 'unavailable', refineryStage: 'catalog-commit' })), /勿重新投入材料/);
  const image = Errors.describe(Error('fetch failed'), { phase: 'image' });
  assert.equal(image.code, 'refinery-image'); assert.equal(image.outcome, 'awarded');
  const synced = Errors.describe({ message: 'render failed', refineryStage: 'client-sync', refineryAwarded: true });
  assert.equal(synced.code, 'refinery-client-sync'); assert.equal(synced.outcome, 'awarded');
  assert.equal(Errors.describe({ code: 'refinery-ai-quota', refineryStage: 'generation' }).outcome, 'preserved');
});
test('reports redact credentials and cap diagnostic text without rendering HTML', () => {
  const report = Errors.describe({ message: 'Bearer secret-token https://service.test?key=hidden-key&x=1 api_key=hidden-again',
    cause: Error('access_token=another-secret'), attempts: Array(30).fill({ provider: 'test', model: 'model', code: 'refinery-ai-quota' }) });
  assert.doesNotMatch(JSON.stringify(report), /secret-token|hidden-key|hidden-again|another-secret/);
  assert.equal(report.attempts.length, 12);
  assert.equal(Errors.clean('a'.repeat(1000)).length, 500);
});
function client(fetch) {
  const timers = new Map(); let timerId = 0;
  const context = { Date, Math, AbortController, fetch, window: {}, QARefineryErrors: Errors,
    apiMaterials: () => [], apiArtifacts: () => [], SUPPORTED_ARTIFACT_EFFECTS: [],
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  const errorFunction = source.slice(source.indexOf('  function generationError('), source.indexOf('  async function ensureGeneratedArtifactImage('));
  const generate = source.slice(source.indexOf('  async function generateCandidate('), source.indexOf('  function uniqueGeneratedId('));
  vm.runInNewContext(errorFunction + generate + '\nthis.generate = generateCandidate;', context);
  return { generate: () => context.generate({ ingredients: [], targetRealm: '築基' }), timers };
}
test('client preserves structured server errors and correlation IDs, distinguishing a missing artifact from an HTTP error', async () => {
  const app = client(async () => ({ ok: false, status: 429, json: async () => ({ code: 'refinery-ai-quota', error: '推演服務額度或頻率受限', stage: 'generation', requestId: 'trace-1234', attempts: [{ code: 'refinery-ai-quota' }] }) }));
  await assert.rejects(app.generate(), error => error.code === 'refinery-ai-quota' && error.httpStatus === 429 && error.requestId === 'trace-1234' && error.refineryStage === 'generation');
  assert.equal(app.timers.size, 0);
  await assert.rejects(client(async () => ({ ok: true, status: 200, json: async () => ({}) })).generate(), error => error.code === 'refinery-ai-artifact');
  await assert.rejects(client(async () => ({ ok: false, status: 404, json: async () => ({}) })).generate(), error => error.code === 'refinery-api-route');
  await assert.rejects(client(async () => ({ ok: false, status: 502, json: async () => { throw SyntaxError('HTML error page'); } })).generate(), error => error.code === 'refinery-api-invalid-response' && error.httpStatus === 502);
});
test('client watchdog covers stalled response bodies and does not misclassify an abort as a network error', async () => {
  let signal;
  const app = client(async (_url, init) => { signal = init.signal; return { ok: true, status: 200, json: () => new Promise(() => {}) }; });
  const pending = app.generate(); await new Promise(resolve => setImmediate(resolve));
  [...app.timers.values()][0]();
  await assert.rejects(pending, error => error.code === 'refinery-api-timeout');
  assert.equal(signal.aborted, true); assert.equal(app.timers.size, 0);
});
test('artifact API returns safe structured failures with request IDs for input, AI and validation stages', async () => {
  let handler;
  register({ get() {}, post(_route, fn) { handler = fn; } });
  const original = router.generateJSON, log = console.error;
  console.error = () => {};
  const call = async (body) => {
    const response = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; } };
    await handler({ body, get: () => 'trace-client-123' }, response); return response;
  };
  const bound = require('../public/cultivation/soulbound-pool.js').ITEMS[0];
  const body = { selectedIngredients: [{ id:bound.id, type:'artifact', quantity:1 }, { id:'iron', type:'material', quantity:1 }], existingArtifacts:[bound], allMaterials:[{ id:'iron', name:'鐵', realm:'築基' }] };
  try {
    let result = await call({}); assert.equal(result.code, 400); assert.equal(result.data.code, 'refinery-input');
    assert.equal(result.data.requestId, 'trace-client-123'); assert.equal(result.data.stage, 'request-validation');
    router.generateJSON = async () => { throw Object.assign(Error('PRIVATE UPSTREAM BODY Bearer private-key'), { code: 'refinery-ai-auth', attempts: [{ provider: 'test', model: 'm', code: 'refinery-ai-auth', httpStatus: 401 }] }); };
    result = await call(body);
    assert.equal(result.code, 502); assert.equal(result.data.code, 'refinery-ai-auth');
    assert.equal(result.data.attempts[0].httpStatus, 401); assert.doesNotMatch(JSON.stringify(result.data), /PRIVATE UPSTREAM|private-key/);
    router.generateJSON = async (_prompt, options) => { options.validate({}); return { data: {} }; };
    result = await call(body); assert.equal(result.data.code, 'refinery-ai-artifact');
  } finally { router.generateJSON = original; console.error = log; }
});
test('AI fallback preserves distinct provider errors and does not leak upstream credentials', async () => {
  const names = ['GEMINI_API_KEY', 'GEMINI_API_KEYS', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'AI_PROVIDERS_JSON'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const fetch = global.fetch, warn = console.warn;
  for (const name of names) delete process.env[name];
  process.env.AI_PROVIDERS_JSON = JSON.stringify([
    { name: 'auth', baseUrl: 'https://auth.test/v1', apiKey: 'private-auth-key', model: 'a' },
    { name: 'quota', baseUrl: 'https://quota.test/v1', apiKey: 'private-quota-key', model: 'q' }
  ]);
  global.fetch = async url => ({ ok: false, status: url.includes('auth.test') ? 401 : 429, text: async () => 'Bearer secret-token private-auth-key private-quota-key' });
  console.warn = () => {};
  try {
    await assert.rejects(router.generateJSON('TEST PROMPT MUST NOT BE LOGGED'), error => {
      assert.equal(error.code, 'refinery-ai-mixed');
      assert.deepEqual(error.attempts.map(row => row.code).sort(), ['refinery-ai-auth', 'refinery-ai-quota']);
      assert.doesNotMatch(JSON.stringify(Errors.describe(error, { phase: 'generation' })), /private-auth-key|private-quota-key|secret-token|TEST PROMPT/);
      return true;
    });
  } finally {
    global.fetch = fetch; console.warn = warn;
    for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
  }
});
