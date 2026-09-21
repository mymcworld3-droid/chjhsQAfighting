// 單人練習待答題庫：僅儲存當前帳號、範圍的題目，換帳號或範圍即捨棄舊題。
// 題目在實際回答或成功跳題之前都保留，包括當前正在看的題目。
export const SOLO_QUESTION_CACHE_KEY = 'xiuxian:solo-unanswered:v1';

export function createSoloQuestionCache(storage) {
  let uid = '';
  let scope = '';
  let active = null;
  let queue = [];
  let persistent = true;

  function validQuestion(item) {
    const q = item?.data;
    return item && typeof item === 'object' &&
      typeof q?.q === 'string' && q.q.length > 0 &&
      Array.isArray(q.opts) && q.opts.length >= 2 &&
      Number.isInteger(q.ans) && q.ans >= 0 && q.ans < q.opts.length &&
      typeof item.rank === 'string' && typeof item.badge === 'string';
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
        version: 1, uid, scope, active, queue
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
      return false;
    }
    if (uid === identity && scope === range) return true;
    const stored = safeRead();
    uid = identity;
    scope = range;
    if (stored?.version === 1 && stored.uid === uid && stored.scope === scope) {
      active = validQuestion(stored.active) ? stored.active : null;
      queue = Array.isArray(stored.queue) ? stored.queue.filter(validQuestion) : [];
    } else {
      // 只允許一份作用中的本機題庫，不保留其他帳號／範圍的題目。
      active = null;
      queue = [];
    }
    save();
    return true;
  }

  function getActive() { return active; }
  function getQueue() { return queue.slice(); }
  function pendingCount() { return queue.length + (active ? 1 : 0); }
  function isPersistent() { return persistent; }
  function isCurrent(checkUid, checkScope) {
    return uid === checkUid && scope === checkScope && !!uid;
  }
  function append(question) {
    if (!uid || !scope || !validQuestion(question)) return false;
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
    if (!uid || !scope || !validQuestion(question)) return false;
    active = question;
    save();
    return true;
  }
  function consumeActive() {
    if (!active) return false;
    active = null;
    save();
    return true;
  }

  return {
    activate, getActive, getQueue, pendingCount, isPersistent,
    isCurrent, append, takeNext, setActive, consumeActive
  };
}
