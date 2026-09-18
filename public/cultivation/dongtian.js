import { getApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, query, where, limit,
  setDoc, updateDoc, writeBatch, runTransaction, serverTimestamp, increment, addDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

(function () {
  'use strict';

  const LEVELS = ['國小中年級', '國小高年級', '國中一年級', '國中二年級', '國中三年級', '高中職', '大學以上'];
  const ENCOUNTER_CHANCE = 0.20;
  const MAX_IMAGES = 8;
  const OWNER_CULTIVATION_REWARD = 1;
  const OWNER_GOLD_REWARD = 5;
  const FIRST_COMPLETION_SPIRIT_STONE_PER_QUESTION = 100;
  const FIRST_COMPLETION_MIN_SPIRIT_STONES = 1000;
  const INDEX_COLLECTION = 'dongtianIndex';
  const DATA_COLLECTION = 'dongtians';
  const PLAY_COLLECTION = 'dongtianPlays';
  const REPORT_COLLECTION = 'dongtianReports';

  const auth = getAuth(getApp());
  const db = getFirestore(getApp());
  const state = {
    files: [],
    session: null,
    mounted: false,
    generating: false,
    encounterBusy: false,
    originalStartQuizFlow: null,
    listLoaded: false,
    moderationBusy: false
  };

  function userData() { return window.getCurrentUserData?.() || null; }
  function uid() { return auth.currentUser?.uid || ''; }
  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function levelOrder(level) { return LEVELS.indexOf(level); }
  function difficultyLabel(value) { return ({ easy: '簡單', medium: '中等', hard: '困難' })[value] || value || '中等'; }
  function firstCompletionSpiritStones(questionCount) {
    const count = Math.max(0, Math.floor(Number(questionCount) || 0));
    return Math.max(FIRST_COMPLETION_MIN_SPIRIT_STONES, count * FIRST_COMPLETION_SPIRIT_STONE_PER_QUESTION);
  }
  function shuffle(items) {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function toast(message) {
    const el = document.createElement('div');
    el.className = 'dt-toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  const css = `
    .dongtian-card .dongfu-collapse-icon{color:#d4a5ff;border-color:rgba(183,123,255,.25);background:rgba(183,123,255,.06)}
    .dt-body{display:grid;gap:14px}.dt-create{padding:14px;border:1px solid rgba(187,134,252,.16);border-radius:18px;background:radial-gradient(circle at 100% 0,rgba(162,96,236,.08),transparent 35%),rgba(255,255,255,.015)}
    .dt-create h4,.dt-library h4{margin:0 0 5px;color:#f0e1ff;font-size:12px;font-weight:900}.dt-create p,.dt-library-note{margin:0 0 12px;color:#81748d;font-size:9px;line-height:1.65}.dt-input{width:100%;min-height:112px;resize:vertical;padding:11px 12px;border-radius:13px;border:1px solid rgba(216,177,93,.16);background:#0c0b0d;color:#eadff0;font-size:11px;outline:none}.dt-input:focus{border-color:rgba(188,133,248,.55);box-shadow:0 0 0 3px rgba(174,112,238,.07)}
    .dt-upload-row{display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap}.dt-upload{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:0 12px;border-radius:11px;border:1px solid rgba(187,134,252,.25);background:rgba(164,103,224,.06);color:#d9b8ff;font-size:9px;font-weight:900;cursor:pointer}.dt-upload input{display:none}.dt-image-count{color:#72667a;font-size:8px}.dt-previews{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:7px;margin-top:9px}.dt-preview{position:relative;aspect-ratio:1;border-radius:11px;overflow:hidden;border:1px solid rgba(255,255,255,.08);background:#090909}.dt-preview img{width:100%;height:100%;object-fit:cover}.dt-preview button{position:absolute;right:4px;top:4px;width:22px;height:22px;border:0;border-radius:50%;background:rgba(0,0,0,.72);color:#f3d8ff;font-size:9px}
    .dt-amount{margin-top:11px}.dt-amount-title{display:block;margin-bottom:6px;color:#9e8ca8;font-size:8px;font-weight:900;letter-spacing:.08em}.dt-amount-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.dt-amount-choice{position:relative;cursor:pointer}.dt-amount-choice input{position:absolute;opacity:0;pointer-events:none}.dt-amount-choice span{min-height:38px;display:flex;align-items:center;justify-content:center;gap:5px;padding:7px 8px;border:1px solid rgba(187,134,252,.18);border-radius:11px;background:rgba(164,103,224,.035);color:#a994b5;font-size:9px;font-weight:900;transition:.18s ease}.dt-amount-choice small{color:#786882;font-size:7px;font-weight:700}.dt-amount-choice input:checked+span{border-color:rgba(203,151,251,.62);background:linear-gradient(135deg,rgba(114,65,154,.38),rgba(63,36,82,.3));color:#f2dcff;box-shadow:0 0 0 2px rgba(174,112,238,.08) inset}.dt-amount-choice input:checked+span small{color:#cdb2dc}.dt-generate{width:100%;min-height:42px;margin-top:11px;border-radius:13px;border:1px solid rgba(190,137,251,.45);background:linear-gradient(135deg,#71429f,#3d205a);color:#f8eaff;font-size:10px;font-weight:900;letter-spacing:.08em}.dt-generate:disabled{opacity:.45;cursor:wait}.dt-generate small{display:block;margin-top:2px;color:#c9aedc;font-size:7px;font-weight:700}
    .dt-library{padding-top:3px}.dt-list{display:grid;gap:8px}.dt-empty{padding:22px 12px;border:1px dashed rgba(216,177,93,.14);border-radius:14px;text-align:center;color:#6f6575;font-size:9px}.dt-item{padding:11px;border:1px solid rgba(216,177,93,.13);border-radius:15px;background:rgba(255,255,255,.018)}.dt-item-top{display:flex;justify-content:space-between;gap:10px;align-items:start}.dt-item-name{color:#eadcf1;font-size:11px;font-weight:900}.dt-item-meta{margin-top:4px;color:#8b7d91;font-size:8px;line-height:1.55}.dt-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.dt-tag{padding:3px 7px;border:1px solid rgba(216,177,93,.12);border-radius:999px;background:rgba(216,177,93,.03);color:#b9a88c;font-size:7px}.dt-play{flex:0 0 auto;min-height:31px;padding:0 10px;border-radius:10px;border:1px solid rgba(187,134,252,.28);background:rgba(164,103,224,.08);color:#dabaff;font-size:8px;font-weight:900}.dt-owner-reward{margin-top:9px;color:#766a7c;font-size:7px}
    .dt-item.suspended{border-color:rgba(248,113,113,.28);background:linear-gradient(135deg,rgba(127,29,29,.08),rgba(255,255,255,.012))}.dt-status-bad{color:#fca5a5!important;border-color:rgba(248,113,113,.28)!important}.dt-repair{flex:0 0 auto;min-height:31px;padding:0 10px;border-radius:10px;border:1px solid rgba(248,113,113,.34);background:rgba(127,29,29,.16);color:#fecaca;font-size:8px;font-weight:900}.dt-question-title-row{display:flex;align-items:flex-start;gap:10px}.dt-question-title-row h3{flex:1}.dt-answer-actions{display:grid;grid-template-columns:minmax(105px,.34fr) minmax(0,1fr);gap:8px;margin-top:12px}.dt-report-question{min-height:42px;padding:0 9px;border-radius:13px;border:1px solid rgba(251,191,36,.24);background:rgba(120,53,15,.1);color:#fcd34d;font-size:8px;font-weight:900}.dt-answer-actions .dt-next{margin-top:0}.dt-modal{position:fixed;inset:0;z-index:9950;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.82);backdrop-filter:blur(8px)}.dt-modal-card{width:min(100%,620px);max-height:88dvh;overflow:auto;padding:18px;border:1px solid rgba(203,151,251,.24);border-radius:20px;background:linear-gradient(145deg,#171119,#09080a);box-shadow:0 24px 90px rgba(0,0,0,.65)}.dt-modal-card h3{margin:0;color:#f1e5f7;font-size:15px}.dt-modal-note{margin:7px 0 12px;color:#93849a;font-size:9px;line-height:1.7}.dt-modal-question{padding:11px;border:1px solid rgba(255,255,255,.07);border-radius:12px;background:rgba(0,0,0,.22);color:#d9cedd;font-size:10px;line-height:1.7}.dt-modal textarea{width:100%;min-height:105px;margin-top:10px;padding:10px 11px;resize:vertical;border:1px solid rgba(216,177,93,.17);border-radius:12px;background:#09080a;color:#eee3f2;font-size:10px;outline:none}.dt-modal-actions{display:flex;gap:8px;margin-top:11px}.dt-modal-actions button{flex:1;min-height:38px;border-radius:11px;font-size:8px;font-weight:900}.dt-modal-cancel{border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:#aaa}.dt-modal-submit{border:1px solid rgba(203,151,251,.35);background:linear-gradient(135deg,#72419a,#3f2452);color:#f5e7ff}.dt-modal-submit:disabled{opacity:.5;cursor:wait}.dt-ai-review{margin-top:10px;padding:10px;border-left:2px solid #ef4444;background:rgba(127,29,29,.08);color:#d8b4b4;font-size:9px;line-height:1.7}.dt-sealed{text-align:center;min-height:100dvh;display:grid;place-items:center;padding:24px}.dt-sealed-box{max-width:520px}.dt-sealed-icon{width:76px;height:76px;margin:0 auto 14px;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(248,113,113,.35);color:#fca5a5;font-size:28px;box-shadow:0 0 50px rgba(239,68,68,.12)}
    .dt-overlay{position:fixed;inset:0;z-index:9100;width:100vw;height:100dvh;background:radial-gradient(circle at 50% 45%,rgba(125,66,174,.22),transparent 32%),linear-gradient(180deg,#080609,#020202);color:#f0e5f4;overflow:hidden}.dt-encounter{min-height:100dvh;display:grid;place-items:center;padding:24px;text-align:center;overflow:hidden;position:relative}.dt-portal{position:absolute;width:min(70vw,420px);aspect-ratio:1;border-radius:50%;border:1px solid rgba(204,154,255,.28);box-shadow:0 0 80px rgba(141,75,196,.18),inset 0 0 70px rgba(183,114,245,.08);animation:dtPortal 2.4s ease-in-out infinite alternate}.dt-portal:before,.dt-portal:after{content:"";position:absolute;inset:11%;border-radius:50%;border:1px dashed rgba(224,188,255,.22);animation:dtSpin 9s linear infinite}.dt-portal:after{inset:25%;animation-direction:reverse;animation-duration:6s}.dt-encounter-copy{position:relative;z-index:2;max-width:560px}.dt-encounter-copy span{font-size:8px;letter-spacing:.28em;color:#a27bbb;font-weight:900}.dt-encounter-copy h2{margin:10px 0 8px;font-size:clamp(28px,8vw,54px);color:#f0dfff;text-shadow:0 0 32px rgba(203,150,255,.3)}.dt-encounter-copy p{color:#9a88a3;font-size:10px}.dt-encounter-copy b{display:inline-block;margin-top:13px;padding:6px 11px;border:1px solid rgba(205,154,255,.24);border-radius:999px;color:#d5b4ed;font-size:8px}@keyframes dtPortal{to{transform:scale(1.05);box-shadow:0 0 120px rgba(141,75,196,.28),inset 0 0 90px rgba(183,114,245,.14)}}@keyframes dtSpin{to{transform:rotate(360deg)}}
    .dt-runner{width:100vw;height:100dvh;max-width:none;margin:0;padding:clamp(10px,1.5vw,22px);box-sizing:border-box;display:grid;grid-template-rows:auto auto auto minmax(0,1fr);overflow:hidden}.dt-run-head{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:6px 0 11px;border-bottom:1px solid rgba(216,177,93,.12)}.dt-run-head small{display:block;color:#856d91;font-size:7px;letter-spacing:.16em}.dt-run-head strong{display:block;margin-top:3px;color:#f0e0f7;font-size:clamp(15px,1.6vw,22px)}.dt-exit{width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,.09);background:#0d0a0e;color:#a891b3}.dt-run-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:9px 0}.dt-run-meta div{padding:7px;border:1px solid rgba(216,177,93,.1);border-radius:11px;background:rgba(255,255,255,.018);text-align:center}.dt-run-meta span{display:block;color:#756a7b;font-size:7px}.dt-run-meta b{display:block;margin-top:3px;color:#cbb4d6;font-size:9px}.dt-progress{height:4px;border-radius:999px;background:#171119;overflow:hidden}.dt-progress i{display:block;height:100%;background:linear-gradient(90deg,#6d3b94,#c994ec);transition:width .3s}
    .dt-question{min-height:0;height:100%;margin-top:10px;padding:clamp(14px,2vw,26px);box-sizing:border-box;display:flex;flex-direction:column;overflow:auto;border:1px solid rgba(193,137,247,.17);border-radius:20px;background:linear-gradient(145deg,rgba(27,18,31,.9),rgba(7,6,8,.98));box-shadow:0 20px 55px rgba(0,0,0,.32)}.dt-question h3{margin:0;color:#f1e7f5;font-size:clamp(16px,2vw,26px);line-height:1.6}.dt-options{flex:1;min-height:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:minmax(70px,1fr);align-content:stretch;gap:clamp(8px,1vw,14px);margin-top:14px}.dt-option{min-height:58px;padding:clamp(10px,1.3vw,17px);display:flex;align-items:center;gap:12px;border:1px solid rgba(216,177,93,.12);border-radius:13px;background:rgba(255,255,255,.02);color:#d6c9db;text-align:left;font-size:clamp(11px,1.15vw,16px)}.dt-option span{width:25px;height:25px;flex:0 0 25px;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(197,144,247,.2);color:#cca1ee;font-size:8px}.dt-option.correct{border-color:rgba(74,222,128,.45);background:rgba(22,101,52,.12);color:#d1fae5}.dt-option.wrong{border-color:rgba(248,113,113,.45);background:rgba(127,29,29,.12);color:#fecaca}.dt-option:disabled{cursor:default}.dt-explain{margin-top:12px;padding:12px;border-left:2px solid #9256b8;background:rgba(139,82,176,.06);color:#b7a8bd;font-size:10px;line-height:1.75}.dt-next{width:100%;min-height:42px;margin-top:12px;border-radius:13px;border:1px solid rgba(197,144,247,.35);background:linear-gradient(135deg,#74429e,#422257);color:#f5e5ff;font-size:9px;font-weight:900}
    .dt-result{text-align:center;padding:42px 12px}.dt-result-seal{width:82px;height:82px;margin:0 auto 14px;display:grid;place-items:center;border-radius:50%;border:1px solid rgba(203,151,251,.35);color:#deb9ff;font:900 32px serif;box-shadow:0 0 45px rgba(158,94,210,.12)}.dt-result h2{margin:0;color:#f0dfff;font-size:25px}.dt-result p{color:#9b8ba2;font-size:10px;line-height:1.7}.dt-result-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:18px auto;max-width:480px}.dt-result-grid div{padding:10px;border:1px solid rgba(216,177,93,.11);border-radius:12px;background:rgba(255,255,255,.018)}.dt-result-grid span{display:block;color:#756a7a;font-size:7px}.dt-result-grid b{display:block;margin-top:4px;color:#d8b7e9;font-size:14px}.dt-reward{max-width:480px;margin:10px auto;padding:12px;border:1px solid rgba(216,177,93,.13);border-radius:14px;color:#9b8ca1;font-size:9px}.dt-back{min-height:40px;padding:0 18px;border-radius:12px;border:1px solid rgba(203,151,251,.3);background:rgba(139,79,179,.08);color:#e5c9f5;font-size:9px;font-weight:900}
    .dt-toast{position:fixed;left:50%;bottom:104px;transform:translateX(-50%);z-index:9800;max-width:min(90vw,520px);padding:10px 15px;border-radius:999px;border:1px solid rgba(203,151,251,.3);background:#100c12;color:#ead9f3;font-size:10px;font-weight:800;box-shadow:0 16px 45px rgba(0,0,0,.45)}
    .dt-history{border-left-color:#a855f7!important;background:linear-gradient(90deg,rgba(126,34,206,.09),rgba(51,65,85,.45))!important}.dt-history-questions{display:grid;gap:8px;margin-top:9px}.dt-history-q{padding:10px;border-radius:11px;background:rgba(2,6,23,.48);border:1px solid rgba(255,255,255,.06)}.dt-history-q h5{margin:0 0 6px;color:#e9d5ff;font-size:11px;line-height:1.5}.dt-history-q p{margin:6px 0 0;color:#9ca3af;font-size:9px;line-height:1.6}
    @media(max-width:700px){.dt-runner{padding:8px 8px 10px}.dt-question{padding:13px}.dt-options{grid-template-columns:1fr;grid-auto-rows:minmax(52px,auto);overflow:visible}.dt-run-meta{grid-template-columns:repeat(3,1fr)}.dt-result-grid{grid-template-columns:repeat(3,1fr)}}
  `;

  function ensureStyle() {
    if (document.getElementById('dongtian-style')) return;
    const style = document.createElement('style');
    style.id = 'dongtian-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function collapseKey() { return 'dongtianCardCollapsedV1'; }
  function setCardCollapsed(card, body, collapsed) {
    body.hidden = !!collapsed;
    card.classList.toggle('is-collapsed', !!collapsed);
    card.querySelector('.dongfu-collapse-head')?.setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem(collapseKey(), collapsed ? '1' : '0'); } catch (_) {}
  }

  function mount() {
    ensureStyle();
    if (state.mounted || !document.getElementById('page-settings')) return;
    const analysis = document.querySelector('#page-settings .dongfu-analysis-card') || document.querySelector('#page-settings #knowledgeChart')?.closest('.glass-panel');
    if (!analysis) return;

    const card = document.createElement('section');
    card.id = 'dongtian-card';
    card.className = 'glass-panel rounded-2xl mb-6 relative overflow-hidden dongfu-collapse-card dongtian-card';
    card.innerHTML = `
      <button type="button" class="dongfu-collapse-head" aria-expanded="false">
        <span class="dongfu-collapse-icon"><i class="fa-solid fa-mountain-sun"></i></span>
        <span class="dongfu-collapse-copy"><span class="dongfu-collapse-title">洞天</span><span class="dongfu-collapse-summary">以圖片與文字煉成固定題序的知識秘境</span></span>
        <span class="dongfu-collapse-chevron"><i class="fa-solid fa-chevron-down"></i></span>
      </button>
      <div id="dongtian-body" class="dongfu-collapse-body dt-body" hidden>
        <section class="dt-create">
          <h4>開闢新洞天</h4>
          <p>可同時提供多張圖片與文字。AI 會先判斷需要的題數與固定單選結構，再每 5 題一批生成；後一批會讀取前面已生成的全部題目以避免重複。</p>
          <textarea id="dt-source-text" class="dt-input" maxlength="16000" placeholder="貼上課文、筆記、公式說明、重點整理……（圖片與文字至少提供一種）"></textarea>
          <div class="dt-upload-row">
            <label class="dt-upload"><i class="fa-solid fa-images"></i> 上傳圖片（最多 ${MAX_IMAGES} 張）<input id="dt-images" type="file" accept="image/png,image/jpeg,image/webp" multiple></label>
            <span id="dt-image-count" class="dt-image-count">尚未選擇圖片</span>
          </div>
          <div id="dt-previews" class="dt-previews"></div>
          <div class="dt-amount">
            <span class="dt-amount-title">生成題目量</span>
            <div class="dt-amount-options" role="radiogroup" aria-label="生成題目量">
              <label class="dt-amount-choice"><input type="radio" name="dt-question-amount" value="low"><span>少 <small>10 題</small></span></label>
              <label class="dt-amount-choice"><input type="radio" name="dt-question-amount" value="medium" checked><span>中 <small>15～20 題</small></span></label>
              <label class="dt-amount-choice"><input type="radio" name="dt-question-amount" value="high"><span>多 <small>25～30 題</small></span></label>
            </div>
          </div>
          <button id="dt-generate" class="dt-generate" type="button">凝聚洞天<small>先規劃題數，再每 5 題分批生成</small></button>
          <div id="dt-generate-status" class="dt-library-note" style="margin-top:8px"></div>
        </section>
        <section class="dt-library">
          <h4>我的洞天</h4>
          <p class="dt-library-note">洞天會永久保存。建立者可隨時重玩；其他修士首次完成你的洞天時，你可獲得 +${OWNER_CULTIVATION_REWARD} 修為與 +${OWNER_GOLD_REWARD} 金幣。</p>
          <div id="dt-list" class="dt-list"><div class="dt-empty">洞天名冊讀取中…</div></div>
        </section>
      </div>`;
    analysis.before(card);
    const body = card.querySelector('#dongtian-body');
    let collapsed = true;
    try { collapsed = localStorage.getItem(collapseKey()) !== '0'; } catch (_) {}
    setCardCollapsed(card, body, collapsed);
    card.querySelector('.dongfu-collapse-head').onclick = () => {
      setCardCollapsed(card, body, !body.hidden);
      if (!body.hidden && !state.listLoaded) loadOwnDongtians();
    };
    card.querySelector('#dt-images').addEventListener('change', handleFiles);
    card.querySelector('#dt-generate').onclick = generateDongtian;
    card.querySelector('#dt-list').addEventListener('click', async (event) => {
      const repairButton = event.target.closest('[data-dt-repair]');
      if (repairButton) {
        repairButton.disabled = true;
        await openDongtianRepair(repairButton.dataset.dtRepair).catch((error) => toast(error.message || '無法開啟修復介面'));
        repairButton.disabled = false;
        return;
      }
      const manageButton = event.target.closest('[data-dt-manage]');
      if (manageButton) {
        manageButton.disabled = true;
        await openOwnerQuestionManager(manageButton.dataset.dtManage).catch((error) => toast(error.message || '無法開啟題目管理'));
        manageButton.disabled = false;
        return;
      }
      const button = event.target.closest('[data-dt-play]');
      if (!button) return;
      const id = button.dataset.dtPlay;
      button.disabled = true;
      try {
        const snap = await getDoc(doc(db, DATA_COLLECTION, id));
        if (!snap.exists()) throw new Error('洞天資料不存在');
        const data = { id: snap.id, ...snap.data() };
        if (data.status !== 'active') throw new Error('此洞天目前已封印，請先完成題目修復。');
        await enterDongtian(data, { source: 'owner', encountered: false });
      } catch (error) {
        toast(error.message || '無法進入洞天');
        button.disabled = false;
      }
    });
    state.mounted = true;
    window.dispatchEvent(new CustomEvent('dongtian:ready'));
  }

  function handleFiles(event) {
    const incoming = [...(event.target.files || [])];
    for (const file of incoming) {
      if (state.files.length >= MAX_IMAGES) break;
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) continue;
      const url = URL.createObjectURL(file);
      state.files.push({ file, url });
    }
    event.target.value = '';
    renderPreviews();
  }

  function renderPreviews() {
    const box = document.getElementById('dt-previews');
    const count = document.getElementById('dt-image-count');
    if (!box || !count) return;
    count.textContent = state.files.length ? `已選 ${state.files.length} / ${MAX_IMAGES} 張` : '尚未選擇圖片';
    box.innerHTML = state.files.map((item, index) => `<div class="dt-preview"><img src="${item.url}" alt="素材 ${index + 1}"><button type="button" data-remove-image="${index}"><i class="fa-solid fa-xmark"></i></button></div>`).join('');
    box.querySelectorAll('[data-remove-image]').forEach((button) => {
      button.onclick = () => {
        const index = Number(button.dataset.removeImage);
        const [removed] = state.files.splice(index, 1);
        if (removed?.url) URL.revokeObjectURL(removed.url);
        renderPreviews();
      };
    });
  }

  async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function compressImage(file) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      const maxSide = 1400;
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
      if (!blob) throw new Error('圖片壓縮失敗');
      return { mimeType: 'image/jpeg', data: await blobToBase64(blob) };
    } finally {
      bitmap?.close?.();
    }
  }

  async function generateDongtian() {
    if (state.generating || !uid()) return;
    const text = document.getElementById('dt-source-text')?.value?.trim() || '';
    const questionAmount = document.querySelector('input[name="dt-question-amount"]:checked')?.value || 'medium';
    if (!text && !state.files.length) { toast('請至少提供文字或一張圖片。'); return; }
    const button = document.getElementById('dt-generate');
    const status = document.getElementById('dt-generate-status');
    state.generating = true;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 正在凝聚洞天…<small>先規劃題數，再每 5 題分批生成</small>';
    status.textContent = state.files.length ? `正在整理 ${state.files.length} 張圖片與文字中的所有知識點…` : '正在整理文字中的所有知識點…';
    try {
      const images = [];
      for (let i = 0; i < state.files.length; i++) {
        status.textContent = `處理圖片 ${i + 1} / ${state.files.length}…`;
        images.push(await compressImage(state.files[i].file));
      }
      const amountLabel = ({ low:'少量（10 題）', medium:'中量（15～20 題）', high:'大量（25～30 題）' })[questionAmount] || '中量';
      status.textContent = `AI 正在依「${amountLabel}」先規劃總題數與單選題結構，接著每 5 題分批生成並避免重複…`;
      const level = userData()?.profile?.educationLevel || '國中一年級';
      const response = await fetch('/api/generate-dongtian', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, images, creatorLevel: level, questionAmount })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.dongtian) throw new Error(payload.error || `洞天生成失敗 (${response.status})`);
      await saveGeneratedDongtian(payload.dongtian, state.files.length);
      status.textContent = `洞天「${payload.dongtian.name}」已凝成，共 ${payload.dongtian.questionCount} 題。`;
      document.getElementById('dt-source-text').value = '';
      state.files.forEach((item) => URL.revokeObjectURL(item.url));
      state.files = [];
      renderPreviews();
      await loadOwnDongtians(true);
    } catch (error) {
      console.error('[Dongtian create]', error);
      status.textContent = error.message || '洞天生成失敗，請稍後重試。';
      toast(status.textContent);
    } finally {
      state.generating = false;
      button.disabled = false;
      button.innerHTML = `凝聚洞天<small>先規劃題數，再每 5 題分批生成</small>`;
    }
  }

  async function saveGeneratedDongtian(generated, sourceImageCount) {
    const user = userData() || {};
    const fullRef = doc(collection(db, DATA_COLLECTION));
    const id = fullRef.id;
    const now = Date.now();
    const metadata = {
      ownerUid: uid(),
      ownerName: window.getPlayerDisplayName?.(user, auth.currentUser?.displayName || '無名修士') || user.displayName || auth.currentUser?.displayName || '無名修士',
      name: generated.name,
      level: generated.level,
      levelOrder: Number(generated.levelOrder),
      difficulty: generated.difficulty,
      subject: generated.subject,
      questionCount: generated.questions.length,
      knowledgePoints: generated.knowledgePoints || [],
      coverageSummary: generated.coverageSummary || '',
      sourceImageCount,
      status: 'active',
      playCount: 0,
      completionCount: 0,
      createdAt: serverTimestamp(),
      createdAtMs: now
    };
    const batch = writeBatch(db);
    batch.set(fullRef, {
      ...metadata,
      questions: generated.questions
    });
    batch.set(doc(db, INDEX_COLLECTION, id), metadata);
    await batch.commit();
  }

  async function loadOwnDongtians(force = false) {
    if (!uid() || (state.listLoaded && !force)) return;
    const list = document.getElementById('dt-list');
    if (!list) return;
    list.innerHTML = '<div class="dt-empty"><i class="fa-solid fa-circle-notch fa-spin"></i> 讀取洞天名冊…</div>';
    try {
      const snap = await getDocs(query(collection(db, INDEX_COLLECTION), where('ownerUid', '==', uid())));
      const items = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() })).sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
      state.listLoaded = true;
      if (!items.length) {
        list.innerHTML = '<div class="dt-empty">你還沒有開闢洞天。上傳圖片或貼上文字，就能把想練的內容煉成一座知識秘境。</div>';
        return;
      }
      list.innerHTML = items.map((item) => {
        const suspended = item.status === 'suspended';
        return `
        <article class="dt-item ${suspended ? 'suspended' : ''}">
          <div class="dt-item-top">
            <div><div class="dt-item-name">${escapeHtml(item.name)}</div><div class="dt-item-meta">${escapeHtml(item.coverageSummary || '固定題序知識秘境')}</div></div>
            ${suspended
              ? `<button type="button" class="dt-repair" data-dt-repair="${item.id}"><i class="fa-solid fa-screwdriver-wrench"></i> 修復題目</button>`
              : `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end"><button type="button" class="dt-play" data-dt-play="${item.id}"><i class="fa-solid fa-play"></i> 進入</button><button type="button" class="dt-repair" data-dt-manage="${item.id}"><i class="fa-solid fa-pen-ruler"></i> 題目管理</button></div>`}
          </div>
          <div class="dt-tags"><span class="dt-tag">${escapeHtml(item.level)}</span><span class="dt-tag">${difficultyLabel(item.difficulty)}</span><span class="dt-tag">${escapeHtml(item.subject)}</span><span class="dt-tag">${Number(item.questionCount) || 0} 題</span><span class="dt-tag">完成 ${Number(item.completionCount) || 0} 次</span>${suspended ? '<span class="dt-tag dt-status-bad">已封印 · 待修復</span>' : ''}</div>
          <div class="dt-owner-reward">${suspended ? `AI 已確認第 ${Number(item.flaggedQuestionIndex || 0) + 1} 題有誤；修復通過二次 AI 驗證前，其他修士不會再遇到此洞天。` : `其他不同修士首次完成：洞天主人 +${OWNER_CULTIVATION_REWARD} 修為、+${OWNER_GOLD_REWARD} 金幣 · 玩家首次完整通關依題數獲得靈石（每題 ${FIRST_COMPLETION_SPIRIT_STONE_PER_QUESTION}，最低 ${FIRST_COMPLETION_MIN_SPIRIT_STONES}）`}</div>
        </article>`;
      }).join('');
    } catch (error) {
      console.warn('[Dongtian list]', error);
      list.innerHTML = '<div class="dt-empty">洞天名冊暫時無法讀取。</div>';
    }
  }

  function currentPracticeSubjects() {
    const settings = userData()?.gameSettings || {};
    const mode = settings.sourceMode || 'random';
    if (mode === 'focused' && Array.isArray(settings.focusedUnits) && settings.focusedUnits.length) {
      const subjects = settings.focusedUnits.map((unit) => String(unit?.path || '').split('/')[0]).filter(Boolean);
      return [...new Set(subjects.length ? subjects : ['綜合'])];
    }
    if (mode === 'bank' && settings.source && settings.source !== 'ai') {
      return [String(settings.source).split('/')[0] || '綜合'];
    }
    return ['綜合'];
  }

  function subjectFamily(subject) {
    const value = String(subject || '').trim();
    if (['自然', '生物理化', '物理', '化學', '生物'].includes(value)) return '自然';
    if (['社會', '歷史地理公民', '歷史', '地理', '公民'].includes(value)) return '社會';
    return value;
  }

  function subjectMatches(caveSubject, practiceSubjects) {
    if (!caveSubject || caveSubject === '綜合') return true;
    if (practiceSubjects.includes('綜合')) return true;
    const caveFamily = subjectFamily(caveSubject);
    return practiceSubjects.some((subject) => subject === caveSubject || subjectFamily(subject) === caveFamily);
  }

  async function findEncounter() {
    if (!uid() || state.session || state.encounterBusy) return null;
    if (document.getElementById('newbie-tutorial-layer') || document.getElementById('five-immortal-challenge')) return null;
    const playerLevel = userData()?.profile?.educationLevel || '';
    const playerOrder = levelOrder(playerLevel);
    if (playerOrder < 0) return null;
    const subjects = currentPracticeSubjects();
    const snap = await getDocs(query(collection(db, INDEX_COLLECTION), where('status', '==', 'active'), limit(80)));
    const eligible = shuffle(snap.docs.map((entry) => ({ id: entry.id, ...entry.data() })).filter((item) =>
      item.ownerUid !== uid() && Number(item.levelOrder) >= 0 && playerOrder > Number(item.levelOrder) && subjectMatches(item.subject, subjects)
    ));
    for (const item of eligible.slice(0, 12)) {
      const playSnap = await getDoc(doc(db, PLAY_COLLECTION, `${uid()}__${item.id}`));
      if (playSnap.exists()) continue;
      const full = await getDoc(doc(db, DATA_COLLECTION, item.id));
      if (full.exists()) return { id: full.id, ...full.data() };
    }
    return null;
  }

  async function maybeEncounterBeforeQuiz() {
    if (state.encounterBusy || state.session || Math.random() >= ENCOUNTER_CHANCE) return false;
    state.encounterBusy = true;
    try {
      const found = await findEncounter();
      if (!found) return false;
      await markEncountered(found);
      const accepted = await offerDongtianEncounter(found);
      if (!accepted) return false;
      await enterDongtian(found, { source: 'encounter', encountered: false, alreadyEncountered: true });
      return true;
    } catch (error) {
      console.warn('[Dongtian encounter]', error);
      return false;
    } finally {
      state.encounterBusy = false;
    }
  }


  function offerDongtianEncounter(dongtian) {
    return new Promise((resolve) => {
      const overlay = ensureOverlay();
      const owner = dongtian.ownerName || '無名修士';
      const questionCount = dongtian.questions?.length || dongtian.questionCount || 0;
      const firstReward = firstCompletionSpiritStones(questionCount);
      overlay.innerHTML = `<div class="dt-encounter"><div class="dt-portal"></div><div class="dt-encounter-copy"><span>天地異象 · 發現洞天</span><h2>${escapeHtml(dongtian.name)}</h2><p><strong style="color:#eadcff">此洞天由「${escapeHtml(owner)}」開闢。</strong><br>你感應到這座知識秘境。每位修士只會遇見同一座洞天一次，是否現在進入？</p><div style="margin:14px auto;max-width:520px;padding:12px;border:1px solid rgba(205,154,255,.18);border-radius:14px;background:rgba(0,0,0,.2);font-size:9px;line-height:1.8;color:#bca9c4;text-align:left"><strong style="color:#eadcff">洞天主人：</strong>${escapeHtml(owner)}<br><strong>程度：</strong>${escapeHtml(dongtian.level)}　<strong>難度：</strong>${difficultyLabel(dongtian.difficulty)}<br><strong>科目：</strong>${escapeHtml(dongtian.subject)}　<strong>題數：</strong>${questionCount}<br><strong style="color:#dfbdf5">首次完整通關：</strong>+${firstReward.toLocaleString()} 靈石</div><div style="display:flex;gap:9px;justify-content:center;flex-wrap:wrap"><button id="dt-decline-encounter" class="dt-back" type="button">略過洞天，繼續一般修行</button><button id="dt-enter-encounter" class="dt-next" style="width:auto;padding:0 20px;margin:0" type="button">進入洞天</button></div></div></div>`;
      document.getElementById('dt-enter-encounter').onclick = () => { overlay.remove(); resolve(true); };
      document.getElementById('dt-decline-encounter').onclick = () => { overlay.remove(); resolve(false); };
    });
  }

  async function markEncountered(dongtian) {
    const ref = doc(db, PLAY_COLLECTION, `${uid()}__${dongtian.id}`);
    await setDoc(ref, {
      uid: uid(), dongtianId: dongtian.id, ownerUid: dongtian.ownerUid || '',
      encountered: true, encounteredAt: serverTimestamp(), encounteredAtMs: Date.now(), completed: false
    }, { merge: true });
    updateDoc(doc(db, INDEX_COLLECTION, dongtian.id), { playCount: increment(1) }).catch(() => {});
  }

  async function enterDongtian(dongtian, options = {}) {
    if (!dongtian?.questions?.length || state.session) return;
    if (dongtian.status && dongtian.status !== 'active') { toast('此洞天已封印，等待主人修復。'); return; }
    if (options.encountered) await markEncountered(dongtian);
    else if (!options.alreadyEncountered) updateDoc(doc(db, INDEX_COLLECTION, dongtian.id), { playCount: increment(1) }).catch(() => {});
    state.session = {
      dongtian,
      source: options.source || 'owner',
      runId: `${uid()}_${dongtian.id}_${Date.now().toString(36)}`,
      index: 0,
      answers: [],
      answered: false,
      logged: false,
      startedAt: Date.now()
    };
    showEncounterAnimation();
    setTimeout(() => { if (state.session?.dongtian.id === dongtian.id) renderRunner(); }, 2450);
  }

  function ensureOverlay() {
    let overlay = document.getElementById('dongtian-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'dongtian-overlay';
      overlay.className = 'dt-overlay';
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function showEncounterAnimation() {
    const s = state.session;
    const overlay = ensureOverlay();
    overlay.innerHTML = `<div class="dt-encounter"><div class="dt-portal"></div><div class="dt-encounter-copy"><span>${s.source === 'encounter' ? '天地異象 · DONGTIAN ENCOUNTERED' : '洞天開啟 · ENTER SECRET REALM'}</span><h2>${escapeHtml(s.dongtian.name)}</h2><p>靈識已鎖定此洞天。進入後題序固定，除非主動退出或重新整理，否則不會切換成其他題目。</p><b>${escapeHtml(s.dongtian.level)} · ${difficultyLabel(s.dongtian.difficulty)} · ${escapeHtml(s.dongtian.subject)} · ${s.dongtian.questions.length} 題</b></div></div>`;
  }

  function renderRunner() {
    const s = state.session;
    if (!s) return;
    const overlay = ensureOverlay();
    const q = s.dongtian.questions[s.index];
    if (!q) { finishDongtian(); return; }
    s.answered = false;
    const optionObjects = shuffle([{ text: q.correct, correct: true }, ...(q.wrong || []).map((text) => ({ text, correct: false }))]);
    s.currentOptions = optionObjects;
    overlay.innerHTML = `<main class="dt-runner"><header class="dt-run-head"><div><small>洞天試煉 · FIXED SEQUENCE</small><strong>${escapeHtml(s.dongtian.name)}</strong></div><button id="dt-exit" class="dt-exit" type="button" aria-label="退出洞天"><i class="fa-solid fa-door-open"></i></button></header><div class="dt-run-meta"><div><span>題序</span><b>${s.index + 1} / ${s.dongtian.questions.length}</b></div><div><span>科目</span><b>${escapeHtml(q.subject || s.dongtian.subject)}</b></div><div><span>難度</span><b>${difficultyLabel(q.difficulty)}</b></div></div><div class="dt-progress"><i style="width:${((s.index) / s.dongtian.questions.length) * 100}%"></i></div><section class="dt-question"><div class="dt-question-title-row"><h3>${escapeHtml(q.q)}</h3></div><div id="dt-options" class="dt-options">${optionObjects.map((option, index) => `<button class="dt-option" type="button" data-dt-answer="${index}"><span>${String.fromCharCode(65 + index)}</span><b>${escapeHtml(option.text)}</b></button>`).join('')}</div><div id="dt-explain-slot"></div></section></main>`;
    overlay.querySelector('#dt-exit').onclick = exitDongtian;
    overlay.querySelectorAll('[data-dt-answer]').forEach((button) => button.onclick = () => answerDongtian(Number(button.dataset.dtAnswer)));
    try { window.MathJax?.typesetPromise?.([overlay]); } catch (_) {}
  }

  function answerDongtian(optionIndex) {
    const s = state.session;
    if (!s || s.answered) return;
    s.answered = true;
    const q = s.dongtian.questions[s.index];
    const selected = s.currentOptions[optionIndex];
    const correctIdx = s.currentOptions.findIndex((item) => item.correct);
    const isCorrect = !!selected?.correct;
    const buttons = [...document.querySelectorAll('#dongtian-overlay [data-dt-answer]')];
    buttons.forEach((button, index) => {
      button.disabled = true;
      if (index === correctIdx) button.classList.add('correct');
      else if (index === optionIndex && !isCorrect) button.classList.add('wrong');
    });
    s.answers.push({
      id: q.id,
      index: s.index,
      q: q.q,
      subject: q.subject || s.dongtian.subject,
      difficulty: q.difficulty,
      options: s.currentOptions.map((item) => item.text),
      correctIdx,
      userIdx: optionIndex,
      isCorrect,
      exp: q.exp
    });
    const slot = document.getElementById('dt-explain-slot');
    slot.innerHTML = `<div class="dt-explain"><strong style="color:${isCorrect ? '#86efac' : '#fca5a5'}">${isCorrect ? '答對 · 靈機相合' : '答錯 · 參悟解析'}</strong><br>${escapeHtml(q.exp)}</div><div class="dt-answer-actions"><button id="dt-report-question" class="dt-report-question" type="button"><i class="fa-solid fa-triangle-exclamation"></i> 問題回報</button><button id="dt-next" type="button" class="dt-next">${s.index + 1 >= s.dongtian.questions.length ? '完成洞天' : '前往下一境'}</button></div>`;
    document.getElementById('dt-report-question').onclick = openQuestionReport;
    document.getElementById('dt-next').onclick = async () => {
      if (!(await ensureSessionDongtianActive())) return;
      if (s.index + 1 >= s.dongtian.questions.length) finishDongtian();
      else { s.index += 1; renderRunner(); }
    };
    try { window.MathJax?.typesetPromise?.([slot]); } catch (_) {}
  }


  function removeModerationModal() {
    document.getElementById('dt-moderation-modal')?.remove();
  }

  function questionIssueText(dongtian) {
    return String(dongtian?.aiReviewSummary || dongtian?.flaggedReason || 'AI 已確認此題存在實質錯誤。');
  }

  async function ensureSessionDongtianActive() {
    const s = state.session;
    if (!s) return false;
    try {
      const snap = await getDoc(doc(db, INDEX_COLLECTION, s.dongtian.id));
      if (snap.exists() && snap.data()?.status !== 'active') {
        await sealCurrentSession('此洞天剛被 AI 確認有錯並已封印，等待洞天主人修復。');
        return false;
      }
    } catch (error) {
      console.warn('[Dongtian status check]', error);
    }
    return true;
  }

  async function sealCurrentSession(message) {
    const s = state.session;
    if (!s) return;
    s.dongtian.status = 'suspended';
    await writeDongtianHistory(s, false).catch(() => {});
    const source = s.source;
    const overlay = ensureOverlay();
    overlay.innerHTML = `<div class="dt-sealed"><div class="dt-sealed-box"><div class="dt-sealed-icon"><i class="fa-solid fa-lock"></i></div><h2 style="color:#fecaca;margin:0 0 8px">洞天暫時封印</h2><p style="color:#a78b8b;font-size:10px;line-height:1.8">${escapeHtml(message || '此洞天題目已確認有誤，暫停開放。')}</p><button id="dt-sealed-back" class="dt-back" type="button">返回</button></div></div>`;
    document.getElementById('dt-sealed-back').onclick = () => {
      state.session = null;
      overlay.remove();
      window.switchToPage?.(source === 'owner' ? 'page-settings' : 'page-home');
      if (source === 'owner') loadOwnDongtians(true);
    };
  }

  function openQuestionReport() {
    const s = state.session;
    if (!s || state.moderationBusy) return;
    const q = s.dongtian.questions[s.index];
    if (!q) return;
    removeModerationModal();
    const modal = document.createElement('div');
    modal.id = 'dt-moderation-modal';
    modal.className = 'dt-modal';
    modal.innerHTML = `<div class="dt-modal-card"><h3><i class="fa-solid fa-triangle-exclamation" style="color:#fbbf24"></i> 回報洞天題目</h3><p class="dt-modal-note">請具體說明哪裡有錯。AI 會先審核，再由第二個獨立判定複核；只有兩次都確認為實質錯誤，洞天才會被封印。</p><div class="dt-modal-question"><strong>第 ${s.index + 1} 題</strong><br>${escapeHtml(q.q)}<br><br><span style="color:#86efac">目前標示答案：${escapeHtml(q.correct)}</span></div><textarea id="dt-report-reason" maxlength="1200" placeholder="例如：題目條件不足，A 與 C 都可能成立；或解析中的計算 3×4 寫成 15……"></textarea><div id="dt-report-status" class="dt-modal-note"></div><div class="dt-modal-actions"><button type="button" class="dt-modal-cancel">取消</button><button id="dt-report-submit" type="button" class="dt-modal-submit">交由 AI 審核</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('.dt-modal-cancel').onclick = removeModerationModal;
    modal.querySelector('#dt-report-submit').onclick = () => submitQuestionReport(modal, q, s.index);
  }

  async function submitQuestionReport(modal, question, questionIndex) {
    if (state.moderationBusy || !state.session) return;
    const reason = modal.querySelector('#dt-report-reason')?.value?.trim() || '';
    if (reason.length < 4) { toast('請具體描述題目問題。'); return; }
    const submit = modal.querySelector('#dt-report-submit');
    const status = modal.querySelector('#dt-report-status');
    state.moderationBusy = true;
    submit.disabled = true;
    submit.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 雙重 AI 審核中…';
    status.textContent = '第一階段檢查題目本身；若疑似有誤，會再交由第二階段獨立複核。';
    const s = state.session;
    try {
      const response = await fetch('/api/review-dongtian-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          reason,
          dongtian: { id: s.dongtian.id, name: s.dongtian.name, level: s.dongtian.level, difficulty: s.dongtian.difficulty, subject: s.dongtian.subject }
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `AI 審核失敗 (${response.status})`);

      if (!payload.confirmed) {
        status.innerHTML = `<span style="color:#fcd34d">AI 未能確認題目有實質錯誤，因此洞天維持開放。</span><br>${escapeHtml(payload.verification?.summary || payload.review?.summary || '')}`;
        addDoc(collection(db, REPORT_COLLECTION), {
          dongtianId: s.dongtian.id,
          reporterUid: uid(),
          reporterName: userData()?.displayName || auth.currentUser?.displayName || '無名修士',
          questionId: question.id,
          questionIndex,
          questionSnapshot: question,
          reason,
          aiReview: payload.review || null,
          aiVerification: payload.verification || null,
          status: 'not_confirmed',
          createdAt: serverTimestamp(),
          createdAtMs: Date.now()
        }).catch(() => {});
        submit.disabled = false;
        submit.textContent = '重新送審';
        return;
      }

      status.textContent = '雙重 AI 審核皆確認有誤，正在封印洞天並通知主人修復…';
      const reportRef = doc(collection(db, REPORT_COLLECTION));
      const dataRef = doc(db, DATA_COLLECTION, s.dongtian.id);
      const indexRef = doc(db, INDEX_COLLECTION, s.dongtian.id);
      await runTransaction(db, async (tx) => {
        const [dataSnap, indexSnap] = await Promise.all([tx.get(dataRef), tx.get(indexRef)]);
        if (!dataSnap.exists() || !indexSnap.exists()) throw new Error('洞天資料不存在');
        const live = dataSnap.data();
        if (live.status !== 'active') throw new Error('此洞天已由其他回報封印');
        const liveQuestion = live.questions?.[questionIndex];
        if (!liveQuestion || liveQuestion.id !== question.id) throw new Error('題目版本已變更，請重新進入洞天後再回報');
        const moderation = {
          status: 'suspended',
          moderationStatus: 'needs_revision',
          activeReportId: reportRef.id,
          flaggedQuestionId: question.id,
          flaggedQuestionIndex: questionIndex,
          flaggedReason: reason,
          aiReviewSummary: payload.verification?.summary || payload.review?.summary || '',
          suspendedAt: serverTimestamp(),
          suspendedAtMs: Date.now()
        };
        tx.set(reportRef, {
          dongtianId: s.dongtian.id,
          dongtianName: s.dongtian.name,
          ownerUid: live.ownerUid || '',
          reporterUid: uid(),
          reporterName: userData()?.displayName || auth.currentUser?.displayName || '無名修士',
          questionId: question.id,
          questionIndex,
          questionSnapshot: question,
          reason,
          aiReview: payload.review || null,
          aiVerification: payload.verification || null,
          status: 'confirmed',
          createdAt: serverTimestamp(),
          createdAtMs: Date.now()
        });
        tx.update(dataRef, moderation);
        tx.update(indexRef, moderation);
      });
      removeModerationModal();
      await sealCurrentSession('AI 雙重審核已確認本題有誤。整座洞天已停止開放，等待洞天主人以修改提示詞修復。');
    } catch (error) {
      console.error('[Dongtian report]', error);
      status.textContent = error.message || '題目回報失敗。';
      submit.disabled = false;
      submit.textContent = '重新送審';
    } finally {
      state.moderationBusy = false;
    }
  }


  async function openOwnerQuestionManager(dongtianId) {
    if (!uid() || state.moderationBusy) return;
    const snap = await getDoc(doc(db, DATA_COLLECTION, dongtianId));
    if (!snap.exists()) throw new Error('洞天資料不存在');
    const dongtian = { id: snap.id, ...snap.data() };
    if (dongtian.ownerUid !== uid()) throw new Error('只有洞天主人可以管理題目');
    if (dongtian.status !== 'active') throw new Error('封印中的洞天請使用「修復題目」');
    removeModerationModal();
    const modal = document.createElement('div');
    modal.id = 'dt-moderation-modal';
    modal.className = 'dt-modal';
    modal.innerHTML = `<div class="dt-modal-card"><h3><i class="fa-solid fa-pen-ruler" style="color:#c4b5fd"></i> 主人題目管理</h3><p class="dt-modal-note">可主動修正自己發現的錯題，但不能任意換題。請先選題，再在修改提示詞中具體指出原題哪裡錯誤、不精確、條件不足或有歧義；AI 確認問題存在後才會允許修改。</p><div style="display:grid;gap:7px;max-height:52vh;overflow:auto">${dongtian.questions.map((q, index) => `<button type="button" class="dt-modal-cancel" style="text-align:left;min-height:48px" data-owner-edit-index="${index}"><strong>${index + 1}. ${escapeHtml(q.q)}</strong><br><span style="opacity:.65">${escapeHtml(q.subject || dongtian.subject)} · ${difficultyLabel(q.difficulty)}</span></button>`).join('')}</div><div class="dt-modal-actions"><button type="button" class="dt-modal-cancel" data-close-owner-manager>關閉</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-close-owner-manager]').onclick = removeModerationModal;
    modal.querySelectorAll('[data-owner-edit-index]').forEach((button) => {
      button.onclick = () => openOwnerQuestionRevision(dongtian, Number(button.dataset.ownerEditIndex));
    });
  }

  function openOwnerQuestionRevision(dongtian, questionIndex) {
    const question = dongtian.questions?.[questionIndex];
    if (!question) return;
    removeModerationModal();
    const modal = document.createElement('div');
    modal.id = 'dt-moderation-modal';
    modal.className = 'dt-modal';
    modal.innerHTML = `<div class="dt-modal-card"><h3>主動修正第 ${questionIndex + 1} 題</h3><p class="dt-modal-note">修改提示詞必須先指出這一題具體哪裡不正確。AI 會先審核你的指控是否成立，再保持核心知識點、科目、程度與難度不變進行修正。</p><div class="dt-modal-question"><strong>${escapeHtml(question.q)}</strong><br><br><span style="color:#86efac">正解：${escapeHtml(question.correct)}</span><br><span style="color:#c4b5fd">其他選項：${(question.wrong || []).map((item) => escapeHtml(item)).join(' ／ ')}</span><br><br><span style="color:#aaa">解析：${escapeHtml(question.exp || '')}</span></div><textarea id="dt-owner-revision-hint" maxlength="1600" placeholder="例：這題把速度與速率混為一談，題幹的條件不足，導致 A 和 C 都可能成立。請補上方向條件並保持原本考速度概念。"></textarea><div id="dt-owner-revision-status" class="dt-modal-note">若 AI 無法確認你指出的是實質錯誤，修改會被拒絕。</div><div class="dt-modal-actions"><button type="button" class="dt-modal-cancel">取消</button><button id="dt-owner-revision-submit" type="button" class="dt-modal-submit">AI 審錯後修正</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('.dt-modal-cancel').onclick = removeModerationModal;
    modal.querySelector('#dt-owner-revision-submit').onclick = () => submitOwnerQuestionRevision(modal, dongtian, question, questionIndex);
  }

  async function submitOwnerQuestionRevision(modal, dongtian, originalQuestion, questionIndex) {
    if (state.moderationBusy) return;
    const hint = modal.querySelector('#dt-owner-revision-hint')?.value?.trim() || '';
    if (hint.length < 8) { toast('請具體指出題目錯誤或不正確之處。'); return; }
    const submit = modal.querySelector('#dt-owner-revision-submit');
    const status = modal.querySelector('#dt-owner-revision-status');
    state.moderationBusy = true;
    submit.disabled = true;
    submit.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 審錯＋修正中…';
    try {
      const response = await fetch('/api/revise-owned-dongtian-question', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalQuestion, hint, dongtian: { id: dongtian.id, name: dongtian.name, level: dongtian.level, difficulty: dongtian.difficulty, subject: dongtian.subject } })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.revised) throw new Error(payload.error || `題目修改失敗 (${response.status})`);
      const dataRef = doc(db, DATA_COLLECTION, dongtian.id);
      await runTransaction(db, async (tx) => {
        const liveSnap = await tx.get(dataRef);
        if (!liveSnap.exists()) throw new Error('洞天資料不存在');
        const live = liveSnap.data();
        if (live.ownerUid !== uid()) throw new Error('只有洞天主人可以修改');
        if (live.status !== 'active') throw new Error('洞天狀態已改變，請重新讀取');
        const liveQuestion = live.questions?.[questionIndex];
        if (!liveQuestion || liveQuestion.id !== originalQuestion.id) throw new Error('題目版本已改變，請重新讀取');
        const questions = [...live.questions];
        questions[questionIndex] = { ...payload.revised, id: liveQuestion.id, subject: liveQuestion.subject, difficulty: liveQuestion.difficulty };
        tx.update(dataRef, { questions, revisionCount: increment(1), lastRevisedAt: serverTimestamp(), lastRevisedAtMs: Date.now() });
      });
      removeModerationModal();
      toast('題目已通過「錯誤成立＋本質不變」雙重審核並更新。');
      state.listLoaded = false;
      await loadOwnDongtians(true);
    } catch (error) {
      status.innerHTML = `<span style="color:#fca5a5">${escapeHtml(error.message || '修改失敗')}</span><br>請重新說明題目具體錯誤，不能只要求換題或調整風格。`;
      submit.disabled = false;
      submit.textContent = '重新審錯並修正';
    } finally {
      state.moderationBusy = false;
    }
  }

  async function openDongtianRepair(dongtianId) {
    if (!uid() || state.moderationBusy) return;
    const snap = await getDoc(doc(db, DATA_COLLECTION, dongtianId));
    if (!snap.exists()) throw new Error('洞天資料不存在');
    const dongtian = { id: snap.id, ...snap.data() };
    if (dongtian.ownerUid !== uid()) throw new Error('只有洞天主人可以修復');
    if (dongtian.status !== 'suspended' || dongtian.moderationStatus !== 'needs_revision') throw new Error('此洞天目前不需要修復');
    const questionIndex = Number(dongtian.flaggedQuestionIndex);
    const question = dongtian.questions?.[questionIndex];
    if (!question) throw new Error('待修復題目不存在');

    removeModerationModal();
    const modal = document.createElement('div');
    modal.id = 'dt-moderation-modal';
    modal.className = 'dt-modal';
    modal.innerHTML = `<div class="dt-modal-card"><h3><i class="fa-solid fa-screwdriver-wrench" style="color:#fca5a5"></i> 修復封印題目</h3><p class="dt-modal-note">你不能直接自由改題。請輸入「修改提示詞」，AI 只會在原題核心知識點與學習目標不變的前提下修正題幹／選項／答案／解析；生成後還會再經第二次 AI 嚴格驗證，全部通過才重新開放洞天。</p><div class="dt-modal-question"><strong>第 ${questionIndex + 1} 題 · ${escapeHtml(question.subject || dongtian.subject)} · ${difficultyLabel(question.difficulty)}</strong><br>${escapeHtml(question.q)}<br><br><span style="color:#86efac">正解：${escapeHtml(question.correct)}</span><br><span style="color:#c4b5fd">其他選項：${(question.wrong || []).map((item) => escapeHtml(item)).join(' ／ ')}</span><br><br><span style="color:#aaa">原解析：${escapeHtml(question.exp || '')}</span></div><div class="dt-ai-review"><strong>封印原因</strong><br>${escapeHtml(questionIssueText(dongtian))}<br><span style="opacity:.75">玩家回報：${escapeHtml(dongtian.flaggedReason || '')}</span></div><textarea id="dt-revision-hint" maxlength="1600" placeholder="例：請補上缺少的條件，讓答案只能是原本要考的那個概念；數字可微調，但不要改變知識點。"></textarea><div id="dt-repair-status" class="dt-modal-note">若提示詞要求換知識點、換章節或把題目改成另一題，AI 會忽略或在驗證階段拒絕。</div><div class="dt-modal-actions"><button type="button" class="dt-modal-cancel">取消</button><button id="dt-repair-submit" type="button" class="dt-modal-submit">AI 修復並驗證</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('.dt-modal-cancel').onclick = removeModerationModal;
    modal.querySelector('#dt-repair-submit').onclick = () => submitDongtianRepair(modal, dongtian, question, questionIndex);
  }

  async function submitDongtianRepair(modal, dongtian, originalQuestion, questionIndex) {
    if (state.moderationBusy) return;
    const hint = modal.querySelector('#dt-revision-hint')?.value?.trim() || '';
    if (hint.length < 4) { toast('請輸入具體的修改提示詞。'); return; }
    const submit = modal.querySelector('#dt-repair-submit');
    const status = modal.querySelector('#dt-repair-status');
    state.moderationBusy = true;
    submit.disabled = true;
    submit.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 修復＋二次驗證中…';
    status.textContent = '第一個 AI 依提示詞修復；第二個 AI 將比較原題與修正版，檢查是否偷換知識點。';
    try {
      const response = await fetch('/api/revise-dongtian-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalQuestion,
          hint,
          issue: questionIssueText(dongtian),
          dongtian: { id: dongtian.id, name: dongtian.name, level: dongtian.level, difficulty: dongtian.difficulty, subject: dongtian.subject }
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.revised) throw new Error(payload.error || `題目修復失敗 (${response.status})`);
      const revised = payload.revised;

      status.textContent = '修正版已通過 AI 本質一致性與正確性驗證，正在重新開放洞天…';
      const dataRef = doc(db, DATA_COLLECTION, dongtian.id);
      const indexRef = doc(db, INDEX_COLLECTION, dongtian.id);
      const reportId = dongtian.activeReportId || '';
      await runTransaction(db, async (tx) => {
        const [dataSnap, indexSnap] = await Promise.all([tx.get(dataRef), tx.get(indexRef)]);
        if (!dataSnap.exists() || !indexSnap.exists()) throw new Error('洞天資料不存在');
        const live = dataSnap.data();
        if (live.ownerUid !== uid()) throw new Error('只有洞天主人可以修復');
        if (live.status !== 'suspended' || live.activeReportId !== reportId) throw new Error('洞天封印狀態已改變，請重新讀取');
        const liveQuestion = live.questions?.[questionIndex];
        if (!liveQuestion || liveQuestion.id !== originalQuestion.id) throw new Error('題目版本已改變，請重新讀取');
        const questions = [...live.questions];
        questions[questionIndex] = { ...revised, id: liveQuestion.id, difficulty: liveQuestion.difficulty, subject: liveQuestion.subject };
        const cleared = {
          status: 'active',
          moderationStatus: 'clear',
          activeReportId: null,
          flaggedQuestionId: null,
          flaggedQuestionIndex: null,
          flaggedReason: null,
          aiReviewSummary: null,
          lastRevisedAt: serverTimestamp(),
          lastRevisedAtMs: Date.now(),
          revisionCount: increment(1)
        };
        tx.update(dataRef, { ...cleared, questions });
        tx.update(indexRef, cleared);
        if (reportId) {
          tx.set(doc(db, REPORT_COLLECTION, reportId), {
            status: 'resolved',
            resolvedAt: serverTimestamp(),
            resolvedAtMs: Date.now(),
            resolutionHint: hint,
            revisedQuestion: questions[questionIndex],
            validation: payload.validation || null,
            resolvedByUid: uid()
          }, { merge: true });
        }
      });
      removeModerationModal();
      toast('題目修復通過嚴格驗證，洞天已重新開放。');
      state.listLoaded = false;
      await loadOwnDongtians(true);
    } catch (error) {
      console.error('[Dongtian repair]', error);
      status.innerHTML = `<span style="color:#fca5a5">${escapeHtml(error.message || '修復失敗')}</span><br>洞天仍維持封印；請調整修改提示詞後再試。`;
      submit.disabled = false;
      submit.textContent = '重新修復並驗證';
    } finally {
      state.moderationBusy = false;
    }
  }

  function rewardTier(accuracy) {
    if (accuracy >= 0.9) return '上品洞天機緣';
    if (accuracy >= 0.75) return '中品洞天機緣';
    if (accuracy >= 0.6) return '下品洞天機緣';
    return '微光洞天機緣';
  }

  async function finishDongtian() {
    const s = state.session;
    if (!s) return;
    if (!(await ensureSessionDongtianActive())) return;
    const correct = s.answers.filter((a) => a.isCorrect).length;
    const total = s.dongtian.questions.length;
    const accuracy = total ? correct / total : 0;
    const tier = rewardTier(accuracy);
    const firstCompletionReward = firstCompletionSpiritStones(total);
    const firstCompletion = await completeProgress(s, correct, total, tier).catch((error) => {
      console.warn('[Dongtian completion]', error);
      return false;
    });
    await writeDongtianHistory(s, true, correct, total, tier).catch(() => {});
    const overlay = ensureOverlay();
    overlay.innerHTML = `<div class="dt-result"><div class="dt-result-seal">天</div><h2>${escapeHtml(s.dongtian.name)} · 通關</h2><p>這次洞天題序已全部走完。答對率越高，未來洞天獎勵池開放後可對應更好的機緣。</p><div class="dt-result-grid"><div><span>答對</span><b>${correct} / ${total}</b></div><div><span>正確率</span><b>${Math.round(accuracy * 100)}%</b></div><div><span>機緣評級</span><b>${escapeHtml(tier.replace('洞天機緣', ''))}</b></div></div><div class="dt-reward">${firstCompletion ? `<strong style="color:#dfbdf5">首次通關洞天獎勵</strong><br>依 ${total} 題獲得 +${firstCompletionReward.toLocaleString()} 靈石。` : '此洞天的首次通關紀錄已存在；本次為重遊，不重複領取首次獎勵。'}${s.dongtian.ownerUid !== uid() && firstCompletion ? `<br><br>洞天主人已獲得 +${OWNER_CULTIVATION_REWARD} 修為與 +${OWNER_GOLD_REWARD} 金幣。` : ''}</div><button id="dt-back" class="dt-back" type="button">返回</button></div>`;
    document.getElementById('dt-back').onclick = closeAfterSession;
  }

  async function completeProgress(s, correct, total, tier) {
    const playRef = doc(db, PLAY_COLLECTION, `${uid()}__${s.dongtian.id}`);
    const indexRef = doc(db, INDEX_COLLECTION, s.dongtian.id);
    const firstCompletionReward = firstCompletionSpiritStones(total);
    let first = false;
    await runTransaction(db, async (tx) => {
      const [playSnap, indexSnap] = await Promise.all([tx.get(playRef), tx.get(indexRef)]);
      if (!indexSnap.exists() || indexSnap.data()?.status !== 'active') throw new Error('洞天已封印，本次不進行通關結算');
      const alreadyCompleted = playSnap.exists() && !!playSnap.data()?.completed;
      first = !alreadyCompleted;
      tx.set(playRef, {
        uid: uid(), dongtianId: s.dongtian.id, ownerUid: s.dongtian.ownerUid || '',
        encountered: true, completed: true, correct, total,
        accuracy: total ? correct / total : 0, rewardTier: tier,
        completedAt: serverTimestamp(), completedAtMs: Date.now()
      }, { merge: true });
      if (!alreadyCompleted) {
        tx.update(indexRef, { completionCount: increment(1) });
        tx.update(doc(db, 'users', uid()), {
          'stats.gold': increment(firstCompletionReward)
        });
        if (s.dongtian.ownerUid && s.dongtian.ownerUid !== uid()) {
          tx.update(doc(db, 'users', s.dongtian.ownerUid), {
            'stats.totalScore': increment(OWNER_CULTIVATION_REWARD),
            'stats.gold': increment(OWNER_GOLD_REWARD)
          });
        }
      }
    });
    if (first) {
      const data = userData();
      if (data) {
        data.stats = data.stats || {};
        data.stats.gold = Math.max(0, Number(data.stats.gold) || 0) + firstCompletionReward;
      }
      window.updateUIStats?.();
      window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', {
        detail: { source: 'dongtian-first-completion', goldAdded: firstCompletionReward, questionCount: total }
      }));
    }
    return first;
  }

  async function writeDongtianHistory(s, completed, correct = null, total = null, tier = '') {
    if (s.logged || !s.answers.length) return;
    s.logged = true;
    const c = correct ?? s.answers.filter((a) => a.isCorrect).length;
    const t = total ?? s.answers.length;
    await addDoc(collection(db, 'exam_logs'), {
      uid: uid(), email: auth.currentUser?.email || '',
      mode: 'dongtian', topic: '洞天',
      dongtianId: s.dongtian.id, dongtianName: s.dongtian.name,
      dongtianRunId: s.runId, dongtianCompleted: completed,
      dongtianSubject: s.dongtian.subject, dongtianLevel: s.dongtian.level,
      dongtianDifficulty: s.dongtian.difficulty,
      dongtianAnswers: s.answers,
      question: `洞天「${s.dongtian.name}」 · ${c}/${t}`,
      isCorrect: completed ? c === t : false,
      correctCount: c, totalCount: t,
      rewardTier: tier || rewardTier(t ? c / t : 0),
      timestamp: serverTimestamp(), startedAtMs: s.startedAt,
      explanation: completed ? '洞天完整通關紀錄' : '洞天中途退出紀錄'
    });
  }

  async function exitDongtian() {
    const s = state.session;
    if (!s) return;
    if (s.answers.length && !confirm('確定退出洞天？本次剩餘題目將不再繼續。')) return;
    await writeDongtianHistory(s, false).catch(() => {});
    closeAfterSession();
  }

  function closeAfterSession() {
    const source = state.session?.source;
    state.session = null;
    document.getElementById('dongtian-overlay')?.remove();
    if (source === 'owner') {
      window.switchToPage?.('page-settings');
      loadOwnDongtians(true);
    } else {
      window.switchToPage?.('page-home');
    }
  }

  function installQuizEncounterHook() {
    if (state.originalStartQuizFlow || typeof window.startQuizFlow !== 'function') return;
    state.originalStartQuizFlow = window.startQuizFlow;
    window.startQuizFlow = async function (...args) {
      if (!state.session && !state.encounterBusy) {
        const intercepted = await maybeEncounterBeforeQuiz();
        if (intercepted) return;
      }
      return state.originalStartQuizFlow.apply(this, args);
    };
  }

  // 法寶通用引擎只取得當前題目的安全索引，不接觸洞天其他流程。
  window.getDongtianArtifactQuestionContext = function () {
    const s = state.session;
    const question = s?.dongtian?.questions?.[s.index];
    if (!s || !question || !Array.isArray(s.currentOptions)) return null;
    const correctIndex = s.currentOptions.findIndex((item) => item?.correct);
    if (correctIndex < 0) return null;
    return {
      context: 'dongtian',
      key: `dongtian:${s.runId}:${s.index}:${question.id}`,
      correctIndex,
      answered: !!s.answered,
      buttonsSelector: '#dongtian-overlay [data-dt-answer]',
      containerSelector: '#dt-options'
    };
  };

  window.renderDongtianHistoryLog = function (log, time) {
    if (log?.mode !== 'dongtian') return null;
    const answers = Array.isArray(log.dongtianAnswers) ? log.dongtianAnswers : [];
    const li = document.createElement('li');
    li.className = 'dt-history p-3 rounded-lg text-xs border-l-4 mb-2 transition cursor-pointer';
    const correct = Number(log.correctCount ?? answers.filter((a) => a.isCorrect).length) || 0;
    const total = Number(log.totalCount ?? answers.length) || answers.length;
    li.innerHTML = `<div class="flex justify-between mb-1"><span class="text-gray-400 font-mono">${escapeHtml(time)}</span><span class="text-purple-300 font-bold">洞天紀錄</span></div><div class="text-white mb-1 text-sm font-bold">${escapeHtml(log.dongtianName || '無名洞天')}</div><div class="flex gap-2 flex-wrap text-[9px] text-gray-400"><span>${escapeHtml(log.dongtianLevel || '')}</span><span>${escapeHtml(log.dongtianSubject || '')}</span><span>${difficultyLabel(log.dongtianDifficulty)}</span><span>${log.dongtianCompleted ? '完整通關' : '中途退出'}</span><span>答對 ${correct}/${total}</span></div><div class="mt-2 text-[9px] text-purple-300/70"><i class="fa-solid fa-chevron-down"></i> 點擊展開整座洞天的答題紀錄</div><div class="details-panel hidden mt-3 pt-3 border-t border-white/10"><div class="dt-history-questions">${answers.map((answer, i) => `<article class="dt-history-q"><h5>${i + 1}. ${escapeHtml(answer.q)}</h5><div style="color:${answer.isCorrect ? '#86efac' : '#fca5a5'};font-size:9px;font-weight:900">${answer.isCorrect ? '答對' : '答錯'} · ${escapeHtml(answer.subject || '')}</div>${(answer.options || []).map((option, idx) => `<div style="margin-top:4px;color:${idx === answer.correctIdx ? '#86efac' : (idx === answer.userIdx ? '#fca5a5' : '#9ca3af')};font-size:9px">${String.fromCharCode(65 + idx)}. ${escapeHtml(option)}${idx === answer.correctIdx ? ' ✓' : (idx === answer.userIdx ? ' ✕' : '')}</div>`).join('')}<p><strong style="color:#c4b5fd">解析：</strong>${escapeHtml(answer.exp || '')}</p></article>`).join('')}</div></div>`;
    li.onclick = (event) => {
      if (event.target.closest('.details-panel')) return;
      li.querySelector('.details-panel')?.classList.toggle('hidden');
    };
    return li;
  };

  window.openDongtianPanel = function () {
    mount();
    window.switchToPage?.('page-settings');
    const card = document.getElementById('dongtian-card');
    const body = document.getElementById('dongtian-body');
    if (card && body) {
      setCardCollapsed(card, body, false);
      card.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      loadOwnDongtians();
    }
  };

  function boot() {
    ensureStyle();
    mount();
    installQuizEncounterHook();
    setTimeout(installQuizEncounterHook, 600);
    window.addEventListener('xiuxian:user-ready', () => { mount(); installQuizEncounterHook(); });
    window.addEventListener('focus', () => {
      if (!state.session && !document.getElementById('dongtian-body')?.hidden) loadOwnDongtians(true);
    });
    new MutationObserver(() => { if (!state.mounted) mount(); }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
