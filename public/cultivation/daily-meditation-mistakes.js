// 從既有答題紀錄建立錯題池：問道、洞天與先前閉關都使用同一份 exam_logs。
// logs 須由 timestamp desc 查詢；跳題、缺少選項／答案的舊資料不得補造題目。
function normalizeQuestion(row, source) {
  if (!row || typeof row !== 'object') return null;
  const q = String(row.q ?? row.question ?? '').trim();
  const opts = row.opts ?? row.options;
  const ans = Number(row.ans ?? row.correctIdx);
  const userIdx = Number(row.userIdx);
  if (!q || !Array.isArray(opts) || opts.length < 2 || opts.length > 8 ||
      opts.some(option => typeof option !== 'string' || !option.trim()) ||
      !Number.isInteger(ans) || ans < 0 || ans >= opts.length ||
      !Number.isInteger(userIdx) || userIdx < 0 || userIdx >= opts.length) return null;
  const options = opts.map(option => option.trim());
  if (new Set(options).size !== options.length) return null;
  return {
    key: q.replace(/\s+/g, ' ').toLowerCase(),
    data: { q, opts: options, ans, exp: String(row.exp ?? row.explanation ?? '') },
    source
  };
}

export function buildMeditationMistakePool(logs) {
  const latest = new Map();
  for (const log of Array.isArray(logs) ? logs : []) {
    const mode = String(log?.mode || '');
    const entries = mode === 'dongtian'
      ? log.dongtianAnswers
      : mode === 'daily-meditation'
        ? log.dailyMeditationAnswers
        : [log];
    if (!Array.isArray(entries)) continue;
    // 相同筆紀錄中，最後一題優先，保持由新到舊的順序。
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      const source = mode === 'dongtian' ? '洞天錯題' : mode === 'daily-meditation' ? '閉關錯題' : '問道錯題';
      const question = normalizeQuestion(entry, source);
      if (!question) continue;
      let state = latest.get(question.key);
      if (!state) {
        state = { lastCorrect: entry.isCorrect === true, mistake: null, wrongCount: 0 };
        latest.set(question.key, state);
      }
      if (entry.isCorrect === false) {
        state.wrongCount += 1;
        if (!state.mistake) state.mistake = question;
      }
    }
  }
  const unresolved = [];
  const reviewed = [];
  for (const item of latest.values()) {
    if (!item.mistake) continue; // 從未答錯過的題目不能混進錯題池。
    const question = { ...item.mistake, wrongCount: item.wrongCount };
    (item.lastCorrect ? reviewed : unresolved).push(question);
  }
  return { unresolved, reviewed, total: unresolved.length + reviewed.length };
}

// 優先抽尚未訂正的錯題；不足時才使用已經重新答對過的歷史錯題。
export function chooseMeditationMistakes(pool, count = 3, random = Math.random) {
  const chosen = [];
  for (const group of [pool?.unresolved || [], pool?.reviewed || []]) {
    const available = group.slice(0, 30);
    // Fisher–Yates，以便不同日的閉關不必總是同一批題目。
    for (let i = available.length - 1; i > 0; i -= 1) {
      const j = Math.min(i, Math.max(0, Math.floor(Number(random()) * (i + 1))));
      [available[i], available[j]] = [available[j], available[i]];
    }
    for (const question of available) {
      if (chosen.length >= count) break;
      if (!chosen.some(entry => entry.key === question.key)) chosen.push(question);
    }
    if (chosen.length >= count) break;
  }
  return chosen;
}
