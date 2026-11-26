'use strict';
const crypto = require('node:crypto');
const {curriculumMetadata}=require('./public/cultivation/curriculum-range-rules.js');

const MAX_RULES = 16;
const normalizeUnit = raw => ({
  path: String(raw?.path || '').trim().slice(0, 240),
  detail: String(raw?.detail || '').trim().slice(0, 120),
  sub_topics: [...new Set((Array.isArray(raw?.sub_topics) ? raw.sub_topics : [])
    .map(value => String(value || '').trim().slice(0, 100)).filter(Boolean))].sort().slice(0, 24),
  ...(raw?.curriculum!==undefined?{curriculum:curriculumMetadata(raw.curriculum)}:{})
});
const unitKey = unit => JSON.stringify(normalizeUnit(unit));
function scopeKey(user) {
  const settings = user?.gameSettings || {};
  if (settings.sourceMode !== 'focused' || !Array.isArray(settings.focusedUnits) || !settings.focusedUnits.length) return '';
  const selected = settings.focusedUnits.map(unitKey).sort();
  return crypto.createHash('sha256').update(JSON.stringify([
    user?.profile?.educationLevel || '', selected
  ])).digest('hex').slice(0, 32);
}
function activeRules(user, unit) {
  const saved = user?.questionScopeExclusions, key = scopeKey(user);
  if (!key || saved?.scopeKey !== key || !Array.isArray(saved.rules) ||
      !user.gameSettings.focusedUnits.some(item => unitKey(item) === unitKey(unit))) return [];
  return saved.rules.filter(item => item.unitKey === unitKey(unit) &&
    typeof item.text === 'string' && item.text.trim()).slice(0, MAX_RULES).map(item => item.text);
}
function exclusionIssue(question, rules = []) {
  const stem = String(question?.q || question || '');
  for (const rule of rules) {
    // Safe hard guard for a common explicitly excluded subtopic. Other natural
    // language exclusions are checked by the independent AI reviewer.
    if (/(?:三維|3D|三度空間)/i.test(rule) && /(?:向量|內積|點積)/.test(rule) &&
        /(?:內積|點積|\\cdot|·|\\langle)/.test(stem) &&
        (/(?:三維|三度空間|空間向量|3D|\\mathbb\{R\}\^3)/i.test(stem) ||
        /[（(][^()（）,，]{1,18}[,，][^()（）,，]{1,18}[,，][^()（）,，]{1,18}[）)]/.test(stem))) {
      return '題目涉及玩家已排除的三維向量內積計算';
    }
  }
  return '';
}
function registerQuizScopeExclusions(app, {
  verify = require('./raid-question-ticket.cjs').verifyMainIdentity,
  resolve = () => require('./server-repositories.cjs').playerRepository.resolve()
} = {}) {
  app.post('/api/quiz/scope-exclusions', async (req, res) => {
    try {
      const uid = await verify(req), db = resolve().db, ref = db.collection('users').doc(uid);
      const action = String(req.body?.action || 'list');
      if (!['list', 'add', 'remove'].includes(action)) return res.status(400).json({error:'不支援的操作'});
      const unit = normalizeUnit(req.body?.unit), unitId = unitKey(unit);
      const change = async (user, saved) => {
        const key = scopeKey(user);
        if (!key || !unit.path || !user.gameSettings.focusedUnits.some(item => unitKey(item) === unitId))
          throw Object.assign(Error('此章節已不在目前選取的學習範圍，請重新載入題目'), {status:409});
        const rules = saved?.scopeKey === key && Array.isArray(saved.rules)
          ? saved.rules.filter(item => item && typeof item.text === 'string').slice(0, MAX_RULES)
          : [];
        if (action === 'list') return {scopeKey:key,revision:saved?.scopeKey===key?saved.revision||'':'',rules};
        if (action === 'add') {
          const text = String(req.body?.text || '').replace(/\s+/g, ' ').trim();
          if (text.length < 4 || text.length > 160)
            throw Object.assign(Error('請用 4～160 字描述要排除的題型，例如「不要再出三維向量內積的計算」'), {status:400});
          if (!rules.some(item => item.unitKey === unitId && item.text === text)) {
            if (rules.length >= MAX_RULES)
              throw Object.assign(Error('目前範圍最多設定 16 項排除規則，請先刪除不用的規則'), {status:400});
            rules.push({id:crypto.randomUUID(),unitKey:unitId,text,createdAt:Date.now()});
          }
        } else {
          const id = String(req.body?.id || '');
          const index = rules.findIndex(item => item.id === id && item.unitKey === unitId);
          if (index < 0) throw Object.assign(Error('找不到此範圍的排除規則'), {status:404});
          rules.splice(index,1);
        }
        return {scopeKey:key,revision:crypto.randomUUID(),rules};
      };
      let state;
      if (action === 'list') {
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({error:'玩家資料不存在'});
        state = await change(snap.data() || {}, (snap.data() || {}).questionScopeExclusions);
      } else {
        state = await db.runTransaction(async tx => {
          const snap = await tx.get(ref);
          if (!snap.exists) throw Object.assign(Error('玩家資料不存在'),{status:404});
          const next = await change(snap.data() || {}, snap.data()?.questionScopeExclusions);
          tx.update(ref, {questionScopeExclusions:next});
          return next;
        });
      }
      return res.json({ok:true,state,rules:state.rules.filter(item=>item.unitKey===unitId).map(item=>({id:item.id,text:item.text}))});
    } catch(error) {
      return res.status(error.status || 503).json({error:error.status?error.message:'學習範圍排除規則暫時無法儲存'});
    }
  });
}
module.exports = {normalizeUnit, unitKey, scopeKey, activeRules, exclusionIssue, registerQuizScopeExclusions};
