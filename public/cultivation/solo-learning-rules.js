// 問道學習獎勵：难題、弱項與一次性同概念訂正，不套用裝備倍率。
(function (root) {
  'use strict';
  const key = value => 'q:' + String(value || '').normalize('NFC').replace(/\s+/g,' ').trim().slice(0,1200);
  const aliases = {國語:'國文',英語:'英文',數學A:'數學',數學B:'數學'};
  const safeLabel = (value,fallback) => ['__proto__','constructor','prototype'].includes(value) ? fallback : value;
  const subject = value => {
    const name = String(value || '').trim();
    return safeLabel(Object.hasOwn(aliases,name) ? aliases[name] : name,'綜合');
  };
  function context(quiz) {
    const parts = String(quiz?.badge || '').replace('🎯 ','').split(' | ');
    const practice = /訂正練習|延伸練習/.test(parts[0]);
    const legacy = practice ? String(parts[1] || '').split(' · ') : parts;
    return {subject:subject(quiz?.learningSubject || quiz?.extendedPracticeSubject || legacy[0] || '綜合').slice(0,40),
      topic:safeLabel(String(quiz?.learningTopic || quiz?.extendedPracticeKnowledgePoint || legacy[1] || '本題概念').trim().slice(0,75),'本題概念')};
  }
  function reward(stats, quiz, correct, profile = {}) {
    const old = stats.soloLearningV1?.mistakes || {}, mistakes = {...old};
    const concepts = {...(stats.soloLearningV1?.concepts || {})};
    const {subject:s,topic} = context(quiz);
    const qKey = key(quiz?.data?.q), originKey = quiz?.recoveryOrigin ? key(quiz.recoveryOrigin) : '';
    const validAnswer = quiz?.answerSelectedIndex >= 0;
    if (!correct && validAnswer && qKey !== 'q:' && !Object.hasOwn(mistakes,qKey)) mistakes[qKey]={recovered:false,subject:s,topic};
    const recovery = correct && originKey && originKey !== qKey && Object.hasOwn(mistakes,originKey) && !mistakes[originKey].recovered;
    let recoveryFeedback = null;
    if (recovery) {
      const original = mistakes[originKey];
      mistakes[originKey]={...original,recovered:true};
      const learnedSubject = original.subject || s, learnedTopic = original.topic || topic;
      const conceptKey = 'c:' + learnedSubject + ':' + learnedTopic;
      const corrected = Math.max(0,Math.floor(Number(concepts[conceptKey]?.corrected)||0))+1;
      // Reinsert the touched concept so the bounded list remains chronological.
      delete concepts[conceptKey];
      concepts[conceptKey]={subject:learnedSubject,topic:learnedTopic,corrected};
      recoveryFeedback=concepts[conceptKey];
    }
    for (const id of Object.keys(concepts).slice(0,-50)) delete concepts[id];
    // 有限帳號資料；已訂正項目優先保留，避免反覆錯同題取得訂正獎勵。
    const entries=Object.entries(mistakes); if(entries.length>200) for(const [id] of entries.slice(0,entries.length-200)) delete mistakes[id];
    const weak=String(profile.weakSubjects || '').split(/[,，、;；\n]/).map(subject).includes(s);
    const knowledge=stats.knowledgeMap?.[s]?.[topic];
    const observedWeak=Number(knowledge?.total)>=5 && Number(knowledge.correct)/Number(knowledge.total)<.6;
    const hard=correct && quiz?.learningDifficulty==='hard';
    const weakPractice=correct && (weak || observedWeak);
    const gain=Number(hard)+Number(weakPractice)+Number(!!recovery);
    return {gain,gold:gain*10,recovery:!!recovery,hard:!!hard,weakPractice:!!weakPractice,
      progress:{version:1,mistakes,concepts},recoveryFeedback,message:[hard?'難題 +1':'',weakPractice?'弱項練習 +1':'',recovery?'訂正成功 +1':''].filter(Boolean).join('；')};
  }
  const api=Object.freeze({key,context,reward});
  if(typeof module==='object'&&module.exports)module.exports=api;else root.QASoloLearningRules=api;
})(globalThis);
