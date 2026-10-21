const { GoogleGenerativeAI } = require('@google/generative-ai');
const refineryErrors = require('./public/cultivation/refinery-errors.js');

const DEFAULT_TIMEOUT_MS = Math.max(3000, Number(process.env.AI_TIMEOUT_MS) || 25000);
let roundRobinCursor = 0;
const recentAttempts = [];
const MAX_RECENT_ATTEMPTS = 24;

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

async function callGemini(provider, prompt) {
  const genAI = new GoogleGenerativeAI(provider.key);
  const model = genAI.getGenerativeModel({
    model: provider.model,
    generationConfig: { responseMimeType: 'application/json' }
  });
  // Google SDK version used by this project does not accept AbortSignal here,
  // so timeout is enforced by racing the promise at the router level.
  const result = await model.generateContent(prompt);
  return result.response.text();
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
    return withDeadline(callGemini(provider, prompt), timeoutMs);
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

// Concurrent quiz providers race to return the first syntactically valid JSON.
// If the first wave fails, preserve the existing sequential provider fallback.
// Requests use the same prompt; server-side quiz integrity checks still run.
async function generateJSON(prompt, options = {}) {
  const providers = buildProviders();
  if (!providers.length) {
    throw Object.assign(new Error('No AI provider configured. Set GEMINI_API_KEY(S) or AI_PROVIDERS_JSON.'), { code: 'refinery-ai-config', attempts: [] });
  }
  const timeoutMs = Math.max(3000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const ordered = orderedProviders(providers);
  const errors = [];
  const attempts = [];
  const attempt = async (provider, index = 0) => {
    const started = Date.now();
    try {
      const candidatePrompt = typeof options.promptForProvider === 'function' ? options.promptForProvider(prompt, index) : prompt;
      const raw = await callProvider(provider, candidatePrompt, timeoutMs);
      const text = extractJsonText(raw);
      const data = JSON.parse(text);
      if (typeof options.validate === 'function') options.validate(data);
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
  const requested = options.parallel === true ? 3 : 1;
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
      return await Promise.any(wave.map((provider, index) => attempt(provider, index).then(collect)));
    } catch (_) {
      // All parallel attempts failed; remaining providers still get a chance.
    }
  } else if (wave.length === 1) {
    try { return collect(await attempt(wave[0], 0)); } catch (_) { /* retry other providers */ }
  }
  const attempted = new Set(wave);
  for (const [index, provider] of ordered.entries()) {
    if (attempted.has(provider)) continue;
    try { return collect(await attempt(provider, index)); } catch (_) { /* continue fallback */ }
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
  withDeadline
};
