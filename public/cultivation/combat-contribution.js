// Shared whole-match presentation counters; no damage or reward rules live here.
(function (root) {
  'use strict';
  const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  function normalize(raw) {
    return { version:1, partial:raw?.partial === true, rounds:count(raw?.rounds), comboHits:count(raw?.comboHits),
      comboDamage:count(raw?.comboDamage), reflectedDamage:count(raw?.reflectedDamage), criticalHits:count(raw?.criticalHits) };
  }
  function add(raw, changes) {
    const next = normalize(raw);
    for (const key of Object.keys(next)) if (!['version','partial'].includes(key)) next[key] += count(changes?.[key]);
    return next;
  }
  function battleRound(previous, outcome) {
    const result = { host:normalize(previous?.host), guest:normalize(previous?.guest) };
    const hp = { host:count(outcome.startHostHp), guest:count(outcome.startGuestHp) };
    for (const step of outcome.steps || []) {
      const actor = step.actorRole, target = actor === 'host' ? 'guest' : 'host';
      const nextHp = { host:count(step.hostHp ?? hp.host), guest:count(step.guestHp ?? hp.guest) };
      if (result[actor] && step.guarded !== true && count(step.damage) > 0) {
        // HP deltas avoid crediting overkill, blocked hits or duplicated reveal steps.
        const dealt = Math.min(count(step.damage), Math.max(0, hp[target] - nextHp[target]));
        if (dealt > 0) {
          if (step.combo === true) { result[actor].comboHits++; result[actor].comboDamage += dealt; }
          if (step.type === 'counter') result[actor].reflectedDamage += dealt;
          if (step.critical === true && step.combo !== true && step.type === 'attack') result[actor].criticalHits++;
        }
      }
      hp.host = nextHp.host; hp.guest = nextHp.guest;
    }
    result.host.rounds++; result.guest.rounds++;
    return result;
  }
  function markup(raw, expectedRounds = 0) {
    if (raw?.version !== 1) return '<section class="combat-contribution"><h3>本場配裝貢獻</h3><small>本場效果紀錄尚未齊全。</small></section>';
    const stats = normalize(raw), format = value => count(value).toLocaleString('zh-TW');
    const partial = stats.partial || stats.rounds < count(expectedRounds);
    return `<section class="combat-contribution"><h3>本場配裝貢獻</h3><dl>
      <div><dt>連擊觸發</dt><dd>${format(stats.comboHits)} 次</dd></div><div><dt>連擊傷害</dt><dd>${format(stats.comboDamage)}</dd></div>
      <div><dt>反傷傷害</dt><dd>${format(stats.reflectedDamage)}</dd></div><div><dt>爆擊命中</dt><dd>${format(stats.criticalHits)} 次</dd></div></dl>
      <small>${partial ? '部分戰鬥紀錄 · ' : ''}連擊只計追加命中；傷害以實際扣血計。</small></section>`;
  }
  const api = Object.freeze({ normalize, add, battleRound, markup });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QACombatContribution = api;
})(globalThis);
