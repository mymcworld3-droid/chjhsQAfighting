// 清霜秘境三難度：與伺服器共用，房間建立時固定，舊房間視為簡單。
(function (root) {
  'use strict';
  const TIERS = Object.freeze({
    normal: Object.freeze({
      id:'normal', name:'簡單', minScore:6, minRealm:'築基期', maxHp:2000, baseAttack:70,
      fragments:5, quizDifficulty:'medium'
    }),
    hard: Object.freeze({
      id:'hard', name:'困難', minScore:28, minRealm:'金丹期', maxHp:4800, baseAttack:110,
      fragments:10, quizDifficulty:'medium'
    }),
    extreme: Object.freeze({
      id:'extreme', name:'極境', minScore:68, minRealm:'元嬰期', maxHp:7200, baseAttack:160,
      fragments:15, quizDifficulty:'hard'
    })
  });
  const get = id => TIERS[String(id || 'normal')] || null;
  const fromRoom = room => get(room?.difficulty || 'normal');
  const api = Object.freeze({TIERS, get, fromRoom});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QARaidDifficulty = api;
})(globalThis);
