const { GoogleGenerativeAI } = require('@google/generative-ai');

const DEFAULT_TIMEOUT_MS = Math.max(3000, Number(process.env.AI_TIMEOUT_MS) || 25000);
let roundRobinCursor = 0;

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
  // Model rotation is independent of API keys: one key can use every listed model.
  // Preserve the historical one-provider-per-key behavior when GEMINI_MODELS is unset.
  const models = [...new Set(splitCsv(process.env.GEMINI_MODELS))];
  const fallbackModel = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';
  const activeModels = models.length ? models : [fallbackModel];

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
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI-compatible API returned no message content');
  return content;
}

async function callProvider(provider, prompt, timeoutMs) {
  if (provider.type === 'gemini') {
    return Promise.race([
      callGemini(provider, prompt),
      new Promise((_, reject) => setTimeout(() => reject(new Error('AI request timeout')), timeoutMs))
    ]);
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

async function generateJSON(prompt, options = {}) {
  const providers = buildProviders();
  if (!providers.length) {
    throw new Error('No AI provider configured. Set GEMINI_API_KEY(S) or AI_PROVIDERS_JSON.');
  }

  const timeoutMs = Math.max(3000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const errors = [];
  for (const provider of orderedProviders(providers)) {
    try {
      const raw = await callProvider(provider, prompt, timeoutMs);
      const text = extractJsonText(raw);
      const data = JSON.parse(text);
      console.log(`[AI Router] ${provider.name}/${provider.model} success`);
      return { data, text, provider: provider.name, model: provider.model };
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'timeout' : (error?.message || String(error));
      errors.push(`${provider.name}: ${message}`);
      console.warn(`[AI Router] ${provider.name}/${provider.model} failed: ${message}`);
    }
  }

  throw new Error(`All AI providers failed: ${errors.join(' | ')}`);
}

function getStatus() {
  return buildProviders().map(({ name, type, model }) => ({ name, type, model }));
}

module.exports = {
  generateJSON,
  getStatus,
  extractJsonText,
  buildProviders
};
