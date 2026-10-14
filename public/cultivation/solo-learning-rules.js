// 問道學習獎勵：难題、弱項與一次性同概念訂正，不套用裝備倍率。
(function (root) {
  'use strict';
  const key = value => 'q:' + String(value || '').normalize('NFC').replace(/\s+/g,' ').trim().slice(0,1200);
  const subject = value => ({國語:'國文',英語:'英文',數學A:'數學',數學B:'數學'})[String(value).trim()] || String(value || '').trim();
  function reward(stats, quiz, correct, profile = {}) {
    const old = stats.soloLearningV1?.mistakes || {}, mistakes = {...old};
    const qKey = key(quiz?.data?.q), originKey = quiz?.recoveryOrigin ? key(quiz.recoveryOrigin) : '';
    const validAnswer = quiz?.answerSelectedIndex >= 0;
    if (!correct && validAnswer && qKey !== 'q:' && !Object.hasOwn(mistakes,qKey)) mistakes[qKey]={recovered:false};
    const recovery = correct && originKey && originKey !== qKey && Object.hasOwn(mistakes,originKey) && !mistakes[originKey].recovered;
    if (recovery) mistakes[originKey]={recovered:true};
    // 有限帳號資料；已訂正項目優先保留，避免反覆錯同題取得訂正獎勵。
    const entries=Object.entries(mistakes); if(entries.length>200) for(const [id] of entries.slice(0,entries.length-200)) delete mistakes[id];
    const s=subject(quiz?.learningSubject || quiz?.extendedPracticeSubject || String(quiz?.badge || '').replace('🎯 ','').split(' | ')[0]);
    const weak=String(profile.weakSubjects || '').split(/[,，、;；\n]/).map(subject).includes(s);
    const knowledge=stats.knowledgeMap?.[s]?.[quiz?.learningTopic];
    const observedWeak=Number(knowledge?.total)>=5 && Number(knowledge.correct)/Number(knowledge.total)<.6;
    const hard=correct && quiz?.learningDifficulty==='hard';
    const weakPractice=correct && (weak || observedWeak);
    const gain=Number(hard)+Number(weakPractice)+Number(!!recovery);
    return {gain,gold:gain*10,recovery:!!recovery,hard:!!hard,weakPractice:!!weakPractice,
      progress:{version:1,mistakes},message:[hard?'難題 +1':'',weakPractice?'弱項練習 +1':'',recovery?'訂正成功 +1':''].filter(Boolean).join('；')};
  }
  const api=Object.freeze({key,reward});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QASoloLearningRules=api;
})(globalThis);
