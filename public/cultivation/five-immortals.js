// 九州五大仙：以真實配裝挑戰離線守擂化身，擊破後由伺服器授予仙位。
import { resolvePlayerAvatar } from './profile-avatar.js';
import { playerRepository } from './data/player-repository.js';
import { authenticatedMainFetch } from './data/project-repository.js';
import './five-immortals-style.js';
(function () {
  'use strict';

  const TRIBULATION_SCORE = 1268;
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
  let lastLoadedCohort = null;
  let lastCleanupAt = 0;

  const css = `
    .five-immortals{margin:0 0 16px;padding:20px 14px;border:1px solid rgba(216,177,93,.24);border-radius:24px;background:linear-gradient(145deg,rgba(27,22,13,.97),rgba(7,7,7,.98));box-shadow:0 20px 60px rgba(0,0,0,.32);overflow:hidden}.five-immortals h3{margin:0;color:#f5e7c3;font-size:19px;font-weight:900;text-align:center;letter-spacing:.12em}.five-immortals>p{margin:7px 0 0;color:#95866b;font-size:10px;text-align:center;line-height:1.7}.five-immortal-rule{margin:14px auto 0;max-width:720px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.five-immortal-rule div{padding:9px;border:1px solid rgba(216,177,93,.12);border-radius:12px;background:rgba(216,177,93,.03);text-align:center}.five-immortal-rule span{display:block;color:#756a58;font-size:7px}.five-immortal-rule b{display:block;margin-top:3px;color:#d8ba72;font-size:10px}.five-immortals-head{position:relative;display:flex;align-items:center;justify-content:center;min-height:38px;padding:0 44px}.five-immortals-head h3{margin:0}.five-immortals-help{position:absolute;right:2px;top:50%;transform:translateY(-50%);width:32px;height:32px;padding:0;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(216,177,93,.5);background:rgba(216,177,93,.08);color:#e8c66f;font-size:17px;font-weight:900;line-height:1;cursor:pointer;box-shadow:0 0 0 1px rgba(216,177,93,.05),0 8px 24px rgba(0,0,0,.28);transition:.18s ease}.five-immortals-help:hover,.five-immortals-help[aria-expanded="true"]{background:rgba(216,177,93,.18);border-color:rgba(232,198,111,.82);color:#fff0bd;box-shadow:0 0 18px rgba(216,177,93,.16)}.five-immortal-guide{margin:10px auto 0;max-width:720px;padding:12px;border:1px solid rgba(216,177,93,.16);border-radius:16px;background:rgba(216,177,93,.035)}.five-immortal-guide[hidden]{display:none}.five-immortal-guide>p{margin:0;color:#9b8c70;font-size:9px;text-align:center;line-height:1.75}.five-immortal-guide .five-immortal-rule{margin-top:10px}.five-immortal-guide .five-immortal-extra{margin-top:10px;color:#81755f;font-size:8px}.podium-container{display:flex;justify-content:center;align-items:flex-end;gap:6px;margin-top:48px;min-height:220px}.podium-slot{display:flex;flex-direction:column;align-items:center;width:19%;min-width:0;background:rgba(255,255,255,.025);border:1px solid rgba(216,177,93,.14);border-bottom:none;border-radius:9px 9px 0 0;padding:10px 3px 6px;position:relative}.rank-1{order:3;height:190px;background:linear-gradient(to top,rgba(216,177,93,.14),rgba(255,255,255,.02));border-color:rgba(216,177,93,.46)}.rank-2{order:2;height:158px}.rank-3{order:4;height:142px}.rank-4{order:1;height:124px}.rank-5{order:5;height:108px}.avatar-wrapper{position:absolute;top:-25px;left:50%;transform:translateX(-50%);z-index:4}.rank-1 .avatar-wrapper{top:-37px;filter:drop-shadow(0 0 14px rgba(216,177,93,.45))}.immortal-name{font-size:11px;font-weight:900;color:#f2e4c4;margin-top:23px;text-align:center}.rank-1 .immortal-name{font-size:14px;color:#f6dc93;margin-top:34px}.immortal-subject{font-size:8px;font-weight:900;color:#b89a55;margin-top:3px}.immortal-owner-box{margin-top:auto;width:100%;display:flex;flex-direction:column;align-items:center;gap:3px}.immortal-owner{font-size:9px;color:#b6a98c;text-align:center;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%}.immortal-record{font-size:8px;color:#d7b96d;font-weight:900}.immortal-status{font-size:7px;color:#8d8067}.immortal-btn{margin-top:4px;padding:5px 3px;width:94%;border-radius:7px;border:1px solid rgba(216,177,93,.38);background:rgba(216,177,93,.09);color:#f0d997;font-size:9px;font-weight:900;cursor:pointer}.immortal-btn:disabled{opacity:.36;cursor:not-allowed}.five-locked{margin-top:14px;text-align:center;color:#9f725f;font-size:9px}.fi-backdrop{position:fixed;inset:0;z-index:8200;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.86);backdrop-filter:blur(12px)}.fi-modal{width:min(100%,650px);max-height:90dvh;overflow:auto;border:1px solid rgba(216,177,93,.35);border-radius:26px;background:radial-gradient(circle at 50% 0,rgba(216,177,93,.12),transparent 30%),linear-gradient(145deg,#1a150c,#070707);box-shadow:0 35px 110px rgba(0,0,0,.7);padding:22px;color:#eee1c1}.fi-head{display:flex;justify-content:space-between;gap:10px;align-items:start}.fi-kicker{font-size:8px;letter-spacing:.2em;color:#a58a50;font-weight:900}.fi-head h3{margin:4px 0 0;font-size:24px;color:#f4e2b9}.fi-close{width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.08);background:#10100e;color:#aa9a7b}.fi-scoreboard{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:16px 0}.fi-scoreboard div{padding:10px;border:1px solid rgba(216,177,93,.12);border-radius:12px;background:rgba(255,255,255,.02);text-align:center}.fi-scoreboard span{display:block;color:#756b59;font-size:7px}.fi-scoreboard b{display:block;margin-top:4px;color:#e0bd69;font-size:16px}.fi-note{padding:9px 11px;border-left:2px solid #b78c39;background:rgba(216,177,93,.04);color:#97886d;font-size:9px;line-height:1.6}.fi-loading{padding:48px 10px;text-align:center;color:#aa9564;font-size:11px}.fi-question{margin-top:16px;padding:16px;border:1px solid rgba(216,177,93,.14);border-radius:18px;background:rgba(255,255,255,.02)}.fi-question h4{margin:0;color:#f0e2c4;font-size:17px;line-height:1.65}.fi-options{display:grid;gap:8px;margin-top:14px}.fi-option{min-height:48px;display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:12px;border:1px solid rgba(216,177,93,.14);background:rgba(255,255,255,.025);color:#d8c7a4;text-align:left}.fi-option:hover:not(:disabled){border-color:rgba(216,177,93,.42);background:rgba(216,177,93,.06)}.fi-option span{width:25px;height:25px;flex:0 0 25px;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(216,177,93,.24);color:#dabb68;font-size:9px}.fi-option.correct{border-color:rgba(92,170,112,.55);background:rgba(61,126,76,.12)}.fi-option.wrong{border-color:rgba(190,83,66,.55);background:rgba(143,52,42,.12)}.fi-result{text-align:center;padding:28px 8px 10px}.fi-result-seal{width:74px;height:74px;margin:0 auto 12px;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(216,177,93,.4);color:#e4bf65;font:900 30px serif}.fi-result h4{margin:0;color:#f1e1bb;font-size:23px}.fi-result p{color:#9b8d72;font-size:10px;line-height:1.7}.fi-actions{display:flex;justify-content:center;gap:8px;margin-top:15px}.fi-actions button{min-height:40px;padding:0 16px;border-radius:12px;font-size:10px;font-weight:900}.fi-primary{border:1px solid #c69b41;background:linear-gradient(135deg,#9a6d22,#5d3a0c);color:#fff0c7}.fi-ghost{border:1px solid rgba(216,177,93,.2);background:rgba(216,177,93,.04);color:#c8b68d}@media(max-width:640px){.podium-container{gap:3px}.podium-slot{padding-left:1px;padding-right:1px}.immortal-owner{font-size:7px}.immortal-btn{font-size:7px}.five-immortal-rule{grid-template-columns:1fr}.fi-scoreboard{grid-template-columns:repeat(3,1fr)}}
  `;

  function userData() { return window.getCurrentUserData?.() || null; }
  function currentScore() { return Math.max(0, Number(userData()?.stats?.totalScore) || 0); }
  function currentGroup() { return window.getLeaderboardEducationGroup?.(userData()?.profile?.educationLevel) || null; }
  function eligible() { return !!currentGroup() && currentScore() >= TRIBULATION_SCORE; }
  function roleById(id) { return ROLES.find((r) => r.id === id) || null; }
  function ownerRecord(id) { return Math.max(0, Number(owners[id]?.avatarPower || owners[id]?.avatar?.power) || 0); }
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
    return `<div class="${frameClass}" style="width:${size}px;height:${size}px;border-radius:50%;position:relative;background:#181612;border:1px solid rgba(216,177,93,.22);display:grid;place-items:center;overflow:visible"><div class="ui-avatar-viewport" style="width:100%;height:100%;border-radius:50%;overflow:hidden;display:grid;place-items:center">${avatar ? `<img src="${escapeHtml(avatar)}" class="ui-avatar-image" style="width:100%;height:100%;object-fit:cover" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><i class="ui-avatar-fallback fa-solid fa-user" hidden></i>` : '<i class="fa-solid fa-user" style="color:#776b57"></i>'}</div>${isFrameImage ? `<img src="${escapeHtml(frame)}" class="ui-avatar-frame" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);height:145%;max-width:none;pointer-events:none">` : ''}</div>`;
  }

  async function connect() {
    try {
      const [appModule, authModule, firestoreModule] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'),
        import('../data-store.js')
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
      // Server-side migration moves old shared seats to their owner's school cohort.
      // If unavailable, the local eligibility filter below still keeps the board clean.
      try {
        const needsCleanup = Date.now() - lastCleanupAt > 180000;
        const token = needsCleanup ? await auth?.currentUser?.getIdToken?.() : null;
        if (token) {
          const cleaned = await fetch('/api/immortals/prune-ineligible', {
            method: 'POST', cache: 'no-store',
            headers: { 'Authorization': 'Bearer ' + token }
          });
          if (cleaned.ok) lastCleanupAt = Date.now();
          else console.warn('[Five Immortals] background seat cleanup deferred:', cleaned.status);
        }
      } catch (cleanupError) {
        console.warn('[Five Immortals] background cleanup unavailable:', cleanupError?.message || cleanupError);
      }
      const cohort = currentGroup();
      if (!cohort) { owners = {}; lastLoadedCohort = null; render(); return; }
      const snap = await fs.getDocs(fs.query(
        fs.collection(db, 'worldImmortals'), fs.where('cohort', '==', cohort)
      ));
      if (cohort !== currentGroup()) return;
      lastLoadedCohort = cohort;
      owners = {};
      const uids = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const prefix = cohort + '__';
        if (!docSnap.id.startsWith(prefix)) return;
        const role = docSnap.id.slice(prefix.length);
        if (!ROLES.some(item => item.id === role) || data.cohort !== cohort) return;
        owners[role] = data;
        if (data.uid && !uids.includes(data.uid)) uids.push(data.uid);
      });
      const profiles = {};
      // The shared Firestore/D1 transport does not expose documentId().
      // Read the small number of seat owners directly by document path instead.
      for (const uid of [...new Set(uids)]) {
        const docSnap = await fs.getDoc(fs.doc(db, 'users', uid));
        if (!docSnap.exists()) continue;
        const data = docSnap.data();
        profiles[docSnap.id] = {
          displayName: data.displayName || data.name || '無名仙客',
          equipped: { ...data.equipped, avatar: resolvePlayerAvatar(data) },
          totalScore: Math.max(0, Number(data.stats?.totalScore) || 0),
          cohort: window.getLeaderboardEducationGroup?.(data.profile?.educationLevel)
        };
      }
      Object.keys(owners).forEach((roleId) => {
        const owner = owners[roleId];
        const profile = profiles[owner.uid];
        // Filter historical placements if the owner was deleted or fell below Tribulation.
        if (!profile || profile.totalScore < TRIBULATION_SCORE || profile.cohort !== cohort) {
          delete owners[roleId];
          return;
        }
        owner.displayName = profile.displayName || owner.displayName || '無名仙客';
        owner.equipped = profile.equipped || owner.equipped || null;
        owner.totalScore = profile.totalScore || 0;
      });
    } catch (error) {
      console.warn('五仙榜讀取失敗', error);
    }
    render();
  }

  async function request(path, body) {
    const response = await authenticatedMainFetch(path, body === undefined ? {} : {
      method:'POST',body:JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) throw new Error(data.error || '戰場同步失敗，請重試');
    return data;
  }
  function alive(serial) { return challenge?.serial === serial && !!document.getElementById('five-immortal-challenge'); }
  function closeChallenge() {
    const focus = challenge?.returnFocus;
    sessionSerial += 1; challenge = null;
    document.getElementById('five-immortal-challenge')?.remove();
    focus?.focus?.();
  }
  function ensureModal(role) {
    document.getElementById('five-immortal-challenge')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'five-immortal-challenge'; overlay.className = 'fi-backdrop';
    overlay.innerHTML = `<section class="fi-modal fi-avatar-modal" role="dialog" aria-modal="true" aria-labelledby="fi-title" tabindex="-1"><header class="fi-head"><div><span class="fi-kicker">IMMORTAL AVATAR · 化身試煉</span><h3 id="fi-title">${escapeHtml(role.name)}問鼎</h3></div><button class="fi-close" aria-label="暫離戰場">×</button></header><p class="fi-error" id="fi-error" role="alert"></p><div id="fi-body" aria-live="polite"><div class="fi-loading">正在連接化身戰場…</div></div></section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.fi-close').onclick = closeChallenge;
    overlay.addEventListener('keydown',event=>{
      if (event.key === 'Escape') { event.preventDefault(); closeChallenge(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...overlay.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(el=>el.offsetParent);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === overlay.querySelector('section'))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    overlay.querySelector('section').focus();
  }
  function showError(error, serial) {
    if (alive(serial)) {
      document.getElementById('fi-error').textContent = error.message || String(error);
      document.querySelector('.fi-avatar-modal').scrollTop = 0;
    }
  }
  function clearError() { const el = document.getElementById('fi-error'); if (el) el.textContent = ''; }
  const format = value => Math.max(0,Number(value)||0).toLocaleString('zh-TW');
  function fighterHtml(player, enemy = false) {
    const percent = Math.min(100,Math.max(0,player.hp / Math.max(1,player.maxHp) * 100));
    return `<article class="fi-fighter ${enemy ? 'fi-enemy' : ''}"><div class="fi-fighter-top"><span>${enemy ? '守擂化身' : '挑戰者'}</span><b>戰力 ${format(player.power)}</b></div><h4>${escapeHtml(player.name)}</h4><div class="fi-hp-label"><b>${format(player.hp)} <small>/ ${format(player.maxHp)}</small></b><span>攻擊 ${format(player.atk)}</span></div><div class="fi-hp" role="progressbar" aria-label="${enemy ? '化身' : '挑戰者'}生命" aria-valuemin="0" aria-valuemax="${player.maxHp}" aria-valuenow="${player.hp}"><i style="width:${percent}%"></i></div><div class="fi-build"><span>${escapeHtml(player.goldenCore?.name || '未調御金丹')}</span><span>${player.nascentSoul ? '元嬰已啟用' : '未啟用元嬰'}</span>${player.innateAbility ? `<span>神通已啟用</span>` : ''}${player.shield ? `<span>護盾 ${format(player.shield)}</span>` : ''}</div><div class="fi-equipment">${escapeHtml((player.equipment || []).join(' · ') || '未裝備法器')}</div></article>`;
  }
  function styleChoices(current = 'assault') {
    return `<fieldset class="fi-styles"><legend>我的守擂風格</legend>${[['assault','強攻','積極進攻，每三回合重擊'],['sustain','續戰','輪流防守、回復、出手'],['counter','反擊','先守後攻，伺機重擊']].map(([id,name,desc])=>`<label><input type="radio" name="fi-style" value="${id}" ${id === current ? 'checked' : ''}><span><b>${name}</b><small>${desc}</small></span></label>`).join('')}</fieldset>`;
  }
  function showLobby(serial) {
    if (!alive(serial)) return;
    const run = challenge, owner = owners[run.role.id], mine = owner?.uid === auth?.currentUser?.uid;
    const title = mine ? '留下你的守擂化身' : owner ? '擊敗仙主，登臨仙位' : '擊破鎮殿化身，問鼎空席';
    document.getElementById('fi-body').innerHTML = `<div class="fi-lobby"><div class="fi-lobby-seal">${mine ? '鎮' : '戰'}</div><h4>${title}</h4><p>把養成帶上戰場。金丹、元嬰、神通與法器會實際出手，<br>答題決定出手機會，戰術決定攻守節奏。</p></div>${owner?.avatar ? `<div class="fi-preview">${fighterHtml(owner.avatar, true)}</div>` : `<div class="fi-note">${owner ? '首次挑戰會依仙主目前配裝建立化身。' : '此席由 NPC 鎮守，擊敗後即可入榜。'}</div>`}<div class="fi-battle-rules"><span>最多 24 回合</span><span>${currentGroup() === 'elementary' ? '國小' : '國中'} · ${run.role.subject}</span><span>答錯可繼續</span></div>${styleChoices(owner?.avatarStyle)}<p class="fi-caption">${mine ? '更新時保存目前配裝，仙主離線也會自動守擂。更新後，進行中的舊化身挑戰無法奪位。' : '奪位後以本次出戰配裝與選定風格自動守擂。24 回合內須擊倒化身且自己存活；同歸於盡由仙主守位。'}</p><div class="fi-actions">${mine ? '<button id="fi-configure" class="fi-ghost">更新守擂化身</button>' : ''}<button id="fi-start" class="fi-primary">${mine ? '以自身化身試陣' : '開始挑戰'}</button></div>${mine && owner.recentDefenses?.length ? `<div class="fi-defense"><h4>最近守擂</h4>${owner.recentDefenses.map(r=>`<p><span>${escapeHtml(r.challenger)}</span><b>${r.won ? '化身被擊破' : '成功守住'} · ${r.round} 回合</b></p>`).join('')}</div>` : ''}`;
    document.querySelector('.fi-avatar-modal').scrollTop = 0;
    const selectedStyle = () => document.querySelector('[name="fi-style"]:checked')?.value || 'assault';
    document.getElementById('fi-start').onclick = async () => {
      if (run.busy) return; run.busy = true; clearError();
      const button = document.getElementById('fi-start'); button.disabled = true;
      try {
        const data = await request('/api/immortals/challenge/start',{role:run.role.id,style:selectedStyle()});
        if (!alive(serial)) return;
        run.state = data.state; run.busy = false; run.tactic = 'assault';
        await nextQuestion(serial);
      } catch (error) { showError(error,serial); }
      finally { if (alive(serial)) { run.busy = false; button.disabled = false; } }
    };
    const configure = document.getElementById('fi-configure');
    if (configure) configure.onclick = async () => {
      if (run.busy) return; run.busy = true; configure.disabled = true; clearError();
      try {
        await request('/api/immortals/challenge/configure',{role:run.role.id,style:selectedStyle()});
        await loadOwners(); if (!alive(serial)) return;
        run.busy = false; showLobby(serial); toast('守擂化身已保存目前配裝');
      } catch (error) { showError(error,serial); }
      finally { if (alive(serial)) { run.busy = false; configure.disabled = false; } }
    };
  }
  async function startChallenge(roleId) {
    const role = roleById(roleId);
    if (!role || !auth?.currentUser || !eligible()) { toast('請先登入並達到渡劫境，再問鼎仙位'); return; }
    if (challenge) return;
    const returnFocus = document.activeElement, serial = ++sessionSerial;
    challenge = {serial,role,returnFocus,busy:false,state:null,tactic:'assault',nextPromise:null};
    ensureModal(role);
    try {
      const {state} = await request('/api/immortals/challenge');
      if (!alive(serial)) return;
      if (state.status === 'active') {
        challenge.state = state; challenge.role = roleById(state.role);
        document.getElementById('fi-title').textContent = state.roleName + '問鼎';
        document.getElementById('fi-body').innerHTML = `<div class="fi-lobby"><div class="fi-lobby-seal">續</div><h4>你的戰場還在</h4><p>${escapeHtml(state.roleName)} · 已完成 ${state.round} 回合<br>暫離不會丟失進度，一小時內可續戰。</p></div><div class="fi-arena">${fighterHtml(state.challenger)}${fighterHtml(state.defender,true)}</div><div class="fi-actions"><button id="fi-abandon" class="fi-ghost">結束這場挑戰</button><button id="fi-resume" class="fi-primary">繼續戰鬥</button></div>`;
        document.getElementById('fi-resume').onclick = () => nextQuestion(serial);
        document.getElementById('fi-abandon').onclick = () => abandonChallenge(serial);
      } else showLobby(serial);
    } catch (error) {
      showError(error,serial);
      if (alive(serial)) {
        document.getElementById('fi-body').innerHTML = '<div class="fi-actions"><button id="fi-reconnect" class="fi-primary">重新同步</button></div>';
        document.getElementById('fi-reconnect').onclick = () => { closeChallenge(); void startChallenge(roleId); };
      }
    }
  }
  async function abandonChallenge(serial) {
    if (!alive(serial) || challenge.busy) return;
    const run = challenge; run.busy = true; clearError();
    try {
      await request('/api/immortals/challenge/abandon',{runId:run.state.runId});
      if (!alive(serial)) return;
      run.state = null; run.busy = false; run.nextPromise = null; showLobby(serial);
    } catch (error) { showError(error,serial); }
    finally { if (alive(serial)) run.busy = false; }
  }
  async function fetchChallengeQuestion(run) {
    const data = await request('/api/generate-quiz',{quizMode: 'immortal-avatar',quizSessionId:run.state.runId});
    const q = data.avatarQuestion;
    if (!q?.id || !q.ticket || !q.q || !Array.isArray(q.opts) || q.opts.length !== 4) throw new Error('題目尚未準備完成，請重試');
    return q;
  }
  function prefetchNextChallengeQuestion(serial) {
    if (!alive(serial) || challenge.state?.status !== 'active') return;
    const run = challenge;
    if (!run.nextPromise) run.nextPromise = fetchChallengeQuestion(run).then(q=>({q}),error=>({error}));
  }
  async function nextQuestion(serial) {
    if (!alive(serial) || challenge.busy) return;
    const run = challenge;
    if (run.state?.status !== 'active') return showBattle(serial);
    run.busy = true; clearError();
    document.getElementById('fi-body').innerHTML = `<div class="fi-arena">${fighterHtml(run.state.challenger)}${fighterHtml(run.state.defender,true)}</div><div class="fi-loading">正在準備第 ${run.state.round + 1} 回合…</div>`;
    try {
      const waiting = run.nextPromise;
      const result = run.state.question ? {q:run.state.question} : waiting ? await waiting : {q:await fetchChallengeQuestion(run)};
      if (!alive(serial)) return;
      run.nextPromise = null;
      if (result.error) throw result.error;
      run.state.question = result.q; run.reviewing = false; run.busy = false;
      showBattle(serial);
    } catch (error) {
      if (!alive(serial)) return;
      run.nextPromise = null; showError(error,serial);
      document.getElementById('fi-body').insertAdjacentHTML('beforeend','<div class="fi-actions"><button id="fi-retry-question" class="fi-primary">重試準備題目</button></div>');
      document.getElementById('fi-retry-question').onclick = () => nextQuestion(serial);
    } finally { if (alive(serial)) run.busy = false; }
  }
  function showBattle(serial) {
    if (!alive(serial)) return;
    const run = challenge, s = run.state, review = run.reviewing ? s.lastReview : null, q = s.question;
    const finished = s.status !== 'active';
    const messages = {claimed:['問鼎成功','你的化身已登臨仙位，將依所選風格自動守擂。'],
      practice:[s.result?.won ? '試陣成功' : '試陣結束','這場為自身化身試陣，仙位保留。可調整配裝再試。'],
      changed:['化身已更替','本場戰鬥已完成；對手仙位或配裝於戰鬥中更新，請挑戰新的化身。'],
      'already-other':['你已位列五仙','每名修士同時只能據有一席仙位。'],
      fallen:['問鼎未成','你的生命耗盡。調整配裝與攻守節奏，再次挑戰。'],
      limit:['仙主守位','已達 24 回合。限時內擊破化身且自己存活，才可奪位。']};
    const result = messages[s.result?.code] || ['挑戰已結束','可以返回榜單重新挑戰。'];
    document.getElementById('fi-body').innerHTML = `<div class="fi-round"><span>${s.practice ? '自身試陣' : s.npc ? '鎮殿試煉' : '仙位爭奪'} · ${escapeHtml(s.styleName)}化身</span><b>回合 ${s.round}${finished ? '' : ' → ' + (s.round + 1)} / ${s.maxRounds}</b></div><div class="fi-arena ${review ? 'fi-resolved' : ''}">${fighterHtml(s.challenger)}${fighterHtml(s.defender,true)}</div>${finished ? `<div class="fi-outcome ${s.result?.claimed ? 'fi-victory' : ''}"><span>${s.result?.claimed ? '仙' : '試'}</span><div><h4>${result[0]}</h4><p>${result[1]}</p></div></div>` : `<div class="fi-intent"><span>化身下一步</span><strong>${escapeHtml(s.intent.name)}</strong><p>${escapeHtml(s.intent.hint)}</p></div>`}${review ? reviewHtml(review, run.lastQuestion) : ''}${!finished && !review && q ? `<div class="fi-tactics" role="group" aria-label="作戰方式">${[['assault','強攻','120% 攻擊，釋放蓄力'],['guard','守勢','70% 攻擊，化身攻擊降為 45%'],['charge','蓄力','35% 攻擊，下次強攻每層 +65%']].map(([id,name,desc])=>`<button data-tactic="${id}" aria-pressed="${run.tactic === id}"><b>${name}</b><small>${desc}</small></button>`).join('')}</div><div class="fi-charge">靈力 ${'●'.repeat(s.charge)}${'○'.repeat(2 - s.charge)} <span>先選戰術，再作答出手</span></div><div class="fi-question"><div class="fi-question-meta">${escapeHtml(s.subject)} · ${escapeHtml(s.level)} · 第 ${s.round + 1} 題</div><h4>${escapeHtml(q.q)}</h4><div class="fi-options">${q.opts.map((opt,i)=>`<button class="fi-option" data-answer="${i}"><span>${'ABCD'[i]}</span><b>${escapeHtml(opt)}</b></button>`).join('')}</div></div>` : ''}<div class="fi-actions">${finished ? '<button id="fi-finish" class="fi-ghost">返回榜單</button><button id="fi-again" class="fi-primary">再次問鼎</button>' : review ? '<button id="fi-next" class="fi-primary">下一回合</button>' : ''}</div>${!finished ? '<p class="fi-caption">可隨時暫離，一小時內續戰。答錯僅失去該回合出手，生命耗盡才落敗。</p>' : ''}`;
    document.querySelector('.fi-avatar-modal').scrollTop = 0;
    document.querySelectorAll('[data-tactic]').forEach(button=>button.onclick=()=>{
      if (run.busy) return; run.tactic = button.dataset.tactic;
      document.querySelectorAll('[data-tactic]').forEach(b=>b.setAttribute('aria-pressed',String(b === button)));
    });
    document.querySelectorAll('[data-answer]').forEach(button=>button.onclick=()=>answerChallenge(Number(button.dataset.answer),serial));
    const next = document.getElementById('fi-next'); if (next) next.onclick = () => nextQuestion(serial);
    const finish = document.getElementById('fi-finish'); if (finish) finish.onclick = closeChallenge;
    const again = document.getElementById('fi-again'); if (again) again.onclick = () => {
      run.state = null; run.nextPromise = null; run.reviewing = false; clearError(); showLobby(serial);
    };
    window.renderMathInElement?.(document.getElementById('fi-body'),{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false}],throwOnError:false});
  }
  function reviewHtml(review, q) {
    const title = review.correct ? '回答正確 · 已出手' : '回答錯誤 · 化身趁隙出手';
    return `<section class="fi-review ${review.correct ? 'is-correct' : 'is-wrong'}"><h4>${title}</h4>${q ? `<p>正解：${escapeHtml(q.opts[review.correctIndex])}</p>` : ''}<p>${escapeHtml(review.explanation)}</p><div class="fi-combat-log">${review.notes.map(note=>`<p>${escapeHtml(note)}</p>`).join('')}${review.logs.map(log=>`<p><b>${log.actorRole === 'host' ? '你' : '化身'}</b> · ${escapeHtml(log.skill || (log.type === 'heal' ? '回復' : '出手'))} <strong>${format(log.damage || log.heal || 0)}</strong></p>`).join('')}${(review.activations || []).map(a=>`<p class="fi-activation">${escapeHtml(a.skill || a.name)} · ${escapeHtml(a.message)}</p>`).join('')}</div></section>`;
  }
  function preserveChallengeAnswer(q, choice, serial) {
    const run = challenge, user = auth?.currentUser, review = run?.state?.lastReview;
    if (!run || run.serial !== serial || !user?.uid || !review) return;
    const key = 'immortal_' + user.uid + '_' + run.state.runId + '_' + review.round;
    void playerRepository.saveExamAnswer(key,{
      mode:'immortal',topic:'Immortal',rankAtTime:'化身問鼎 · ' + run.role.name,
      question:q.q,options:q.opts,correctIdx:review.correctIndex,userIdx:choice,
      explanation:review.explanation,subject:run.role.subject,
      ...globalThis.QAKnowledgePoints.metadata(q,run.role.subject),
      subTopic:run.role.name,isCorrect:review.correct,timeTaken:0
    }).catch(error=>console.warn('[Immortal answer history]',error?.message||error));
  }
  async function answerChallenge(choice, serial) {
    if (!alive(serial) || challenge.busy || !challenge.state?.question) return;
    const run = challenge, q = run.state.question;
    run.busy = true; clearError();
    document.querySelectorAll('[data-answer],[data-tactic]').forEach(b=>b.disabled=true);
    try {
      const {state} = await request('/api/immortals/challenge/answer',{runId:run.state.runId,round:run.state.round,
        questionId:q.id,ticket:q.ticket,choice,tactic:run.tactic});
      if (!alive(serial)) return;
      run.state = state; run.lastQuestion = q; run.reviewing = true; run.busy = false;
      globalThis.QAGameAudio?.answer(state.lastReview.correct,'immortal:' + state.runId + ':' + state.round);
      preserveChallengeAnswer(q, choice, serial);
      showBattle(serial);
      if (state.status === 'active') prefetchNextChallengeQuestion(serial);
      else { void loadOwners(); window.dispatchEvent(new CustomEvent('xiuxian:immortals-updated')); }
    } catch (error) {
      if (!alive(serial)) return;
      showError(error,serial);
      document.getElementById('fi-error').insertAdjacentHTML('beforeend',' <button id="fi-sync" class="fi-ghost">同步進度</button>');
      document.getElementById('fi-sync').onclick = async () => {
        try {
          const {state} = await request('/api/immortals/challenge'); if (!alive(serial)) return;
          run.state = state; run.reviewing = state.lastReview?.questionId === q.id; run.lastQuestion = q; clearError();
          if (run.reviewing) { preserveChallengeAnswer(q,state.lastReview.selectedChoice,serial); showBattle(serial); }
          else await nextQuestion(serial);
        } catch (syncError) { showError(syncError,serial); }
      };
      document.querySelectorAll('[data-answer],[data-tactic]').forEach(b=>b.disabled=false);
    } finally { if (alive(serial)) run.busy = false; }
  }

  function render() {
    const container = document.getElementById('five-immortal-list');
    if (!container) return;
    const uid = auth?.currentUser?.uid || '';
    const cohort = currentGroup();
    if (!cohort) {
      container.innerHTML = '<p style="padding:26px 12px;text-align:center;color:#cdbb91">請先到設定頁設定年級，才能查看你的五大仙榜。 <button type="button" id="five-set-grade" style="text-decoration:underline;color:#c9eedc">前往設定</button></p>';
      container.querySelector('#five-set-grade')?.addEventListener('click', () => window.switchToPage?.('page-settings'));
      const note = document.getElementById('five-immortal-lock');
      if (note) note.textContent = '';
      return;
    }
    const sorted = [...ROLES].sort((a, b) => ownerRecord(b.id) - ownerRecord(a.id) || a.id.localeCompare(b.id));
    const renderData = ROLES.map((role) => ({ ...role, rank: sorted.findIndex((item) => item.id === role.id) + 1, owner: owners[role.id] || null }));
    container.innerHTML = renderData.map((role) => {
      const owner = role.owner;
      const mine = owner?.uid === uid;
      const canTry = !!uid && !!cohort && eligible();
      return `<div class="podium-slot rank-${role.rank}"><div class="avatar-wrapper">${avatarHtml(owner?.equipped, role.rank === 1)}</div><div class="immortal-name">${role.name}</div><div class="immortal-subject">${role.subject} · ${role.desc}</div><div class="immortal-owner-box">${owner ? `<div class="immortal-owner">${escapeHtml(owner.displayName || '無名仙客')}</div><div class="immortal-record">${ownerRecord(role.id) ? '戰力 ' + format(ownerRecord(role.id)) : '化身待同步'}</div><div class="immortal-status">${mine ? '你的仙位' : '在榜仙主'}</div>` : `<div class="immortal-owner" style="color:#625949">仙位懸空</div><div class="immortal-record">鎮殿化身守位</div>`}<button class="immortal-btn" data-immortal="${role.id}" ${canTry ? '' : 'disabled'}>${mine ? '管理化身' : owner ? '挑戰化身' : '問鼎仙位'}</button></div></div>`;
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
      box.innerHTML = `<div class="five-immortals-head"><h3>九州五大仙</h3><button id="five-immortals-help" class="five-immortals-help" type="button" aria-label="查看五大仙遊戲方式" aria-expanded="false" title="遊戲方式">!</button></div><div id="five-immortals-guide" class="five-immortal-guide" hidden><p>渡劫以上方可問鼎 · 戰力實戰 · 離線化身守擂 · 榜上五席方為真仙</p><div class="five-immortal-rule"><div><span>境界門檻</span><b>渡劫 · 1268 修為</b></div><div><span>問鼎方式</span><b>擊破仙主化身</b></div><div><span>挑戰限制</span><b>無限次嘗試</b></div></div><p class="five-immortal-extra">每一仙位對應固定科目，依學制出題；金丹、元嬰、神通與法器皆會參戰。選擇強攻、守勢或蓄力，答錯僅失去當回合出手機會。24 回合內擊破化身且自己存活即可奪位；沒有挑戰次數限制，每名修士同時只能據有一席仙位。仙主可保存配裝與守擂風格，離線也會自動應戰。真仙境界須同時達到 1868 修為並在榜；掉榜後恢復半仙，修為保留。</p></div><div id="five-immortal-list" class="podium-container"></div><div id="five-immortal-lock" class="five-locked"></div>`;
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
    const refreshIfCohortChanged = () => {
      if (currentGroup() !== lastLoadedCohort && db) void loadOwners();
      else render();
    };
    window.addEventListener('xiuxian:user-data-ready', refreshIfCohortChanged);
    window.addEventListener('xiuxian:quest-progress-updated', refreshIfCohortChanged);
    window.addEventListener('focus', () => { if (db) loadOwners(); });
    window.addEventListener('xiuxian:appearance-updated', () => { if (db) void loadOwners(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
