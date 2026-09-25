// 單人練習待答題庫：保留目前帳號／範圍的待答題，並保留最近已看過題目用於去重。
// v2 仍沿用原本 localStorage key，會自動相容 v1 資料。
export const SOLO_QUESTION_CACHE_KEY = 'xiuxian:solo-unanswered:v1';
const HISTORY_LIMIT = 80;

function normalizedFingerprint(value, ignoreNumbers = false) {
  let text = String(value ?? '').toLowerCase()
    .replace(/\\[a-z]+/g, ' ')
    .replace(/[{}$^_=+×÷*\/\\]/g, ' ')
    .replace(/[，。！？；：、,.!?;:「」『』（）()\[\]<>]/g, '')
    .replace(/\s+/g, '');
  if (ignoreNumbers) {
    text = text
      .replace(/[-+]?\d+(?:\.\d+)?/g, '#')
      .replace(/[一二三四五六七八九十百千萬億兩〇零]+/g, '#');
  }
  return text;
}

function structuralSimilarity(a, b) {
  const A = normalizedFingerprint(a, true);
  const B = normalizedFingerprint(b, true);
  if (A.length < 12 || B.length < 12) return 0;
  if (A === B) return 1;

  const grams = (text) => {
    const set = new Set();
    for (let i = 0; i <= text.length - 3; i++) set.add(text.slice(i, i + 3));
    return set;
  };
  const left = grams(A);
  const right = grams(B);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const gram of left) if (right.has(gram)) overlap++;
  return (2 * overlap) / (left.size + right.size);
}

function structuralDuplicate(a, b) {
  if (!a || !b) return false;
  const exactA = normalizedFingerprint(a);
  const exactB = normalizedFingerprint(b);
  if (exactA && exactA === exactB) return true;
  return structuralSimilarity(a, b) >= 0.80;
}

function compactMeta(item) {
  const q = item?.data?.q || item?.q || item?.question || '';
  return {
    q: String(q).slice(0, 500),
    concept_id: String(item?.meta?.concept_id || item?.concept_id || '').slice(0, 100),
    template_id: String(item?.meta?.template_id || item?.template_id || '').slice(0, 120),
    question_form: String(item?.meta?.question_form || item?.question_form || '').slice(0, 60),
    cognitive_level: Math.max(1, Math.min(5, Number(item?.meta?.cognitive_level || item?.cognitive_level) || 1)),
    reasoning_steps: Math.max(1, Math.min(6, Number(item?.meta?.reasoning_steps || item?.reasoning_steps) || 1))
  };
}

export function createSoloQuestionCache(storage) {
  let uid = '';
  let scope = '';
  let active = null;
  let queue = [];
  let history = [];
  let persistent = true;

  function validQuestion(item) {
    const q = item?.data;
    return item && typeof item === 'object' &&
      typeof q?.q === 'string' && q.q.length > 0 &&
      Array.isArray(q.opts) && q.opts.length >= 2 &&
      Number.isInteger(q.ans) && q.ans >= 0 && q.ans < q.opts.length &&
      typeof item.rank === 'string' && typeof item.badge === 'string';
  }

  function validHistory(item) {
    return item && typeof item === 'object' && typeof item.q === 'string' && item.q.trim().length > 0;
  }

  function safeRead() {
    try {
      const raw = storage?.getItem(SOLO_QUESTION_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      persistent = false;
      return null;
    }
  }

  function save() {
    if (!uid || !scope) return;
    try {
      storage?.setItem(SOLO_QUESTION_CACHE_KEY, JSON.stringify({
        version: 2, uid, scope, active, queue, history: history.slice(-HISTORY_LIMIT)
      }));
      persistent = !!storage;
    } catch (_) {
      persistent = false;
    }
  }

  function activate(nextUid, nextScope) {
    const identity = String(nextUid || '');
    const range = String(nextScope || '');
    if (!identity || !range) {
      uid = '';
      scope = '';
      active = null;
      queue = [];
      history = [];
      return false;
    }
    if (uid === identity && scope === range) return true;

    const stored = safeRead();
    uid = identity;
    scope = range;
    if ((stored?.version === 1 || stored?.version === 2) && stored.uid === uid && stored.scope === scope) {
      active = validQuestion(stored.active) ? stored.active : null;
      queue = Array.isArray(stored.queue) ? stored.queue.filter(validQuestion) : [];
      history = stored.version === 2 && Array.isArray(stored.history)
        ? stored.history.filter(validHistory).slice(-HISTORY_LIMIT)
        : [];
    } else {
      // 只保存目前作用中的帳號／範圍，切換範圍時不沿用舊範圍歷史。
      active = null;
      queue = [];
      history = [];
    }
    save();
    return true;
  }

  function getActive() { return active; }
  function getQueue() { return queue.slice(); }
  function getHistory() { return history.slice(); }
  function pendingCount() { return queue.length + (active ? 1 : 0); }
  function isPersistent() { return persistent; }
  function isCurrent(checkUid, checkScope) {
    return uid === checkUid && scope === checkScope && !!uid;
  }

  function isDuplicate(question) {
    if (!validQuestion(question)) return true;
    const text = question.data.q;
    const candidates = [
      active?.data?.q,
      ...queue.map(item => item?.data?.q),
      ...history.map(item => item?.q)
    ].filter(Boolean);
    return candidates.some(old => structuralDuplicate(text, old));
  }

  function append(question) {
    if (!uid || !scope || !validQuestion(question) || isDuplicate(question)) return false;
    queue.push(question);
    save();
    return true;
  }

  function takeNext() {
    if (active) return active;
    active = queue.shift() || null;
    save();
    return active;
  }

  function setActive(question) {
    if (!uid || !scope || !validQuestion(question) || isDuplicate(question)) return false;
    active = question;
    save();
    return true;
  }

  function remember(question) {
    const item = compactMeta(question);
    if (!item.q) return false;

    // 同一道或只換數字的題目只保留最近一次，避免歷史被同型題灌滿。
    history = history.filter(old => !structuralDuplicate(old.q, item.q));
    history.push(item);
    history = history.slice(-HISTORY_LIMIT);
    save();
    return true;
  }

  function consumeActive({ remember: shouldRemember = false } = {}) {
    if (!active) return false;
    if (shouldRemember) remember(active);
    active = null;
    save();
    return true;
  }

  return {
    activate, getActive, getQueue, getHistory, pendingCount, isPersistent,
    isCurrent, isDuplicate, append, takeNext, setActive, remember, consumeActive
  };
}
