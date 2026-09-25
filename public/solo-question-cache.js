// 單人練習待答題庫＋近期作答歷史。
// 只儲存當前帳號、範圍；換帳號或範圍就捨棄，避免不同範圍互相干擾。
export const SOLO_QUESTION_CACHE_KEY = 'xiuxian:solo-unanswered:v1';

export function createSoloQuestionCache(storage) {
  let uid = '';
  let scope = '';
  let active = null;
  let queue = [];
  let history = [];
  let persistent = true;

  function normalizeText(value) {
    return String(value ?? '').normalize('NFKC').toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[，。！？；：、,.!?;:'"「」『』（）()【】\[\]{}<>]/g, '');
  }

  function questionSkeleton(value) {
    return normalizeText(value)
      .replace(/[-+]?\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?/g, '#')
      .replace(/[a-z][a-z0-9_]*/g, 'v');
  }

  function validQuestion(item) {
    const q = item?.data;
    return item && typeof item === 'object' &&
      typeof q?.q === 'string' && q.q.length > 0 &&
      Array.isArray(q.opts) && q.opts.length >= 2 &&
      Number.isInteger(q.ans) && q.ans >= 0 && q.ans < q.opts.length &&
      typeof item.rank === 'string' && typeof item.badge === 'string';
  }

  function normalizeHistoryEntry(item) {
    if (!item || typeof item !== 'object') return null;
    const q = String(item.q ?? item.data?.q ?? '').trim().slice(0, 220);
    if (!q) return null;
    const meta = item.meta || {};
    return {
      q,
      subject: String(item.subject ?? meta.subject ?? '').trim().slice(0, 40),
      concept_id: String(item.concept_id ?? item.conceptId ?? meta.conceptId ?? meta.concept_id ?? '').trim().slice(0, 100),
      skill_id: String(item.skill_id ?? item.skillId ?? meta.skillId ?? meta.skill_id ?? '').trim().slice(0, 100),
      template_id: String(item.template_id ?? item.templateId ?? meta.templateId ?? meta.template_id ?? '').trim().slice(0, 120),
      question_form: String(item.question_form ?? item.questionForm ?? meta.questionForm ?? meta.question_form ?? '').trim().slice(0, 100),
      cognitive_level: Number(item.cognitive_level ?? item.cognitiveLevel ?? meta.cognitiveLevel ?? 0) || 0
    };
  }

  function snapshotQuestion(item) {
    if (!item) return null;
    if (validQuestion(item)) {
      const meta = item.meta || {};
      return normalizeHistoryEntry({
        q: item.data.q,
        subject: meta.subject,
        conceptId: meta.conceptId,
        skillId: meta.skillId,
        templateId: meta.templateId,
        questionForm: meta.questionForm,
        cognitiveLevel: meta.cognitiveLevel
      });
    }
    return normalizeHistoryEntry(item);
  }

  function isTooSimilar(candidate, previous) {
    const a = snapshotQuestion(candidate);
    const b = snapshotQuestion(previous);
    if (!a || !b) return false;
    if (normalizeText(a.q) === normalizeText(b.q)) return true;
    const aSkeleton = questionSkeleton(a.q);
    const bSkeleton = questionSkeleton(b.q);
    if (aSkeleton.length >= 10 && aSkeleton === bSkeleton) return true;
    if (a.template_id && b.template_id && a.template_id === b.template_id) return true;
    return false;
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
        version: 2, uid, scope, active, queue, history: history.slice(-80)
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
        ? stored.history.map(normalizeHistoryEntry).filter(Boolean).slice(-80)
        : [];
    } else {
      active = null;
      queue = [];
      history = [];
    }
    save();
    return true;
  }

  function getActive() { return active; }
  function getQueue() { return queue.slice(); }
  function getHistory(limit = 60) { return history.slice(-Math.max(1, Number(limit) || 60)); }
  function pendingCount() { return queue.length + (active ? 1 : 0); }
  function isPersistent() { return persistent; }
  function isCurrent(checkUid, checkScope) {
    return uid === checkUid && scope === checkScope && !!uid;
  }

  function getAvoidance(limit = 60) {
    const merged = [
      ...history.slice(-Math.max(1, Number(limit) || 60)),
      snapshotQuestion(active),
      ...queue.map(snapshotQuestion)
    ].filter(Boolean);
    const seen = new Set();
    return merged.filter(item => {
      const key = normalizeText(item.q);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(-Math.max(1, Number(limit) || 60));
  }

  function append(question) {
    if (!uid || !scope || !validQuestion(question)) return false;
    const recent = [
      active,
      ...queue,
      ...history.slice(-60)
    ].filter(Boolean);
    if (recent.some(previous => isTooSimilar(question, previous))) return false;
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
    if (active && active !== question && isTooSimilar(question, active)) return false;
    active = question;
    save();
    return true;
  }

  function remember(question) {
    const snapshot = snapshotQuestion(question);
    if (!snapshot) return false;
    const last = history[history.length - 1];
    if (!last || normalizeText(last.q) !== normalizeText(snapshot.q)) history.push(snapshot);
    history = history.slice(-80);
    save();
    return true;
  }

  function consumeActive() {
    if (!active) return false;
    remember(active);
    active = null;
    save();
    return true;
  }

  return {
    activate, getActive, getQueue, getHistory, getAvoidance,
    pendingCount, isPersistent, isCurrent, append, takeNext, setActive,
    remember, consumeActive
  };
}
