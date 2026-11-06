const refineryErrors = require('./public/cultivation/refinery-errors.js');

const DEFAULT_TIMEOUT_MS = Math.max(3000, Number(process.env.AI_TIMEOUT_MS) || 90000);
let roundRobinCursor = 0;
const recentAttempts = [];
const MAX_RECENT_ATTEMPTS = 24;

const GEMINI_LITE_MODELS = Object.freeze(['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
const GEMINI_FLASH_MODELS = Object.freeze(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3-flash', 'gemini-2.5-flash']);
const TASK_MODELS = Object.freeze({
  'quiz-generate': GEMINI_LITE_MODELS,
  'quiz-review': [...GEMINI_LITE_MODELS].reverse(),
  'quiz-escalate': GEMINI_FLASH_MODELS,
  'question-helper': GEMINI_LITE_MODELS,
  'appeal-review': [...GEMINI_LITE_MODELS].reverse(),
  'appeal-confirm': GEMINI_FLASH_MODELS,
  'dongtian-plan': GEMINI_LITE_MODELS,
  'dongtian-generate': GEMINI_LITE_MODELS,
  'dongtian-review': [...GEMINI_LITE_MODELS].reverse(),
  'dongtian-repair': GEMINI_LITE_MODELS,
  'dongtian-escalate': GEMINI_FLASH_MODELS,
  general: GEMINI_LITE_MODELS
});
let taskCursor = 0;
const geminiUsage = new Map();
const geminiCooldowns = new Map();
const GEMINI_QUOTA_COOLDOWN_MS = 30 * 60 * 1000;

// Request-based budgets, not tokens. Optional per-model daily caps can be set
// as AI_GEMINI_RPD_LIMITS_JSON. The underlying Google quota is per project;
// this process-local guard is a best-effort extra ceiling, never an authority
// for quotas across multiple Render instances or keys in the same project.
function getModelDailyLimit(model) {
  const config = safeJsonParse(process.env.AI_GEMINI_RPD_LIMITS_JSON || '{}', {});
  const n = Number(config && config[model]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function geminiQuotaKey(provider) {
  return provider.model + '\n' + provider.key;
}
function isGeminiAvailable(provider) {
  const quotaKey = geminiQuotaKey(provider);
  if ((geminiCooldowns.get(quotaKey) || 0) > Date.now()) return false;
  const entry = geminiUsage.get(quotaKey);
  const date = new Date().toISOString().slice(0, 10);
  const limit = getModelDailyLimit(provider.model);
  return !limit || !entry || entry.date !== date || entry.used < limit;
}
function reserveGeminiRequest(provider) {
  if (!isGeminiAvailable(provider)) {
    const error = new Error('Gemini model request quota unavailable: ' + provider.model);
    error.httpStatus = 429;
    error.localQuota = true;
    throw error;
  }
  const key = geminiQuotaKey(provider);
  const date = new Date().toISOString().slice(0, 10);
  const previous = geminiUsage.get(key);
  geminiUsage.set(key, { date, used: previous?.date === date ? previous.used + 1 : 1 });
}
function getGeminiRequestUsage() {
  // No credentials and no per-key secret-derived IDs are exposed.
  const date = new Date().toISOString().slice(0, 10), totals = new Map();
  for (const [key,entry] of geminiUsage) {
    if (entry.date !== date) continue;
    const model = key.split('\n')[0];
    totals.set(model, (totals.get(model) || 0) + entry.used);
  }
  return [...totals].map(([model, requests]) => ({ model, requests }));
}
function geminiKeys() {
  return [...new Set([...splitCsv(process.env.GEMINI_API_KEYS), ...splitCsv(process.env.GEMINI_API_KEY)])];
}

// Every configured Gemini key has the six known models. Task routing intentionally
// does NOT depend on the legacy GEMINI_MODELS list; otherwise an old Render setting
// would prevent access to the Flash review reserve. Ordinary work never consumes
// Flash requests, even when all Flash models are configured on the same key.
function buildTaskProviders(task = 'general', options = {}) {
  const keys = geminiKeys();
  if (!keys.length) return buildOpenAICompatProviders();
  const excluded = new Set(options.excludeModels || []);
  const models = (TASK_MODELS[task] || TASK_MODELS.general).filter(model => !excluded.has(model));
  const first = taskCursor++ % keys.length;
  const orderedKeys = keys.slice(first).concat(keys.slice(0, first));
  const candidates = [];
  // Alternate model before key so each provider wave can use the second Lite
  // even when several keys share the same Google project.
  for (const key of orderedKeys) {
    for (const model of models) {
      const keyIndex = keys.indexOf(key) + 1;
      const provider = { type:'gemini', name:'gemini-' + keyIndex + '-' + model, key, model };
      if (isGeminiAvailable(provider)) candidates.push(provider);
    }
  }
  return candidates;
}


// Diagnostics are in-memory and contain no keys, prompts, user IDs or raw error bodies.
function recordAttempt(provider, outcome, error = null) {
  const statusText = String(error?.message || '');
  const match = statusText.match(/\b(?:HTTP\s*)?(400|401|403|404|408|409|422|429|500|502|503|504)\b/i);
  const httpStatus = match ? Number(match[1]) : null;
  const entry = {
    at: new Date().toISOString(),
    provider: provider.name,
    model: provider.model,
    outcome,
    ...(httpStatus ? { httpStatus } : {})
  };
  recentAttempts.push(entry);
  if (recentAttempts.length > MAX_RECENT_ATTEMPTS) recentAttempts.shift();
  if (provider.type === 'gemini' && httpStatus === 429 && !error?.localQuota) {
    // Fail over to another model/key; never hammer a quota-exhausted endpoint.
    geminiCooldowns.set(geminiQuotaKey(provider), Date.now() + GEMINI_QUOTA_COOLDOWN_MS);
  }
}

function getRecentActivity() {
  return recentAttempts.map((entry) => ({ ...entry }));
}


function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function maskName(value, fallback = 'provider') {
  const text = String(value || fallback).trim();
  return text || fallback;
}

function extractJsonText(raw) {
  const text = String(raw ?? '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const firstObject = text.indexOf('{');
  const firstArray = text.indexOf('[');
  let start = -1;
  if (firstObject === -1) start = firstArray;
  else if (firstArray === -1) start = firstObject;
  else start = Math.min(firstObject, firstArray);
  if (start < 0) throw new Error('AI 回應中未找到 JSON');

  const opener = text[start];
  const closer = opener === '[' ? ']' : '}';
  const end = text.lastIndexOf(closer);
  if (end < start) throw new Error('AI 回應 JSON 結構不完整');
  return text.slice(start, end + 1);
}

function normalizeBaseUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

function buildGeminiProviders() {
  const keys = [...splitCsv(process.env.GEMINI_API_KEYS), ...splitCsv(process.env.GEMINI_API_KEY)];
  const uniqueKeys = [...new Set(keys)];
  // GEMINI_MODELS is preferred. Accept accidental comma-separated legacy
  // GEMINI_MODEL values too, so Render does not send the whole CSV as a model ID.
  const configuredModels = splitCsv(process.env.GEMINI_MODELS);
  const legacyModels = splitCsv(process.env.GEMINI_MODEL);
  const activeModels = [...new Set(configuredModels.length
    ? configuredModels
    : legacyModels.length ? legacyModels : ['gemini-3.5-flash-lite'])];

  return uniqueKeys.flatMap((key, index) => activeModels.map((model, modelIndex) => ({
    type: 'gemini',
    name: activeModels.length === 1
      ? `gemini-${index + 1}`
      : `gemini-${index + 1}-model-${modelIndex + 1}`,
    key,
    model
  })));
}

function buildOpenAICompatProviders() {
  const providers = [];

  // Generic JSON config. Example:
  // AI_PROVIDERS_JSON=[{"name":"groq","type":"openai-compatible","baseUrl":"https://.../v1","apiKey":"...","model":"..."}]
  const configured = safeJsonParse(process.env.AI_PROVIDERS_JSON || '[]', []);
  if (Array.isArray(configured)) {
    for (const item of configured) {
      if (!item || typeof item !== 'object') continue;
      const type = String(item.type || 'openai-compatible').toLowerCase();
      if (!['openai', 'openai-compatible', 'chat-completions'].includes(type)) continue;
      const key = item.apiKey || item.key;
      const baseUrl = normalizeBaseUrl(item.baseUrl || item.baseURL);
      const model = item.model;
      if (!key || !baseUrl || !model) continue;
      providers.push({
        type: 'openai-compatible',
        name: maskName(item.name, `openai-compatible-${providers.length + 1}`),
        key: String(key),
        baseUrl,
        model: String(model),
        headers: item.headers && typeof item.headers === 'object' ? item.headers : {}
      });
    }
  }

  // Convenience single OpenAI-compatible slot. OPENAI_MODEL is required intentionally,
  // so a key alone never silently selects a possibly outdated model name.
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) {
    providers.push({
      type: 'openai-compatible',
      name: 'openai',
      key: process.env.OPENAI_API_KEY,
      baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
      model: process.env.OPENAI_MODEL,
      headers: {}
    });
  }

  return providers;
}

function buildProviders() {
  return [...buildGeminiProviders(), ...buildOpenAICompatProviders()];
}

async function withTimeout(factory, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await factory(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// Use Google's generateContent REST endpoint rather than the legacy JS SDK
// (pinned to 0.2.1), so the HIGH thinking setting is actually sent on every
// Gemini request, including the Dongtian multimodal requests.
function geminiThinkingConfig(model) {
  if (/^gemini-3(?:[.-]|$)/i.test(model)) return { thinkingLevel: 'HIGH' };
  // Gemini 2.5 does not support thinkingLevel. Explicitly select its maximum
  // supported thinking budget rather than silently falling back to its default.
  if (/^gemini-2\.5-pro(?:-|$)/i.test(model)) return { thinkingBudget: 32768 };
  if (/^gemini-2\.5-flash(?:-|$)/i.test(model)) return { thinkingBudget: 24576 };
  throw new Error('Gemini model does not support the enforced HIGH thinking configuration: ' + model);
}

async function requestGeminiHigh(provider, prompt, images = [], options = {}) {
  const model = String(provider.model || '').trim();
  geminiThinkingConfig(model); // Reject unsupported models before spending any requests.
  reserveGeminiRequest(provider);
  const generationConfig = {
    responseMimeType: 'application/json',
    thinkingConfig: geminiThinkingConfig(model)
  };
  if (Number.isInteger(options.maxOutputTokens) && options.maxOutputTokens > 0) {
    generationConfig.maxOutputTokens = options.maxOutputTokens;
  }
  const parts = [
    { text: String(prompt) },
    ...images.map(image => ({
      inlineData: { mimeType: image.mimeType, data: image.data }
    }))
  ];
  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    {
      method: 'POST',
      signal: options.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig
      })
    }
  );
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw Object.assign(new Error('HTTP ' + response.status + (detail ? ': ' + detail : '')), {
      httpStatus: response.status
    });
  }
  const payload = await response.json();
  const candidate = payload?.candidates?.[0];
  const output = (candidate?.content?.parts || [])
    .filter(part => part && !part.thought && typeof part.text === 'string')
    .map(part => part.text).join('');
  if (!output.trim()) {
    throw new Error('Gemini API returned no JSON text (finishReason: ' +
      String(candidate?.finishReason || 'unknown') + ')');
  }
  return output;
}

async function callGemini(provider, prompt, signal) {
  return requestGeminiHigh(provider, prompt, [], { signal });
}

async function callOpenAICompatible(provider, prompt, signal) {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.key}`,
      ...provider.headers
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: 'Return valid JSON only. Do not wrap the response in markdown.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw Object.assign(new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`), { httpStatus: response.status });
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI-compatible API returned no message content');
  return content;
}

async function callProvider(provider, prompt, timeoutMs) {
  if (provider.type === 'gemini') {
    return withTimeout(signal => callGemini(provider, prompt, signal), timeoutMs);
  }
  return withTimeout((signal) => callOpenAICompatible(provider, prompt, signal), timeoutMs);
}

function orderedProviders(providers) {
  if (!providers.length) return [];
  if (String(process.env.AI_PROVIDER_STRATEGY || '').toLowerCase() === 'random') {
    const start = Math.floor(Math.random() * providers.length);
    return providers.slice(start).concat(providers.slice(0, start));
  }
  const start = roundRobinCursor % providers.length;
  roundRobinCursor = (roundRobinCursor + 1) % providers.length;
  return providers.slice(start).concat(providers.slice(0, start));
}

// Upstream errors can echo keys in URLs, headers or JSON bodies. Sanitize before
// recording diagnostics or propagating an error to an HTTP endpoint.
function safeProviderError(error,provider={}) {
  let message=String(error?.message || error || 'AI provider failed');
  const secrets=[provider.key,...Object.entries(provider.headers||{})
    .filter(([name])=>/authorization|api.?key|token|secret/i.test(name)).map(([,value])=>value)];
  for(const secret of secrets){
    if(typeof secret!=='string'||!secret)continue;
    for(const value of new Set([secret,encodeURIComponent(secret)]))message=message.split(value).join('[REDACTED]');
  }
  return message.replace(/(Bearer\s+)[^\s"'<>]+/gi,'$1[REDACTED]')
    .replace(/([?&](?:key|api_key|access_token)=)[^&\s"'<>]+/gi,'$1[REDACTED]').slice(0,500);
}
async function withDeadline(promise,timeoutMs) {
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('AI request timeout')),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}

// Concurrent providers return the first fully validated result. Callers may
// assign a different task to every attempt, including sequential fallbacks.
async function generateJSON(prompt, options = {}) {
  const providers = options.task ? buildTaskProviders(options.task, options) : buildProviders();
  if (!providers.length) {
    throw Object.assign(new Error('No AI provider configured. Set GEMINI_API_KEY(S) or AI_PROVIDERS_JSON.'), { code: 'refinery-ai-config', attempts: [] });
  }
  const timeoutMs = Math.max(3000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const ordered = orderedProviders(providers);
  const errors = [];
  const attempts = [];
  let nextAttemptIndex = 0;
  const attempt = async (provider) => {
    const index = nextAttemptIndex++;
    const started = Date.now();
    try {
      const candidatePrompt = typeof options.promptForProvider === 'function' ? options.promptForProvider(prompt, index) : prompt;
      const raw = await callProvider(provider, candidatePrompt, timeoutMs);
      const text = extractJsonText(raw);
      const data = JSON.parse(text);
      if (typeof options.validate === 'function') options.validate(data, {index, provider:provider.name, model:provider.model});
      recordAttempt(provider, 'success');
      console.log(`[AI Router] ${provider.name}/${provider.model} success`);
      return { data, text, provider: provider.name, model: provider.model };
    } catch (error) {
      recordAttempt(provider, 'failed', error);
      let message = error?.name === 'AbortError' ? 'timeout' : safeProviderError(error,provider);
      // A proxy error may echo more than the active credential. Redact every
      // configured provider key/header before aggregating diagnostics.
      for (const configured of providers) message = safeProviderError({ message }, configured);
      attempts.push({ provider: refineryErrors.clean(provider.name, 60), model: refineryErrors.clean(provider.model, 100),
        code: refineryErrors.classify(error, 'generation'),
        httpStatus: Number(error?.httpStatus || error?.status) || null, elapsedMs: Date.now() - started });
      errors.push(`${provider.name}: ${message}`);
      console.warn(`[AI Router] ${provider.name}/${provider.model} failed: ${message}`);
      throw error;
    }
  };

  // Use distinct credentials in the first wave rather than saturating one
  // Gemini key with multiple models. Cap extra calls to control API spend.
  const requested = options.task ? 1 : options.parallel === true ? 3 : 1;
  const wave = [];
  const seenCredentials = new Set();
  for (const provider of ordered) {
    const credential = provider.type + ':' + provider.key;
    if (wave.length >= requested) break;
    if (seenCredentials.has(credential)) continue;
    wave.push(provider);
    seenCredentials.add(credential);
  }
  // The first fully validated answer goes out immediately. Keep listening to
  // slower providers: their valid unused results are donated to the next quiz.
  let winnerChosen = false;
  const collect = result => {
    if (!winnerChosen) {
      winnerChosen = true;
      try { options.onWinner?.(result); } catch (error) { console.warn('[AI Router] winner callback failed:', error?.message); }
    } else {
      try { options.onSpare?.(result); } catch (error) { console.warn('[AI Router] spare callback failed:', error?.message); }
    }
    return result;
  };
  if (wave.length > 1) {
    try {
      return await Promise.any(wave.map(provider => attempt(provider).then(collect)));
    } catch (_) {
      // All parallel attempts failed; remaining providers still get a chance.
    }
  } else if (wave.length === 1) {
    try { return collect(await attempt(wave[0])); } catch (_) { /* retry other providers */ }
  }
  const attempted = new Set(wave);
  const maxAttempts = options.task ? Math.min(4, ordered.length) : ordered.length;
  for (const provider of ordered) {
    if (attempted.has(provider)) continue;
    if (attempted.size >= maxAttempts) break;
    attempted.add(provider);
    try { return collect(await attempt(provider)); } catch (_) { /* continue fallback */ }
  }
  const codes = new Set(attempts.map(item => item.code));
  throw Object.assign(new Error(`All AI providers failed: ${errors.join(' | ')}`), {
    code: codes.size === 1 ? attempts[0].code : 'refinery-ai-mixed', attempts
  });
}

function getStatus() {
  return buildProviders().map(({ name, type, model }) => ({ name, type, model }));
}

module.exports = {
  generateJSON,
  getStatus,
  extractJsonText,
  buildProviders,
  orderedProviders,
  recordAttempt,
  getRecentActivity,
  safeProviderError,
  withDeadline,
  requestGeminiHigh,
  geminiThinkingConfig,
  buildTaskProviders,
  getGeminiRequestUsage,
  TASK_MODELS
};
