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

test('AI router mixes Gemini and arbitrary OpenAI-compatible providers', () => {
  withEnv({
    GEMINI_API_KEY: 'gemini-key',
    GEMINI_API_KEYS: '',
    GEMINI_MODEL: 'gemini-test',
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

test('router safely extracts JSON from fenced or prefixed model output', () => {
  assert.equal(router.extractJsonText('```json\n{"ok":true}\n```'), '{"ok":true}');
  assert.equal(router.extractJsonText('Answer: {"ok":true} done'), '{"ok":true}');
});

test('all server AI features use the shared router and expose safe status metadata', () => {
  assert.match(server, /const aiRouter = require\('\.\/ai-router'\);/);
  assert.match(server, /app\.get\('\/api\/ai-status'/);
  assert.match(server, /aiRouter\.getStatus\(\)/);
  assert.ok((server.match(/aiRouter\.generateJSON\(/g) || []).length >= 3);
  assert.doesNotMatch(server, /model\.generateContent\(/);
  assert.doesNotMatch(server, /GoogleGenerativeAI/);
});
