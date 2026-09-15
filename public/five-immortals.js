// 九州五大仙：全服固定五席，講台化設計，最高分者立於正中央，並支援完整頭像框特效。
(function () {
    'use strict';

    // 移除表情符號，保持嚴肅修仙感
    const ROLES = [
        { id: 'ru-xian', name: '儒仙', subject: '國文', desc: '以文載道' },
        { id: 'fa-xian', name: '法仙', subject: '社會', desc: '洞察世事' },
        { id: 'suan-xian', name: '算仙', subject: '數學', desc: '推演天機' },
        { id: 'xuan-xian', name: '玄仙', subject: '自然', desc: '參悟天地' },
        { id: 'wai-xian', name: '外仙', subject: '英文', desc: '通達萬邦' }
    ];

    let db = null, auth = null, fs = null, owners = {}, claiming = false;

    // 全新講台與頭像 CSS 設計
    const css = `
        .five-immortals { margin:0 0 16px; padding:20px 14px; border:1px solid rgba(233,196,106,.25); border-radius:22px; background:linear-gradient(145deg,rgba(31,25,45,.97),rgba(12,15,29,.97)); box-shadow:0 12px 40px rgba(0,0,0,.22); overflow: hidden; }
        .five-immortals h3 { margin:0; color:#f6e6b0; font-size:18px; font-weight:900; text-align: center; letter-spacing: 0.1em; }
        .five-immortals p { margin:6px 0 0; color:#8f96ad; font-size:10px; text-align: center; letter-spacing: 0.05em; }
        
        .podium-container { display: flex; justify-content: center; align-items: flex-end; gap: 6px; margin-top: 45px; min-height: 200px; }
        
        .podium-slot { display: flex; flex-direction: column; align-items: center; width: 19%; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(233,196,106,.15); border-bottom: none; border-radius: 8px 8px 0 0; padding: 10px 2px 4px; position: relative; transition: all 0.3s ease; }
        .podium-slot:hover { background: rgba(255, 255, 255, 0.08); }
        
        /* 講台高低排序：Rank 1 為正中央 */
        .rank-1 { order: 3; height: 180px; background: linear-gradient(to top, rgba(233,196,106,.15), rgba(255,255,255,0.02)); border-color: rgba(233,196,106,.5); box-shadow: 0 -10px 20px rgba(233,196,106,0.1); }
        .rank-2 { order: 2; height: 145px; }
        .rank-3 { order: 4; height: 130px; }
        .rank-4 { order: 1; height: 105px; }
        .rank-5 { order: 5; height: 90px; }
        
        /* 頭像框懸浮定位 */
        .avatar-wrapper { position: absolute; top: -24px; left: 50%; transform: translateX(-50%); z-index: 10; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.5)); }
        .rank-1 .avatar-wrapper { top: -36px; filter: drop-shadow(0 0 15px rgba(233,196,106,0.6)); }
        
        /* 文字排版 */
        .immortal-name { font-size: 11px; font-weight: 900; color: #fff; margin-top: 22px; text-align: center; }
        .rank-1 .immortal-name { font-size: 14px; color: #f6e6b0; margin-top: 32px; }
        .immortal-subject { font-size: 9px; font-weight: 800; color: #c8a85c; margin-top: 4px; text-align: center; }
        
        .immortal-owner-box { margin-top: auto; width: 100%; display: flex; flex-direction: column; align-items: center; }
        .immortal-owner { font-size: 10px; color: #aab0c5; text-align: center; font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; padding: 0 2px; }
        
        /* 按鈕與狀態 */
        .immortal-btn { margin-top: 6px; padding: 4px 0; width: 90%; border-radius: 4px; border: 1px solid rgba(233,196,106,.4); background: rgba(233,196,106,.15); color: #f6e6b0; font-size: 10px; font-weight: 900; cursor: pointer; transition: transform 0.2s; margin-bottom: 2px; }
        .immortal-btn:hover { background: rgba(233,196,106,.25); transform: scale(1.05); }
        .immortal-status { margin-top: 6px; margin-bottom: 2px; color: #7ee2b8; font-size: 9px; font-weight: 900; text-align: center; background: rgba(126,226,184,0.1); padding: 3px 0; border-radius: 4px; width: 90%; }
    `;

    function toast(msg) {
        const e = document.createElement('div');
        e.textContent = msg;
        e.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:999;padding:10px 16px;border-radius:999px;background:#111528;color:#f6e6b0;border:1px solid rgba(233,196,106,.35);font-size:12px';
        document.body.appendChild(e);
        setTimeout(() => e.remove(), 2600);
    }

    // 內建頭像生成器，支援最新外框特效
    function getAvatarHtml(equipped, sizeClass = "w-10 h-10") {
        if (!equipped) equipped = { frame: '', avatar: '' };
        const frame = equipped.frame || '';
        const avatar = equipped.avatar || '';
        const isFrameImg = frame && (frame.includes('.') || frame.includes('/'));

        const imgContent = avatar 
            ? `<img src="${avatar}" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"> <i class="fa-solid fa-user text-gray-400 absolute hidden"></i>`
            : `<i class="fa-solid fa-user text-gray-500 text-lg"></i>`;

        const borderClass = frame ? '' : 'border-2 border-slate-600';
        const cssFrameClass = (!isFrameImg && frame) ? frame : '';

        const frameImgElement = isFrameImg 
            ? `<img src="${frame}" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); height: 145%; width: auto; max-width: none; z-index: 50; pointer-events: none;">` 
            : '';

        return `
        <div class="${sizeClass} rounded-full bg-slate-800 flex items-center justify-center relative ${borderClass} ${cssFrameClass}" style="overflow: visible !important;">
            <div class="w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-slate-800 relative z-0">
                ${imgContent}
            </div>
            ${frameImgElement}
        </div>`;
    }

    async function connect() {
        try {
            const [appModule, a, f] = await Promise.all([
                import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js'),
                import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'),
                import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js')
            ]);
            const app = appModule.getApp();
            auth = a.getAuth(app);
            db = f.getFirestore(app);
            fs = f;
            await load();
        } catch (e) {
            console.warn('五大仙連線失敗', e);
            render();
        }
    }

    async function load() {
        if (!db) return;
        try {
            const snap = await fs.getDocs(fs.collection(db, 'worldImmortals'));
            owners = {};
            const uids = [];
            
            snap.forEach(d => {
                const data = d.data();
                owners[d.id] = data;
                if (data.uid && !uids.includes(data.uid)) {
                    uids.push(data.uid);
                }
            });

            // 根據取得的 uid 去 users 集合抓取最新的 積分與裝備(頭像框)
            const userScores = {};
            if (uids.length > 0) {
                const q = fs.query(fs.collection(db, 'users'), fs.where(fs.documentId(), 'in', uids));
                const usersSnap = await fs.getDocs(q);
                usersSnap.forEach(d => {
                    const userData = d.data();
                    userScores[d.id] = {
                        score: userData.stats?.totalScore || 0,
                        equipped: userData.equipped || { frame: '', avatar: '' }
                    };
                });
            }

            // 將抓到的分數與裝備綁定回仙主身上
            Object.keys(owners).forEach(roleId => {
                const uid = owners[roleId].uid;
                owners[roleId].score = userScores[uid]?.score || 0;
                owners[roleId].equipped = userScores[uid]?.equipped || null;
            });

        } catch (e) {
            console.warn('五大仙讀取失敗', e);
        }
        render();
    }

    async function claim(id) {
        if (claiming) return;
        const user = auth && auth.currentUser;
        if (!user) {
            toast('請先登入，才能問鼎仙位。');
            return;
        }
        if (owners[id]) {
            toast('此仙位已有仙主。');
            return;
        }
        
        claiming = true;
        try {
            const ref = fs.doc(db, 'worldImmortals', id);
            await fs.runTransaction(db, async tx => {
                const refs = ROLES.map(r => fs.doc(db, 'worldImmortals', r.id));
                const snaps = await Promise.all(refs.map(r => tx.get(r)));
                
                if (snaps.some(s => s.exists() && s.data().uid === user.uid)) {
                    throw new Error('ALREADY_HAS_ROLE');
                }
                const target = snaps[ROLES.findIndex(r => r.id === id)];
                if (target.exists()) {
                    throw new Error('TAKEN');
                }

                tx.set(ref, {
                    uid: user.uid,
                    displayName: user.displayName || '無名仙客',
                    role: id,
                    claimedAt: fs.serverTimestamp()
                });
            });
            toast('問鼎成功！恭喜登臨仙位。');
            await load();
        } catch (e) {
            if (e.message === 'TAKEN') {
                toast('慢了一步，此仙位已被他人問鼎。');
            } else if (e.message === 'ALREADY_HAS_ROLE') {
                toast('你已經擁有一席仙位，不可再占第二席。');
            } else {
                toast('仙位爭奪失敗，請稍後再試。');
            }
            await load();
        } finally {
            claiming = false;
        }
    }

    function render() {
        const container = document.getElementById('five-immortal-list');
        if (!container) return;
        
        const uid = auth && auth.currentUser ? auth.currentUser.uid : '';
        
        // 依照積分高低進行排名 (分數高者排前)
        const sortedRoles = [...ROLES].sort((a, b) => {
            const scoreA = owners[a.id]?.score || 0;
            const scoreB = owners[b.id]?.score || 0;
            return scoreB - scoreA;
        });

        // 將排名資訊配對回原始陣列，以決定講台高度 (rank-1 ~ rank-5)
        const renderData = ROLES.map(r => {
            const o = owners[r.id];
            const rankIndex = sortedRoles.findIndex(sr => sr.id === r.id);
            const rankNum = rankIndex + 1; 
            
            return {
                ...r,
                owner: o,
                rankClass: `rank-${rankNum}`,
                isMine: o && o.uid === uid
            };
        });

        // 渲染講台 HTML
        container.innerHTML = renderData.map(r => {
            const o = r.owner;
            // 第一名頭像較大，其餘為一般大小
            const sizeClass = r.rankClass === 'rank-1' ? "w-14 h-14" : "w-10 h-10";
            const avatarHtml = getAvatarHtml(o ? o.equipped : null, sizeClass);
            
            return `
                <div class="podium-slot ${r.rankClass}">
                    <div class="avatar-wrapper">
                        ${avatarHtml}
                    </div>
                    <div class="immortal-name">${r.name}</div>
                    <div class="immortal-subject">${r.subject}</div>
                    
                    <div class="immortal-owner-box">
                        ${o ? `
                        <div class="immortal-owner">${o.displayName || '無名仙客'}</div>
                        <div class="immortal-status">${r.isMine ? '你的仙位' : '已有仙主'}</div>
                        ` : `
                        <div class="immortal-owner" style="color: #475569;">尚無仙主</div>
                        <button class="immortal-btn" data-immortal="${r.id}">問鼎</button>
                        `}
                    </div>
                </div>
            `;
        }).join('');
        
        container.querySelectorAll('[data-immortal]').forEach(b => {
            b.onclick = () => claim(b.dataset.immortal);
        });
    }

    function mount() {
        if (!document.getElementById('five-immortals-style')) {
            const s = document.createElement('style');
            s.id = 'five-immortals-style';
            s.textContent = css;
            document.head.appendChild(s);
        }
        
        const rank = document.getElementById('page-rank');
        if (!rank || document.getElementById('five-immortals')) return;
        
        const box = document.createElement('section');
        box.id = 'five-immortals';
        box.className = 'five-immortals';
        box.innerHTML = `
            <h3>九州五大仙</h3>
            <p>全服僅有五席 · 儒仙 · 法仙 · 算仙 · 玄仙 · 外仙</p>
            <div id="five-immortal-list" class="podium-container"></div>
        `;
        
        const first = rank.firstElementChild;
        rank.insertBefore(box, first || null);
        render();
        connect();
    }

    function boot() {
        mount();
        setInterval(() => {
            if (!document.getElementById('five-immortals')) mount();
        }, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
