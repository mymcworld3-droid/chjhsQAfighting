// 修為成長規則：答對淨增加 1 修為；連續三題後獲得一次道心護體。
//
// 注意：舊版 main-legacy.js 的單人答對流程會先把 totalScore +20。
// 本模組因此只在確認主流程已完成後，把該次獎勵校正成淨 +1，避免變成 +21。
(function () {
  'use strict';

  const CONFIG = {
    cultivationGain: 1,
    legacySoloAnswerGain: 20,
    bonusAfterStreak: 3,
    stateKeyPrefix: 'xiuxian_growth_v2:'
  };

  const processedQuizzes = new WeakSet();

  function getUserStateKey(uid) {
    return `${CONFIG.stateKeyPrefix}${uid || 'anonymous'}`;
  }

  function loadState(uid) {
    try {
      const raw = localStorage.getItem(getUserStateKey(uid));
      return Object.assign({ shield: false, lastQuizSignature: null }, JSON.parse(raw || '{}'));
    } catch (_) {
      return { shield: false, lastQuizSignature: null };
    }
  }

  function saveState(uid, state) {
    try {
      localStorage.setItem(getUserStateKey(uid), JSON.stringify(state));
    } catch (_) {
      // localStorage 失效時，Firestore 仍是權威狀態。
    }
  }

  async function getFirebase() {
    const [appModule, authModule, firestoreModule] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js')
    ]);
    const app = appModule.getApp();
    return {
      auth: authModule.getAuth(app),
      db: firestoreModule.getFirestore(app),
      doc: firestoreModule.doc,
      getDoc: firestoreModule.getDoc,
      updateDoc: firestoreModule.updateDoc,
      runTransaction: firestoreModule.runTransaction
    };
  }

  let firebasePromise = null;
  function firebase() {
    if (!firebasePromise) firebasePromise = getFirebase();
    return firebasePromise;
  }

  function getActiveQuiz() {
    const active = window.currentActiveQuiz;
    if (!active || !active.data) return null;
    return active;
  }

  function answerFromEvent(event) {
    const button = event.target && event.target.closest && event.target.closest('[id^="option-btn-"]');
    if (!button) return null;

    const match = button.id.match(/^option-btn-(\d+)$/);
    if (!match) return null;

    const active = getActiveQuiz();
    if (!active) return null;

    return {
      quiz: active,
      userIdx: Number(match[1]),
      correctIdx: Number(active.data.ans)
    };
  }

  async function waitForMainAnswerCommit(userRef, getDoc, beforeAnswered, attempts = 8) {
    for (let i = 0; i < attempts; i++) {
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const stats = snap.data().stats || {};
        const answered = Number(stats.totalAnswered) || 0;
        if (answered > beforeAnswered) return snap;
      }
      await new Promise(resolve => setTimeout(resolve, 100 + i * 100));
    }
    return getDoc(userRef);
  }

  async function reconcileAnswer(isCorrect, uid, quiz) {
    const { auth, db, doc, getDoc, runTransaction } = await firebase();
    const user = auth.currentUser;
    if (!user || user.uid !== uid) return;

    const userRef = doc(db, 'users', uid);
    const localState = loadState(uid);
    const signature = JSON.stringify([quiz.data.q, quiz.data.ans, quiz.badge || '']);

    if (localState.lastQuizSignature === signature && localState.lastQuizUid === uid) return;

    const beforeSnap = await getDoc(userRef);
    if (!beforeSnap.exists()) return;
    const beforeStats = beforeSnap.data().stats || {};
    const beforeAnswered = Number(beforeStats.totalAnswered) || 0;
    const beforeStreak = Number(beforeStats.currentStreak) || 0;

    const committedSnap = await waitForMainAnswerCommit(userRef, getDoc, beforeAnswered);
    if (!committedSnap.exists()) return;

    const committedStats = committedSnap.data().stats || {};
    const committedAnswered = Number(committedStats.totalAnswered) || 0;
    if (committedAnswered <= beforeAnswered) return;

    await runTransaction(db, async (transaction) => {
      const fresh = await transaction.get(userRef);
      if (!fresh.exists()) return;

      const data = fresh.data();
      const stats = { ...(data.stats || {}) };
      const currentAnswered = Number(stats.totalAnswered) || 0;
      if (currentAnswered <= beforeAnswered) return;

      if (isCorrect) {
        const currentScore = Math.max(0, Number(stats.totalScore) || 0);
        stats.totalScore = Math.max(0, currentScore - CONFIG.legacySoloAnswerGain + CONFIG.cultivationGain);
      }

      const streakAfterAnswer = Number(stats.currentStreak) || 0;
      const previousShield = !!stats.cultivationShield;
      const nextShield = isCorrect && beforeStreak >= CONFIG.bonusAfterStreak
        ? true
        : (isCorrect ? previousShield : false);

      stats.cultivationShield = nextShield;
      transaction.update(userRef, { stats });
    });

    const finalSnap = await getDoc(userRef);
    if (finalSnap.exists()) {
      const finalData = finalSnap.data();
      if (window.currentUserData) window.currentUserData = finalData;

      // 通知首頁「仙途修行」立即刷新，不必等待下一次輪詢或重新載入頁面。
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', {
        detail: {
          uid,
          totalScore: Number(finalData.stats?.totalScore) || 0,
          currentStreak: Number(finalData.stats?.currentStreak) || 0,
          stats: finalData.stats || {}
        }
      }));
    }

    const finalStats = finalSnap.exists() ? (finalSnap.data().stats || {}) : {};
    const finalStreak = Number(finalStats.currentStreak) || 0;
    const shield = !!finalStats.cultivationShield;

    saveState(uid, {
      shield,
      lastQuizSignature: signature,
      lastQuizUid: uid,
      streak: finalStreak
    });

    if (typeof window.updateUIStats === 'function') window.updateUIStats();

    showToast(
      isCorrect
        ? `悟道成功！修為 +${CONFIG.cultivationGain}${shield && finalStreak === beforeStreak + 1 && beforeStreak >= CONFIG.bonusAfterStreak ? '，道心護體準備就緒' : ''}`
        : (shield ? '失誤，道心護體仍在。' : '失誤，道心中斷；修為不減。')
    );
  }

  function showToast(message) {
    const old = document.getElementById('cultivation-rule-toast');
    if (old) old.remove();

    const el = document.createElement('div');
    el.id = 'cultivation-rule-toast';
    el.textContent = message;
    el.style.cssText = 'position:fixed;left:50%;bottom:145px;transform:translateX(-50%);z-index:1000;padding:10px 16px;border-radius:999px;background:rgba(12,15,29,.96);border:1px solid rgba(233,196,106,.4);color:#f6e6b0;font-size:12px;font-weight:800;box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:none';

    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function boot() {
    document.addEventListener('click', (event) => {
      const answer = answerFromEvent(event);
      if (!answer) return;

      const uid = window.getCurrentUserData?.()?.uid;
      if (!uid) return;

      if (processedQuizzes.has(answer.quiz)) return;
      processedQuizzes.add(answer.quiz);

      const isCorrect = answer.userIdx === answer.correctIdx;
      setTimeout(() => {
        reconcileAnswer(isCorrect, uid, answer.quiz).catch(error => {
          console.warn('修為同步失敗', error);
        });
      }, 50);
    }, false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();