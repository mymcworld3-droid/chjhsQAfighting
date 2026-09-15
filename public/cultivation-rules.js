// 修為成長規則：答對增加 1 修為、連續三題後道心護體可抵消下一次失誤的修為扣除。
(function () {
  'use strict';

  // 🔥 修正：將原本的 5 與 10 改為 1，嚴格落實「一題等於一修為」
  const CONFIG = {
    normalGain: 1,
    doubleGain: 1,
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

  // 必須使用主遊戲已登入的 Firebase App/Auth。
  // 之前使用獨立 app 名稱會造成 auth.currentUser 為 null，導致修為規則看不到登入玩家。
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
    
    // 計算獲得的修為，無論是否連勝都給予定義好的數值（1）
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

        let cultivationScore = currentScore;
        if (isCorrect) {
          // 🔥 修正：因為主程式已經不再將金幣混入 totalScore，這裡直接乾淨地加上 earned 修為即可
          cultivationScore = currentScore + earned;
        } else if (hadShield) {
          cultivationScore = currentScore;
        }

        await updateDoc(doc(db, 'users', user.uid), {
          'stats.totalScore': cultivationScore,
          'stats.currentStreak': nextStreak,
          'stats.bestStreak': Math.max(Number(stats.bestStreak) || 0, nextStreak),
          'stats.cultivationShield': nextShield
        });

        // 🔥 修正：將計算後的修為與狀態同步回記憶體，防止被 main-legacy.js 的舊資料覆蓋
        if (window.currentUserData && window.currentUserData.stats) {
          window.currentUserData.stats.totalScore = cultivationScore;
          window.currentUserData.stats.currentStreak = nextStreak;
          window.currentUserData.stats.bestStreak = Math.max(Number(window.currentUserData.stats.bestStreak) || 0, nextStreak);
          window.currentUserData.stats.cultivationShield = nextShield;
          
          // 強制觸發主程式的 UI 更新，讓畫面上的修為即時跳動
          if (typeof window.updateUIStats === 'function') {
            window.updateUIStats();
          }
        }

        state.streak = nextStreak;
        state.shield = nextShield;
        saveState(state);

        // 訊息提示更新：不再顯示雙倍字眼，改為提示道心護體的狀態
        const isStreak = beforeStreak >= CONFIG.bonusAfterStreak;
        const msg = isCorrect
          ? (isStreak ? `悟道成功！道心護體準備就緒，修為 +${earned}` : `悟道成功！修為 +${earned}`)
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

      setTimeout(() => reconcileAnswer(isCorrect, beforeStreak, hadShield), 450);
    }, false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
