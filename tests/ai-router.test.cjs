const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const router = require('../ai-router.js');
const server = readFileSync(join(__dirname, '../server.js'), 'utf8');

function withEnv(values, fn) {
  const old = {};
  for (const [key, value] of Object.entries(values)) {
    old[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return fn(); }
  finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('AI router supports multiple Gemini keys without duplicating the legacy key', () => {
  withEnv({
    GEMINI_API_KEY: 'key-a',
    GEMINI_API_KEYS: 'key-a,key-b,key-c',
    GEMINI_MODEL: 'gemini-test',
    GEMINI_MODELS: undefined,
    AI_PROVIDERS_JSON: '[]',
    OPENAI_API_KEY: undefined,
    OPENAI_MODEL: undefined
  }, () => {
    const providers = router.buildProviders();
    assert.equal(providers.length, 3);
    assert.deepEqual(providers.map(p => p.name), ['gemini-1', 'gemini-2', 'gemini-3']);
    assert.ok(providers.every(p => p.model === 'gemini-test'));
  });
});

test('accidental comma-separated legacy GEMINI_MODEL still activates both models for every key', () => {
  withEnv({
    GEMINI_API_KEY: undefined,
    GEMINI_API_KEYS: 'key-a,key-b,key-c,key-d',
    GEMINI_MODEL: 'gemini-3.5-flash-lite, gemini-3.5-flash-lite,gemini-3.1-flash-lite',
    GEMINI_MODELS: undefined,
    OPENAI_API_KEY: undefined,
    OPENAI_MODEL: undefined,
    AI_PROVIDERS_JSON: '[]'
  }, () => {
    const providers = router.buildProviders();
    assert.equal(providers.length, 8);
    assert.deepEqual(providers.map(p => p.model), [
      'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'
    ]);
    assert.ok(providers.every(p => !p.model.includes(',')));
  });
});

test('one Gemini API key rotates across both Flash-Lite models without duplicate requests', () => {
  withEnv({
    GEMINI_API_KEY: 'one-key',
    GEMINI_API_KEYS: undefined,
    GEMINI_MODEL: 'gemini-3.5-flash-lite',
    GEMINI_MODELS: 'gemini-3.5-flash-lite,gemini-3.1-flash-lite',
    AI_PROVIDERS_JSON: '[]',
    OPENAI_API_KEY: undefined,
    OPENAI_MODEL: undefined
  }, () => {
    const providers = router.buildProviders();
    assert.equal(providers.length, 2);
    assert.deepEqual(providers.map(p => p.model), [
      'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'
    ]);
    assert.deepEqual(providers.map(p => p.name), ['gemini-1-model-1', 'gemini-1-model-2']);
    assert.ok(providers.every(p => p.key === 'one-key'));
    assert.deepEqual(router.getStatus(), providers.map(({ name, type, model }) => ({ name, type, model })));
    assert.ok(router.getStatus().every(p => !Object.hasOwn(p, 'key')));
  });
});

test('multiple keys share both models and duplicate model IDs are deduplicated', () => {
  withEnv({
    GEMINI_API_KEY: 'key-a',
    GEMINI_API_KEYS: 'key-a,key-b',
    GEMINI_MODEL: 'unused-fallback',
    GEMINI_MODELS: 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.5-flash-lite',
    AI_PROVIDERS_JSON: '[]',
    OPENAI_API_KEY: undefined,
    OPENAI_MODEL: undefined
  }, () => {
    const providers = router.buildProviders();
    assert.equal(providers.length, 4);
    assert.deepEqual(providers.map(p => p.model), [
      'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'
    ]);
    assert.deepEqual(providers.map(p => p.name), [
      'gemini-1-model-1', 'gemini-1-model-2', 'gemini-2-model-1', 'gemini-2-model-2'
    ]);
  });
});

test('AI router mixes Gemini and arbitrary OpenAI-compatible providers', () => {
  withEnv({
    GEMINI_API_KEY: 'gemini-key',
    GEMINI_API_KEYS: '',
    GEMINI_MODEL: 'gemini-test',
    GEMINI_MODELS: undefined,
    OPENAI_API_KEY: 'openai-key',
    OPENAI_MODEL: 'openai-test',
    OPENAI_BASE_URL: 'https://api.example.com/v1/',
    AI_PROVIDERS_JSON: JSON.stringify([
      { name: 'fast-a', type: 'openai-compatible', baseUrl: 'https://one.example/v1', apiKey: 'a', model: 'model-a' },
      { name: 'fast-b', type: 'openai-compatible', baseUrl: 'https://two.example/v1', apiKey: 'b', model: 'model-b' }
    ])
  }, () => {
    const providers = router.buildProviders();
    assert.deepEqual(providers.map(p => p.name), ['gemini-1', 'fast-a', 'fast-b', 'openai']);
    assert.equal(providers.at(-1).baseUrl, 'https://api.example.com/v1');
  });
});

test('round-robin routes across Gemini models, not just API keys', () => {
  withEnv({
    GEMINI_API_KEY: 'only-key',
    GEMINI_API_KEYS: undefined,
    GEMINI_MODELS: 'gemini-3.5-flash-lite,gemini-3.1-flash-lite',
    AI_PROVIDER_STRATEGY: 'round-robin',
    OPENAI_API_KEY: undefined,
    OPENAI_MODEL: undefined,
    AI_PROVIDERS_JSON: '[]'
  }, () => {
    const providers = router.buildProviders();
    const first = router.orderedProviders(providers);
    const second = router.orderedProviders(providers);
    assert.notEqual(first[0].model, second[0].model);
    assert.deepEqual(new Set(providers.map(p => p.model)), new Set([
      'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'
    ]));
  });
});

test('recent model activity includes successes and sanitized HTTP failures without credentials', () => {
  const provider = { name: 'gemini-1-model-2', model: 'gemini-3.1-flash-lite', key: 'PRIVATE_KEY' };
  router.recordAttempt(provider, 'failed', new Error('HTTP 429: PRIVATE_ERROR_BODY'));
  router.recordAttempt(provider, 'success');
  const recent = router.getRecentActivity();
  assert.deepEqual(recent.slice(-2).map(x => x.outcome), ['failed', 'success']);
  assert.equal(recent.at(-2).httpStatus, 429);
  assert.equal(recent.at(-1).model, 'gemini-3.1-flash-lite');
  assert.doesNotMatch(JSON.stringify(recent), /PRIVATE_KEY|PRIVATE_ERROR_BODY/);
  const changed = router.getRecentActivity();
  changed.at(-1).outcome = 'mutated';
  assert.equal(router.getRecentActivity().at(-1).outcome, 'success');
});

test('Dongtian multimodal generation shares the same rotation and records actual attempts', () => {
  const dongtian = readFileSync(join(__dirname, '../dongtian-api.js'), 'utf8');
  assert.match(dongtian, /aiRouter\.orderedProviders\(aiRouter\.buildProviders\(\)\)/);
  assert.match(dongtian, /aiRouter\.recordAttempt\(provider, 'success'\)/);
  assert.match(dongtian, /aiRouter\.recordAttempt\(provider, 'failed', error\)/);
  assert.match(server, /recent: aiRouter\.getRecentActivity\(\)/);
  assert.match(server, /provider: routed\.provider, model: routed\.model/);
});

test('router safely extracts JSON from fenced or prefixed model output', () => {
  assert.equal(router.extractJsonText('```json\n{"ok":true}\n```'), '{"ok":true}');
  assert.equal(router.extractJsonText('Answer: {"ok":true} done'), '{"ok":true}');
});

test('all server AI features use the shared router and expose safe status metadata', () => {
  assert.match(server, /const aiRouter = require\('\.\/ai-router'\);/);
  assert.match(server, /app\.get\('\/api\/ai-status'/);
  assert.match(server, /aiRouter\.getStatus\(\)/);
  const report = readFileSync(join(__dirname, '../question-report-api.cjs'), 'utf8');
  assert.ok((server.match(/aiRouter\.generateJSON\(/g) || []).length >= 2);
  assert.match(report, /generate = aiRouter\.generateJSON/);
  assert.doesNotMatch(server, /model\.generateContent\(/);
  assert.doesNotMatch(server, /GoogleGenerativeAI/);
});


test('Gemini 3.1/3.5 text and image requests explicitly send HIGH thinking', async () => {
  const oldFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, request) => {
    requests.push({ url, request });
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"accepted":true}' }] } }]
      })
    };
  };
  try {
    assert.equal(
      await router.requestGeminiHigh({ key: 'test-key', model: 'gemini-3.1-flash-lite' }, 'Audit this question'),
      '{"accepted":true}'
    );
    assert.equal(
      await router.requestGeminiHigh(
        { key: 'test-key', model: 'gemini-3.5-flash-lite' },
        'Read the image',
        [{ mimeType: 'image/png', data: 'YWJj' }],
        { maxOutputTokens: 32768 }
      ),
      '{"accepted":true}'
    );
  } finally {
    global.fetch = oldFetch;
  }
  assert.equal(requests.length, 2);
  for (const { url, request } of requests) {
    assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['x-goog-api-key'], 'test-key');
    const body = JSON.parse(request.body);
    assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'HIGH' });
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.contents[0].role, 'user');
  }
  const multimodal = JSON.parse(requests[1].request.body);
  assert.deepEqual(multimodal.contents[0].parts[1], {
    inlineData: { mimeType: 'image/png', data: 'YWJj' }
  });
  assert.equal(multimodal.generationConfig.maxOutputTokens, 32768);
});

test('Gemini 2.5 receives maximum reasoning budget, not unsupported thinkingLevel', () => {
  assert.deepEqual(router.geminiThinkingConfig('gemini-2.5-flash'), { thinkingBudget: 24576 });
  assert.deepEqual(router.geminiThinkingConfig('gemini-2.5-pro'), { thinkingBudget: 32768 });
  assert.throws(() => router.geminiThinkingConfig('gemini-2.0-flash'), /does not support/i);
});

test('Gemini HIGH requests reject missing answers instead of treating them as valid', async () => {
  const oldFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] })
  });
  try {
    await assert.rejects(router.requestGeminiHigh({
      key: 'test-key',
      model: 'gemini-3.1-flash-lite'
    }, 'Please answer'), /no JSON text/i);
  } finally {
    global.fetch = oldFetch;
  }
});
