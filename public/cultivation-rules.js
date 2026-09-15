// 修為成長規則：答對增加修為、連續三題後進入雙倍修為，道心護體可抵消下一次失誤的修為扣除。
(function () {
  'use strict';

  const CONFIG = {
    normalGain: 5,
    doubleGain: 10,
    bonusAfterStreak: 3,
    stateKey: 'xiuxian_growth_v1'
  };

  function loadState() {
    try {
      return Object.assign({ streak: 0, shield: false }, JSON.parse(localStorage.getItem(CONFIG.stateKey) || '{}'));
    } catch (_) {
      return { streak: 0, shield: false };
    }
  }
  function saveState(state) {
    localStorage.setItem(CONFIG.stateKey, JSON.stringify(state));
  }

  async function getFirebase() {
    const [{ initializeApp }, authModule, firestoreModule] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js')
    ]);
    let app;
    try {
      app = initializeApp({
        apiKey: 'AIzaSyDifdJmLTmwQATz__xUHSkXZ_xXOWyX-wU',
        authDomain: 'question-learning.firebaseapp.com',
        projectId: 'question-learning',
        storageBucket: 'question-learning.firebasestorage.app',
        messagingSenderId: '1058543232092',
        appId: '1:1058543232092:web:3fcc40f5f069b6df307299'
      }, 'cultivation-rules');
    } catch (_) {
      const { getApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
      app = getApp('cultivation-rules');
    }
    return {
      auth: authModule.getAuth(app),
      db: firestoreModule.getFirestore(app),
      doc: firestoreModule.doc,
      getDoc: firestoreModule.getDoc,
      updateDoc: firestoreModule.updateDoc
    };
  }

  let firebasePromise = null;
  function firebase() {
    if (!firebasePromise) firebasePromise = getFirebase();
    return firebasePromise;
  }

  function answerFromEvent(event) {
    const button = event.target && event.target.closest && event.target.closest('[id^="option-btn-"]');
    if (!button) return null;
    const match = button.id.match(/^option-btn-(\d+)$/);
    if (!match) return null;
    const active = window.currentActiveQuiz;
    if (!active || !active.data) return null;
    return { userIdx: Number(match[1]), correctIdx: Number(active.data.ans) };
  }

  async function reconcileAnswer(isCorrect, beforeStreak, hadShield) {
    const { auth, db, doc, getDoc, updateDoc } = await firebase();
    const user = auth.currentUser;
    if (!user) return;

    const state = loadState();
    const nextStreak = isCorrect ? beforeStreak + 1 : 0;
    const earned = isCorrect
      ? (beforeStreak >= CONFIG.bonusAfterStreak ? CONFIG.doubleGain : CONFIG.normalGain)
      : 0;
    const nextShield = isCorrect && beforeStreak >= CONFIG.bonusAfterStreak
      ? true
      : (isCorrect ? state.shield : false);

    // main-legacy 的舊答題獎勵為 +20；這裡在它完成寫入後，把修為校正為新的修仙規則。
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) return;
        const data = snap.data();
        const stats = data.stats || {};
        const currentScore = Math.max(0, Number(stats.totalScore) || 0);

        // 正確題：移除舊系統 +20，再加入修仙制 5/10。
        // 錯誤題：修為維持不變；若有道心護體，消耗護體效果。
        let cultivationScore = currentScore;
        if (isCorrect) {
          cultivationScore = Math.max(0, currentScore - 20 + earned);
        } else if (hadShield) {
          cultivationScore = currentScore;
        }

        await updateDoc(doc(db, 'users', user.uid), {
          'stats.totalScore': cultivationScore,
          'stats.currentStreak': nextStreak,
          'stats.bestStreak': Math.max(Number(stats.bestStreak) || 0, nextStreak),
          'stats.cultivationShield': nextShield
        });

        state.streak = nextStreak;
        state.shield = nextShield;
        saveState(state);

        const msg = isCorrect
          ? (earned === CONFIG.doubleGain ? `悟道成功！道心連勝，修為 +${earned}（雙倍）` : `悟道成功！修為 +${earned}`)
          : (hadShield ? '失誤一次，道心護體生效，修為不減。' : '失誤，道心中斷；修為不減。');
        showToast(msg);
        return;
      } catch (error) {
        if (attempt === 4) console.warn('修為同步失敗', error);
        await new Promise(resolve => setTimeout(resolve, 180));
      }
    }
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

      const state = loadState();
      const beforeStreak = state.streak || 0;
      const hadShield = !!state.shield;
      const isCorrect = answer.userIdx === answer.correctIdx;

      // 等舊核心完成 Firestore 寫入後再校正，避免兩邊同時寫入互相覆蓋。
      setTimeout(() => reconcileAnswer(isCorrect, beforeStreak, hadShield), 450);
    }, false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
