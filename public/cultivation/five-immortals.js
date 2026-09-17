// 九州五大仙：渡劫以上修士，以國中程度連答問鼎。答錯即止，連答紀錄嚴格超過在榜者才可奪位。
(function () {
  'use strict';

  const TRIBULATION_SCORE = 628;
  const QUIZ_LEVEL = '國中三年級';
  const QUIZ_DIFFICULTY = 'medium';
  const ROLES = [
    { id: 'ru-xian', name: '儒仙', subject: '國文', desc: '以文載道' },
    { id: 'fa-xian', name: '法仙', subject: '社會', desc: '洞察世事' },
    { id: 'suan-xian', name: '算仙', subject: '數學', desc: '推演天機' },
    { id: 'xuan-xian', name: '玄仙', subject: '自然', desc: '參悟天地' },
    { id: 'wai-xian', name: '外仙', subject: '英文', desc: '通達萬邦' }
  ];

  let db = null;
  let auth = null;
  let fs = null;
  let owners = {};
  let challenge = null;
  let sessionSerial = 0;

  const css = `
    .five-immortals{margin:0 0 16px;padding:20px 14px;border:1px solid rgba(216,177,93,.24);border-radius:24px;background:linear-gradient(145deg,rgba(27,22,13,.97),rgba(7,7,7,.98));box-shadow:0 20px 60px rgba(0,0,0,.32);overflow:hidden}.five-immortals h3{margin:0;color:#f5e7c3;font-size:19px;font-weight:900;text-align:center;letter-spacing:.12em}.five-immortals>p{margin:7px 0 0;color:#95866b;font-size:10px;text-align:center;line-height:1.7}.five-immortal-rule{margin:14px auto 0;max-width:720px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.five-immortal-rule div{padding:9px;border:1px solid rgba(216,177,93,.12);border-radius:12px;background:rgba(216,177,93,.03);text-align:center}.five-immortal-rule span{display:block;color:#756a58;font-size:7px}.five-immortal-rule b{display:block;margin-top:3px;color:#d8ba72;font-size:10px}.five-immortals-head{position:relative;display:flex;align-items:center;justify-content:center;min-height:38px;padding:0 44px}.five-immortals-head h3{margin:0}.five-immortals-help{position:absolute;right:2px;top:50%;transform:translateY(-50%);width:32px;height:32px;padding:0;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(216,177,93,.5);background:rgba(216,177,93,.08);color:#e8c66f;font-size:17px;font-weight:900;line-height:1;cursor:pointer;box-shadow:0 0 0 1px rgba(216,177,93,.05),0 8px 24px rgba(0,0,0,.28);transition:.18s ease}.five-immortals-help:hover,.five-immortals-help[aria-expanded="true"]{background:rgba(216,177,93,.18);border-color:rgba(232,198,111,.82);color:#fff0bd;box-shadow:0 0 18px rgba(216,177,93,.16)}.five-immortal-guide{margin:10px auto 0;max-width:720px;padding:12px;border:1px solid rgba(216,177,93,.16);border-radius:16px;background:rgba(216,177,93,.035)}.five-immortal-guide[hidden]{display:none}.five-immortal-guide>p{margin:0;color:#9b8c70;font-size:9px;text-align:center;line-height:1.75}.five-immortal-guide .five-immortal-rule{margin-top:10px}.five-immortal-guide .five-immortal-extra{margin-top:10px;color:#81755f;font-size:8px}.podium-container{display:flex;justify-content:center;align-items:flex-end;gap:6px;margin-top:48px;min-height:220px}.podium-slot{display:flex;flex-direction:column;align-items:center;width:19%;min-width:0;background:rgba(255,255,255,.025);border:1px solid rgba(216,177,93,.14);border-bottom:none;border-radius:9px 9px 0 0;padding:10px 3px 6px;position:relative}.rank-1{order:3;height:190px;background:linear-gradient(to top,rgba(216,177,93,.14),rgba(255,255,255,.02));border-color:rgba(216,177,93,.46)}.rank-2{order:2;height:158px}.rank-3{order:4;height:142px}.rank-4{order:1;height:124px}.rank-5{order:5;height:108px}.avatar-wrapper{position:absolute;top:-25px;left:50%;transform:translateX(-50%);z-index:4}.rank-1 .avatar-wrapper{top:-37px;filter:drop-shadow(0 0 14px rgba(216,177,93,.45))}.immortal-name{font-size:11px;font-weight:900;color:#f2e4c4;margin-top:23px;text-align:center}.rank-1 .immortal-name{font-size:14px;color:#f6dc93;margin-top:34px}.immortal-subject{font-size:8px;font-weight:900;color:#b89a55;margin-top:3px}.immortal-owner-box{margin-top:auto;width:100%;display:flex;flex-direction:column;align-items:center;gap:3px}.immortal-owner{font-size:9px;color:#b6a98c;text-align:center;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%}.immortal-record{font-size:8px;color:#d7b96d;font-weight:900}.immortal-status{font-size:7px;color:#8d8067}.immortal-btn{margin-top:4px;padding:5px 3px;width:94%;border-radius:7px;border:1px solid rgba(216,177,93,.38);background:rgba(216,177,93,.09);color:#f0d997;font-size:9px;font-weight:900;cursor:pointer}.immortal-btn:disabled{opacity:.36;cursor:not-allowed}.five-locked{margin-top:14px;text-align:center;color:#9f725f;font-size:9px}.fi-backdrop{position:fixed;inset:0;z-index:8200;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.86);backdrop-filter:blur(12px)}.fi-modal{width:min(100%,650px);max-height:90dvh;overflow:auto;border:1px solid rgba(216,177,93,.35);border-radius:26px;background:radial-gradient(circle at 50% 0,rgba(216,177,93,.12),transparent 30%),linear-gradient(145deg,#1a150c,#070707);box-shadow:0 35px 110px rgba(0,0,0,.7);padding:22px;color:#eee1c1}.fi-head{display:flex;justify-content:space-between;gap:10px;align-items:start}.fi-kicker{font-size:8px;letter-spacing:.2em;color:#a58a50;font-weight:900}.fi-head h3{margin:4px 0 0;font-size:24px;color:#f4e2b9}.fi-close{width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.08);background:#10100e;color:#aa9a7b}.fi-scoreboard{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:16px 0}.fi-scoreboard div{padding:10px;border:1px solid rgba(216,177,93,.12);border-radius:12px;background:rgba(255,255,255,.02);text-align:center}.fi-scoreboard span{display:block;color:#756b59;font-size:7px}.fi-scoreboard b{display:block;margin-top:4px;color:#e0bd69;font-size:16px}.fi-note{padding:9px 11px;border-left:2px solid #b78c39;background:rgba(216,177,93,.04);color:#97886d;font-size:9px;line-height:1.6}.fi-loading{padding:48px 10px;text-align:center;color:#aa9564;font-size:11px}.fi-question{margin-top:16px;padding:16px;border:1px solid rgba(216,177,93,.14);border-radius:18px;background:rgba(255,255,255,.02)}.fi-question h4{margin:0;color:#f0e2c4;font-size:17px;line-height:1.65}.fi-options{display:grid;gap:8px;margin-top:14px}.fi-option{min-height:48px;display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:12px;border:1px solid rgba(216,177,93,.14);background:rgba(255,255,255,.025);color:#d8c7a4;text-align:left}.fi-option:hover:not(:disabled){border-color:rgba(216,177,93,.42);background:rgba(216,177,93,.06)}.fi-option span{width:25px;height:25px;flex:0 0 25px;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(216,177,93,.24);color:#dabb68;font-size:9px}.fi-option.correct{border-color:rgba(92,170,112,.55);background:rgba(61,126,76,.12)}.fi-option.wrong{border-color:rgba(190,83,66,.55);background:rgba(143,52,42,.12)}.fi-result{text-align:center;padding:28px 8px 10px}.fi-result-seal{width:74px;height:74px;margin:0 auto 12px;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(216,177,93,.4);color:#e4bf65;font:900 30px serif}.fi-result h4{margin:0;color:#f1e1bb;font-size:23px}.fi-result p{color:#9b8d72;font-size:10px;line-height:1.7}.fi-actions{display:flex;justify-content:center;gap:8px;margin-top:15px}.fi-actions button{min-height:40px;padding:0 16px;border-radius:12px;font-size:10px;font-weight:900}.fi-primary{border:1px solid #c69b41;background:linear-gradient(135deg,#9a6d22,#5d3a0c);color:#fff0c7}.fi-ghost{border:1px solid rgba(216,177,93,.2);background:rgba(216,177,93,.04);color:#c8b68d}@media(max-width:640px){.podium-container{gap:3px}.podium-slot{padding-left:1px;padding-right:1px}.immortal-owner{font-size:7px}.immortal-btn{font-size:7px}.five-immortal-rule{grid-template-columns:1fr}.fi-scoreboard{grid-template-columns:repeat(3,1fr)}}
  `;

  function userData() { return window.getCurrentUserData?.() || null; }
  function currentScore() { return Math.max(0, Number(userData()?.stats?.totalScore) || 0); }
  function eligible() { return currentScore() >= TRIBULATION_SCORE; }
  function roleById(id) { return ROLES.find((r) => r.id === id) || null; }
  function ownerRecord(id) { return Math.max(0, Number(owners[id]?.challengeScore) || 0); }
  function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }

  function toast(message) {
    const el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:8500;padding:10px 16px;border-radius:999px;background:#11100c;color:#f3dfaa;border:1px solid rgba(216,177,93,.38);font-size:11px;font-weight:800;box-shadow:0 15px 45px rgba(0,0,0,.45)';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function avatarHtml(equipped, large = false) {
    const size = large ? 56 : 42;
    const frame = equipped?.frame || '';
    const avatar = equipped?.avatar || '';
    const isFrameImage = frame && (frame.includes('.') || frame.includes('/'));
    const frameClass = frame && !isFrameImage ? frame : '';
    return `<div class="${frameClass}" style="width:${size}px;height:${size}px;border-radius:50%;position:relative;background:#181612;border:1px solid rgba(216,177,93,.22);display:grid;place-items:center;overflow:visible"><div style="width:100%;height:100%;border-radius:50%;overflow:hidden;display:grid;place-items:center">${avatar ? `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover" onerror="this.remove()">` : '<i class="fa-solid fa-user" style="color:#776b57"></i>'}</div>${isFrameImage ? `<img src="${frame}" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);height:145%;max-width:none;pointer-events:none">` : ''}</div>`;
  }

  async function connect() {
    try {
      const [appModule, authModule, firestoreModule] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'),
        import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js')
      ]);
      const app = appModule.getApp();
      auth = authModule.getAuth(app);
      db = firestoreModule.getFirestore(app);
      fs = firestoreModule;
      await loadOwners();
    } catch (error) {
      console.warn('五仙問鼎連線失敗', error);
      render();
    }
  }

  async function loadOwners() {
    if (!db) return;
    try {
      const snap = await fs.getDocs(fs.collection(db, 'worldImmortals'));
      owners = {};
      const uids = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        owners[docSnap.id] = data;
        if (data.uid && !uids.includes(data.uid)) uids.push(data.uid);
      });
      const profiles = {};
      for (let i = 0; i < uids.length; i += 10) {
        const batch = uids.slice(i, i + 10);
        const q = fs.query(fs.collection(db, 'users'), fs.where(fs.documentId(), 'in', batch));
        const usersSnap = await fs.getDocs(q);
        usersSnap.forEach((docSnap) => {
          const data = docSnap.data();
          profiles[docSnap.id] = { displayName: data.displayName || data.name || '無名仙客', equipped: data.equipped || null, totalScore: Math.max(0, Number(data.stats?.totalScore) || 0) };
        });
      }
      Object.values(owners).forEach((owner) => {
        const profile = profiles[owner.uid] || {};
        owner.displayName = profile.displayName || owner.displayName || '無名仙客';
        owner.equipped = profile.equipped || owner.equipped || null;
        owner.totalScore = profile.totalScore || 0;
        owner.challengeScore = Math.max(0, Number(owner.challengeScore) || 0);
      });
    } catch (error) {
      console.warn('五仙榜讀取失敗', error);
    }
    render();
  }

  function normalizeQuestion(raw) {
    const source = Array.isArray(raw) ? raw[0] : (raw?.questions?.[0] || raw || {});
    const question = String(source.q ?? source.question ?? '').trim();
    const options = Array.isArray(source.opts) ? source.opts : (Array.isArray(source.options) ? source.options : []);
    let answer = source.ans ?? source.answer ?? source.correctIndex;
    if (typeof answer === 'string' && /^[A-Da-d]$/.test(answer.trim())) answer = answer.trim().toUpperCase().charCodeAt(0) - 65;
    if (!Number.isInteger(Number(answer)) && typeof answer === 'string') answer = options.findIndex((item) => String(item) === answer);
    answer = Number(answer);
    if (!question || options.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= options.length) throw new Error('INVALID_QUESTION');
    return { question, options: options.map(String).slice(0, 6), answer, explanation: String(source.exp ?? source.explanation ?? '') };
  }

  async function fetchChallengeQuestion(role) {
    const response = await fetch('/api/generate-quiz', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: role.subject, level: QUIZ_LEVEL, difficulty: QUIZ_DIFFICULTY, rank: userData()?.stats?.rankLevel || 0, specificTopic: `${role.subject}國中程度綜合題。題目需有唯一明確答案。` })
    });
    if (!response.ok) throw new Error(`QUIZ_API_${response.status}`);
    const body = await response.json();
    let raw = body?.text ?? body;
    if (typeof raw === 'string') {
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      raw = JSON.parse(raw);
    }
    return normalizeQuestion(raw);
  }

  function ensureModal() {
    document.getElementById('five-immortal-challenge')?.remove();
    const backdrop = document.createElement('div');
    backdrop.id = 'five-immortal-challenge';
    backdrop.className = 'fi-backdrop';
    backdrop.innerHTML = `<section class="fi-modal" role="dialog" aria-modal="true"><div class="fi-head"><div><span class="fi-kicker">渡劫問鼎 · ENDLESS TRIAL</span><h3 id="fi-title">五仙問鼎</h3></div><button class="fi-close" type="button">×</button></div><div class="fi-scoreboard"><div><span>本次連答</span><b id="fi-streak">0</b></div><div><span>在榜紀錄</span><b id="fi-target">0</b></div><div><span>資格</span><b>渡劫+</b></div></div><div class="fi-note">固定國中程度。沒有總題數，也沒有挑戰次數限制；一路答到第一次錯誤為止。要奪位，必須<strong>嚴格超過</strong>目前仙主紀錄，同分不換榜。</div><div id="fi-body"></div></section>`;
    backdrop.querySelector('.fi-close').onclick = () => closeChallenge();
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeChallenge(); });
    document.body.appendChild(backdrop);
  }

  function closeChallenge() {
    if (challenge?.active && challenge.streak > 0 && !confirm('問鼎尚未答錯，現在離開會放棄本次連答紀錄。確定離開？')) return;
    sessionSerial += 1;
    challenge = null;
    document.getElementById('five-immortal-challenge')?.remove();
  }

  async function startChallenge(roleId) {
    const role = roleById(roleId);
    const user = auth?.currentUser;
    if (!role || !user) { toast('請先登入，才能問鼎五仙。'); return; }
    if (!eligible()) { toast(`只有渡劫以上修士（${TRIBULATION_SCORE} 修為）能問鼎五仙。`); return; }
    const serial = ++sessionSerial;
    challenge = { active: true, serial, role, streak: 0, target: ownerRecord(roleId), busy: false, question: null };
    ensureModal();
    document.getElementById('fi-title').textContent = `問鼎${role.name} · ${role.subject}`;
    document.getElementById('fi-target').textContent = String(challenge.target);
    await nextQuestion(serial);
  }

  async function nextQuestion(serial) {
    if (!challenge?.active || challenge.serial !== serial) return;
    const body = document.getElementById('fi-body');
    if (!body) return;
    challenge.busy = true;
    body.innerHTML = `<div class="fi-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><br><br>天機凝題中…</div>`;
    try {
      const question = await fetchChallengeQuestion(challenge.role);
      if (!challenge?.active || challenge.serial !== serial) return;
      challenge.question = question;
      challenge.busy = false;
      renderQuestion(serial);
    } catch (error) {
      console.warn('五仙問鼎出題失敗', error);
      if (!challenge?.active || challenge.serial !== serial) return;
      challenge.busy = false;
      body.innerHTML = `<div class="fi-result"><div class="fi-result-seal">候</div><h4>天機暫時紊亂</h4><p>這次不算答錯，也不會中止連答。可以直接重新取題。</p><div class="fi-actions"><button id="fi-retry-question" class="fi-primary">重新取題</button></div></div>`;
      document.getElementById('fi-retry-question').onclick = () => nextQuestion(serial);
    }
  }

  function renderQuestion(serial) {
    if (!challenge?.active || challenge.serial !== serial || !challenge.question) return;
    const body = document.getElementById('fi-body');
    const q = challenge.question;
    document.getElementById('fi-streak').textContent = String(challenge.streak);
    body.innerHTML = `<div class="fi-question"><h4>${escapeHtml(q.question)}</h4><div class="fi-options">${q.options.map((option, index) => `<button type="button" class="fi-option" data-answer="${index}"><span>${String.fromCharCode(65 + index)}</span><b>${escapeHtml(option)}</b></button>`).join('')}</div></div>`;
    body.querySelectorAll('[data-answer]').forEach((button) => { button.onclick = () => answerChallenge(Number(button.dataset.answer), serial); });
    try { window.MathJax?.typesetPromise?.([body]); } catch (_) {}
  }

  async function answerChallenge(choice, serial) {
    if (!challenge?.active || challenge.serial !== serial || challenge.busy || !challenge.question) return;
    challenge.busy = true;
    const q = challenge.question;
    const body = document.getElementById('fi-body');
    const buttons = [...body.querySelectorAll('[data-answer]')];
    buttons.forEach((button) => {
      button.disabled = true;
      const index = Number(button.dataset.answer);
      if (index === q.answer) button.classList.add('correct');
      else if (index === choice) button.classList.add('wrong');
    });
    if (choice === q.answer) {
      challenge.streak += 1;
      document.getElementById('fi-streak').textContent = String(challenge.streak);
      setTimeout(() => nextQuestion(serial), 550);
      return;
    }
    challenge.active = false;
    await finishChallenge(serial);
  }

  async function finishChallenge(serial) {
    if (!challenge || challenge.serial !== serial) return;
    const role = challenge.role;
    const streak = challenge.streak;
    const user = auth?.currentUser;
    let result = 'miss';
    let liveTarget = challenge.target;
    try {
      const roleRef = fs.doc(db, 'worldImmortals', role.id);
      const userRef = fs.doc(db, 'users', user.uid);
      await fs.runTransaction(db, async (tx) => {
        const refs = ROLES.map((item) => fs.doc(db, 'worldImmortals', item.id));
        const [userSnap, ...roleSnaps] = await Promise.all([tx.get(userRef), ...refs.map((ref) => tx.get(ref))]);
        if (!userSnap.exists()) throw new Error('NO_USER');
        const latestUser = userSnap.data();
        if ((Number(latestUser.stats?.totalScore) || 0) < TRIBULATION_SCORE) throw new Error('NOT_TRIBULATION');
        const targetIndex = ROLES.findIndex((item) => item.id === role.id);
        const targetSnap = roleSnaps[targetIndex];
        const targetData = targetSnap.exists() ? targetSnap.data() : null;
        liveTarget = Math.max(0, Number(targetData?.challengeScore) || 0);
        const alreadyOwnsOther = roleSnaps.some((snap, index) => snap.exists() && snap.data().uid === user.uid && index !== targetIndex);
        if (alreadyOwnsOther) throw new Error('ALREADY_IMMORTAL');
        if (streak <= liveTarget) return;
        tx.set(roleRef, { uid: user.uid, displayName: latestUser.displayName || user.displayName || '無名仙客', role: role.id, subject: role.subject, challengeScore: streak, previousRecord: liveTarget, claimedAt: fs.serverTimestamp(), challengeLevel: QUIZ_LEVEL, challengeDifficulty: QUIZ_DIFFICULTY });
        result = targetData?.uid === user.uid ? 'improved' : 'claimed';
      });
    } catch (error) {
      if (error.message === 'NOT_TRIBULATION') result = 'not-eligible';
      else if (error.message === 'ALREADY_IMMORTAL') result = 'already-other';
      else { console.error('五仙問鼎結算失敗', error); result = 'error'; }
    }
    await loadOwners();
    showChallengeResult(result, streak, liveTarget, role, serial);
  }

  function showChallengeResult(result, streak, target, role, serial) {
    const body = document.getElementById('fi-body');
    if (!body || !challenge || challenge.serial !== serial) return;
    const success = result === 'claimed' || result === 'improved';
    const title = result === 'claimed' ? `問鼎成功 · 登臨${role.name}` : result === 'improved' ? `仙位鞏固 · 新紀錄 ${streak}` : result === 'already-other' ? '你已位列五仙' : result === 'not-eligible' ? '境界已不足' : result === 'error' ? '天道結算失敗' : streak === target ? '只差一步 · 同分不換榜' : '問鼎未成';
    const message = success ? `本次連答 ${streak} 題，超過原紀錄 ${target} 題。` : result === 'already-other' ? '一名修士同時只能據有一席仙位；可回到自己的仙位刷新紀錄。' : result === 'not-eligible' ? '真正寫榜前再次驗證修為，只有渡劫以上修士可以成為五仙。' : result === 'error' ? '這次沒有改動榜單，可以立即重新挑戰。' : `本次連答 ${streak} 題；目前${role.name}紀錄為 ${target} 題。必須嚴格超過才能奪位。`;
    body.innerHTML = `<div class="fi-result"><div class="fi-result-seal">${success ? '仙' : '問'}</div><h4>${title}</h4><p>${message}</p><div class="fi-actions"><button id="fi-close-result" class="fi-ghost">返回榜單</button><button id="fi-again" class="fi-primary">再次問鼎</button></div></div>`;
    document.getElementById('fi-close-result').onclick = () => closeChallenge();
    document.getElementById('fi-again').onclick = () => startChallenge(role.id);
  }

  function render() {
    const container = document.getElementById('five-immortal-list');
    if (!container) return;
    const uid = auth?.currentUser?.uid || '';
    const sorted = [...ROLES].sort((a, b) => ownerRecord(b.id) - ownerRecord(a.id) || a.id.localeCompare(b.id));
    const renderData = ROLES.map((role) => ({ ...role, rank: sorted.findIndex((item) => item.id === role.id) + 1, owner: owners[role.id] || null }));
    container.innerHTML = renderData.map((role) => {
      const owner = role.owner;
      const mine = owner?.uid === uid;
      const canTry = !!uid && eligible();
      return `<div class="podium-slot rank-${role.rank}"><div class="avatar-wrapper">${avatarHtml(owner?.equipped, role.rank === 1)}</div><div class="immortal-name">${role.name}</div><div class="immortal-subject">${role.subject} · ${role.desc}</div><div class="immortal-owner-box">${owner ? `<div class="immortal-owner">${escapeHtml(owner.displayName || '無名仙客')}</div><div class="immortal-record">連答 ${ownerRecord(role.id)} 題</div><div class="immortal-status">${mine ? '你的仙位' : '在榜仙主'}</div>` : `<div class="immortal-owner" style="color:#625949">仙位懸空</div><div class="immortal-record">紀錄 0 題</div>`}<button class="immortal-btn" data-immortal="${role.id}" ${canTry ? '' : 'disabled'}>${mine ? '刷新紀錄' : owner ? '挑戰仙主' : '問鼎仙位'}</button></div></div>`;
    }).join('');
    container.querySelectorAll('[data-immortal]').forEach((button) => { button.onclick = () => startChallenge(button.dataset.immortal); });
    const lock = document.getElementById('five-immortal-lock');
    if (lock) lock.textContent = eligible() ? '你已達渡劫境，可不限次挑戰五仙；每名修士同時僅能據有一席。' : `五仙問鼎需渡劫境以上（${TRIBULATION_SCORE} 修為）。目前修為：${currentScore()}。`;
  }

  function mount() {
    if (!document.getElementById('five-immortals-style')) {
      const style = document.createElement('style');
      style.id = 'five-immortals-style';
      style.textContent = css;
      document.head.appendChild(style);
    }
    const rank = document.getElementById('page-rank');
    if (!rank) return;
    let box = document.getElementById('five-immortals');
    if (!box) {
      box = document.createElement('section');
      box.id = 'five-immortals';
      box.className = 'five-immortals';
      box.innerHTML = `<div class="five-immortals-head"><h3>九州五大仙</h3><button id="five-immortals-help" class="five-immortals-help" type="button" aria-label="查看五大仙遊戲方式" aria-expanded="false" title="遊戲方式">!</button></div><div id="five-immortals-guide" class="five-immortal-guide" hidden><p>渡劫以上方可問鼎 · 國中程度連答 · 一錯即止 · 超越紀錄者登仙</p><div class="five-immortal-rule"><div><span>境界門檻</span><b>渡劫 · 628 修為</b></div><div><span>問鼎方式</span><b>連續答對直到答錯</b></div><div><span>挑戰限制</span><b>無限次嘗試</b></div></div><p class="five-immortal-extra">每一仙位對應固定科目；挑戰沒有總題數，也沒有次數限制。一路答到第一次答錯為止，只有嚴格超過目前紀錄才能奪位，同分不換榜；每名修士同時只能據有一席仙位。</p></div><div id="five-immortal-list" class="podium-container"></div><div id="five-immortal-lock" class="five-locked"></div>`;
      const anchor = rank.querySelector('.glass-panel') || rank.firstElementChild;
      if (anchor) anchor.before(box); else rank.prepend(box);
    }
    const helpButton = box.querySelector('#five-immortals-help');
    const guide = box.querySelector('#five-immortals-guide');
    if (helpButton && guide && helpButton.dataset.bound !== '1') {
      helpButton.dataset.bound = '1';
      helpButton.addEventListener('click', () => {
        guide.hidden = !guide.hidden;
        helpButton.setAttribute('aria-expanded', String(!guide.hidden));
      });
    }
    render();
  }

  function boot() {
    mount();
    connect();
    window.addEventListener('xiuxian:stats-updated', render);
    window.addEventListener('focus', () => { if (db) loadOwners(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
