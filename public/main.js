// 🔥 修正：使用純 URL 引入 Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp, where, onSnapshot, runTransaction, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Firebase Config
const firebaseConfig = {
    apiKey: "AIzaSyDifdJmLTmwQATz__xUHSkXZ_xXOWyX-wU",
    authDomain: "question-learning.firebaseapp.com",
    projectId: "question-learning",
    storageBucket: "question-learning.firebasestorage.app",
    messagingSenderId: "1058543232092",
    appId: "1:1058543232092:web:3fcc40f5f069b6df307299",
    measurementId: "G-76ER8RGBN7"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth();
const db = getFirestore();
const provider = new GoogleAuthProvider();

let currentUserData = null;
const RANKS = ["🥉 青銅", "🥈 白銀", "🥇 黃金", "🔷 鑽石", "🌟 星耀"];

// 緩衝與狀態變數
let quizBuffer = [];
const BUFFER_SIZE = 1; 
let isFetchingBuffer = false; 
let battleUnsub = null; 
let currentBattleId = null;
let isBattleActive = false; 
let currentBankData = null; 
let presenceInterval = null; 
let notificationUnsub = null; // 🔥 通知監聽器

// 全域變數：儲存所有題庫檔案列表
let allBankFiles = [];

// 綁定全域函式
window.googleLogin = () => { signInWithPopup(auth, provider).catch((error) => alert("登入失敗: " + error.code)); };
window.logout = () => { 
    localStorage.removeItem('currentQuiz');
    signOut(auth).then(() => location.reload()); 
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('bottom-nav').classList.remove('hidden');
        document.getElementById('user-info').innerHTML = `<i class="fa-solid fa-user-astronaut"></i> ${user.displayName}`;
        document.getElementById('settings-email').innerText = user.email;

        // 注入社交 UI
        injectSocialUI();
        // 🔥 注入通知容器
        injectNotificationContainer();

        const userRef = doc(db, "users", user.uid);
        try {
            const docSnap = await getDoc(userRef);
            
            if (docSnap.exists()) {
                currentUserData = docSnap.data();
                if (!currentUserData.inventory) currentUserData.inventory = [];
                if (!currentUserData.equipped) currentUserData.equipped = { frame: '', avatar: '' };
                if (!currentUserData.friends) currentUserData.friends = [];
                if (!currentUserData.friendCode) {
                    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
                    await updateDoc(userRef, { friendCode: code });
                    currentUserData.friendCode = code;
                }
            } else {
                const code = Math.random().toString(36).substring(2, 8).toUpperCase();
                currentUserData = {
                    uid: user.uid, displayName: user.displayName, email: user.email,
                    profile: { educationLevel: "", strongSubjects: "", weakSubjects: "" },
                    inventory: [], 
                    equipped: { frame: '', avatar: '' }, 
                    stats: { 
                        rankLevel: 0, currentStars: 0, totalScore: 0,
                        currentStreak: 0, bestStreak: 0, totalCorrect: 0, totalAnswered: 0
                    },
                    friends: [], 
                    friendCode: code, 
                    isAdmin: false
                };
                await setDoc(userRef, currentUserData);
            }

            startPresenceSystem();
            listenForNotifications(); // 🔥 開始監聽邀請

            updateUserAvatarDisplay();
            updateSettingsInputs();
            checkAdminRole(currentUserData.isAdmin);
            updateUIStats();

            if (!currentUserData.profile.educationLevel || currentUserData.profile.educationLevel === "") {
                switchToPage('page-onboarding'); 
                document.getElementById('bottom-nav').classList.add('hidden'); 
            } else {
                switchToPage('page-home');
                fillBuffer(); 
            }

        } catch (error) { console.error(error); alert("資料讀取錯誤"); }
    } else {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('bottom-nav').classList.add('hidden');
    }
});

// ==========================================
//  🔥 邀請通知系統 (New Features)
// ==========================================

// 1. 注入通知容器 (Toasts)
function injectNotificationContainer() {
    if (document.getElementById('notification-container')) return;
    const div = document.createElement('div');
    div.id = 'notification-container';
    div.className = "fixed top-4 right-4 z-[100] flex flex-col gap-2 w-72 pointer-events-none"; // pointer-events-none 讓點擊穿透，卡片本身再開
    document.body.appendChild(div);
}

// 2. 監聽通知
function listenForNotifications() {
    if (notificationUnsub) notificationUnsub();
    
    // 監聽 users/{uid}/notifications 子集合
    const q = query(collection(db, "users", auth.currentUser.uid, "notifications"), orderBy("timestamp", "desc"), limit(5));
    
    notificationUnsub = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const data = change.doc.data();
                // 只顯示 1 分鐘內的邀請，避免舊通知一直跳
                const now = new Date();
                const inviteTime = data.timestamp ? data.timestamp.toDate() : new Date(0);
                if ((now - inviteTime) < 60 * 1000) {
                    showNotification(change.doc.id, data);
                }
            }
        });
    });
}

// 3. 顯示通知卡片
function showNotification(docId, data) {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    
    // UI 設計
    toast.className = "bg-slate-800/90 backdrop-blur-md border border-yellow-500/50 p-4 rounded-xl shadow-2xl transform translate-x-full transition-all duration-300 pointer-events-auto flex flex-col gap-2";
    toast.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="bg-yellow-500/20 p-2 rounded-full text-yellow-400">
                <i class="fa-solid fa-swords"></i>
            </div>
            <div>
                <h4 class="font-bold text-white text-sm">對戰邀請！</h4>
                <p class="text-xs text-gray-300 mt-1">玩家 <span class="text-yellow-300 font-bold">${data.hostName}</span> 邀請你一決勝負！</p>
            </div>
        </div>
        <div class="flex gap-2 mt-1">
            <button onclick="rejectInvite('${docId}', this)" class="flex-1 bg-slate-700 hover:bg-slate-600 text-xs py-2 rounded text-gray-300 transition">忽略</button>
            <button onclick="acceptInvite('${data.roomId}', '${docId}', this)" class="flex-1 bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500 text-xs py-2 rounded text-white font-bold shadow-lg transition animate-pulse">
                接受挑戰 ⚔️
            </button>
        </div>
    `;

    container.appendChild(toast);
    
    // 進場動畫
    requestAnimationFrame(() => {
        toast.classList.remove('translate-x-full');
    });

    // 10秒後自動消失
    setTimeout(() => {
        dismissToast(toast, docId);
    }, 10000);
}

// 4. 忽略邀請
window.rejectInvite = async (docId, btn) => {
    const toast = btn.closest('div').parentElement; // 找到外層 div
    dismissToast(toast, docId);
};

// 5. 接受邀請 (加入指定房間)
window.acceptInvite = async (roomId, docId, btn) => {
    const toast = btn.closest('div').parentElement;
    dismissToast(toast, docId); // 先關閉通知
    
    // 加入指定房間邏輯
    await joinBattleRoom(roomId);
};

// 輔助：移除 Toast 並刪除資料庫紀錄
async function dismissToast(element, docId) {
    element.classList.add('translate-x-full', 'opacity-0');
    setTimeout(() => {
        if(element.parentElement) element.parentElement.removeChild(element);
    }, 300);

    // 刪除 Firestore 中的通知文件，避免重複顯示
    try {
        await deleteDoc(doc(db, "users", auth.currentUser.uid, "notifications", docId));
    } catch(e) { console.error("刪除通知失敗", e); }
}

// 🔥 新增：隨機邀請線上玩家 (由建立房間者呼叫)
async function inviteOnlinePlayers(roomId) {
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        
        // 1. 搜尋線上玩家
        // 注意：這需要複合索引 (lastActive + uid 雖然不能直接混用，但可以用 client side filter)
        const q = query(
            collection(db, "users"), 
            where("lastActive", ">", fiveMinutesAgo),
            limit(20) // 限制抓取數量，避免讀取太多
        );
        
        const snapshot = await getDocs(q);
        
        // 2. 排除自己，並隨機選 3 人
        const candidates = snapshot.docs
            .filter(d => d.id !== auth.currentUser.uid)
            .map(d => d.id);
            
        if (candidates.length === 0) return;

        // 洗牌並取前 3 個
        const selectedIds = shuffleArray(candidates).slice(0, 3);
        
        console.log(`正在邀請 ${selectedIds.length} 位玩家...`);

        // 3. 發送邀請 (寫入對方的 notifications)
        const batch = [];
        selectedIds.forEach(targetUid => {
            const ref = collection(db, "users", targetUid, "notifications");
            addDoc(ref, {
                type: "battle_invite",
                roomId: roomId,
                hostName: currentUserData.displayName || "神秘玩家",
                timestamp: serverTimestamp()
            });
        });

    } catch (e) {
        console.error("邀請發送失敗 (可能是索引問題或權限):", e);
    }
}

// 🔥 新增：加入指定房間 (供接受邀請使用)
async function joinBattleRoom(roomId) {
    if (isBattleActive) return alert("你已經在戰鬥或配對中了！");
    
    // 檢查房間是否存在
    const roomRef = doc(db, "rooms", roomId);
    const roomSnap = await getDoc(roomRef);
    
    if (!roomSnap.exists()) return alert("該房間已不存在");
    const roomData = roomSnap.data();
    
    if (roomData.status !== "waiting" || roomData.guest) {
        return alert("該房間已滿或遊戲已開始");
    }

    // 準備加入
    const myPlayerData = { 
        uid: auth.currentUser.uid, 
        name: currentUserData.displayName, 
        score: 0, 
        done: false,
        equipped: currentUserData.equipped || { frame: '', avatar: '' } 
    };

    isBattleActive = true;
    switchToPage('page-battle');
    document.getElementById('battle-lobby').classList.add('hidden');
    document.getElementById('battle-arena').classList.remove('hidden');
    
    try {
        await updateDoc(roomRef, {
            guest: myPlayerData,
            status: "ready"
        });
        currentBattleId = roomId;
        listenToBattleRoom(roomId);
    } catch (e) {
        console.error(e);
        alert("加入房間失敗");
        leaveBattle();
    }
}


// ==========================================
//  🔥 社交系統 (UI & 上線狀態)
// ==========================================

function injectSocialUI() {
    if (document.getElementById('btn-social-nav')) return;

    const navGrid = document.getElementById('nav-grid');
    navGrid.classList.remove('grid-cols-5');
    navGrid.classList.add('grid-cols-6');

    const btn = document.createElement('button');
    btn.id = "btn-social-nav";
    btn.setAttribute("onclick", "switchToPage('page-social')");
    btn.dataset.target = "page-social";
    btn.className = "flex flex-col items-center justify-center hover:bg-white/5 text-gray-400 hover:text-white transition group";
    btn.innerHTML = `<i class="fa-solid fa-users mb-1 text-lg group-hover:text-cyan-400 transition-colors"></i><span class="text-[10px]">社交</span>`;
    
    const settingsBtn = navGrid.lastElementChild;
    navGrid.insertBefore(btn, settingsBtn);

    const main = document.querySelector('main');
    const pageSocial = document.createElement('div');
    pageSocial.id = "page-social";
    pageSocial.className = "page-section hidden";
    pageSocial.innerHTML = `
        <div class="sticky top-0 bg-slate-900/95 backdrop-blur-sm z-20 pb-4 border-b border-slate-800 mb-4">
            <h2 class="text-2xl font-bold text-cyan-400 flex items-center gap-2">
                <i class="fa-solid fa-users"></i> 好友列表
            </h2>
            <div class="mt-4 bg-slate-800 p-4 rounded-xl border border-slate-700">
                <div class="text-xs text-gray-400 mb-1">我的好友代碼</div>
                <div class="flex justify-between items-center">
                    <span class="text-2xl font-mono font-bold text-white tracking-widest" id="my-friend-code">...</span>
                    <button onclick="copyFriendCode()" class="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-white transition">複製</button>
                </div>
            </div>
            <div class="flex gap-2 mt-3">
                <input type="text" id="input-friend-code" placeholder="輸入對方代碼 (不分大小寫)" class="flex-1 bg-slate-900 border border-slate-600 text-white rounded-lg p-3 outline-none focus:border-cyan-500 uppercase">
                <button onclick="addFriend()" class="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white px-4 rounded-lg font-bold shadow-lg">
                    <i class="fa-solid fa-user-plus"></i>
                </button>
            </div>
        </div>
        <div id="friend-list-container" class="space-y-3 pb-20">
            <div class="text-center text-gray-500 py-10">載入中...</div>
        </div>
    `;
    main.appendChild(pageSocial);
}

function startPresenceSystem() {
    if (presenceInterval) clearInterval(presenceInterval);
    
    const updatePresence = async () => {
        if (!auth.currentUser) return;
        try {
            const userRef = doc(db, "users", auth.currentUser.uid);
            await updateDoc(userRef, {
                lastActive: serverTimestamp() 
            });
        } catch (e) { console.error("Presence update failed", e); }
    };

    updatePresence();
    presenceInterval = setInterval(updatePresence, 60 * 1000);
}

window.copyFriendCode = () => {
    const code = document.getElementById('my-friend-code').innerText;
    navigator.clipboard.writeText(code).then(() => alert("代碼已複製！"));
};

window.addFriend = async () => {
    const input = document.getElementById('input-friend-code');
    const targetCode = input.value.trim().toUpperCase();
    
    if (!targetCode) return alert("請輸入代碼");
    if (targetCode === currentUserData.friendCode) return alert("不能加自己為好友 XD");

    const btn = document.querySelector('button[onclick="addFriend()"]');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
        const q = query(collection(db, "users"), where("friendCode", "==", targetCode));
        const snap = await getDocs(q);

        if (snap.empty) {
            alert("找不到此代碼，請確認是否輸入正確。");
            return;
        }

        const targetUserDoc = snap.docs[0];
        const targetUserId = targetUserDoc.id;
        const targetUserData = targetUserDoc.data();

        if (currentUserData.friends.includes(targetUserId)) {
            alert("你們已經是好友囉！");
            return;
        }

        await runTransaction(db, async (transaction) => {
            const myRef = doc(db, "users", auth.currentUser.uid);
            const friendRef = doc(db, "users", targetUserId);

            transaction.update(myRef, { friends: arrayUnion(targetUserId) });
            transaction.update(friendRef, { friends: arrayUnion(auth.currentUser.uid) });
        });

        currentUserData.friends.push(targetUserId);
        
        alert(`成功添加 ${targetUserData.displayName} 為好友！`);
        input.value = "";
        loadFriendList();

    } catch (e) {
        console.error(e);
        alert("新增失敗：" + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus"></i>';
    }
};

window.loadFriendList = async () => {
    const container = document.getElementById('friend-list-container');
    const myCodeEl = document.getElementById('my-friend-code');
    
    if (currentUserData && currentUserData.friendCode) {
        myCodeEl.innerText = currentUserData.friendCode;
    }

    if (!currentUserData.friends || currentUserData.friends.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 opacity-50">
                <i class="fa-solid fa-user-group text-4xl mb-3"></i>
                <p>還沒有好友...</p>
                <p class="text-xs mt-1">快把代碼分享給朋友吧！</p>
            </div>`;
        return;
    }

    container.innerHTML = '<div class="loader"></div>';

    try {
        const promises = currentUserData.friends.map(uid => getDoc(doc(db, "users", uid)));
        const docs = await Promise.all(promises);

        container.innerHTML = '';
        
        docs.forEach(d => {
            if (!d.exists()) return;
            const fData = d.data();
            
            const now = new Date();
            const lastActive = fData.lastActive ? fData.lastActive.toDate() : new Date(0);
            const diffMinutes = (now - lastActive) / 1000 / 60;
            const isOnline = diffMinutes < 5;

            const statusHtml = isOnline 
                ? `<span class="text-green-400 text-xs flex items-center gap-1"><div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div> 線上</span>`
                : `<span class="text-gray-500 text-xs">離線 (${getTimeAgo(lastActive)})</span>`;

            const div = document.createElement('div');
            div.className = "bg-slate-800/50 p-3 rounded-xl border border-slate-700 flex items-center gap-3";
            div.innerHTML = `
                ${getAvatarHtml(fData.equipped, "w-12 h-12")}
                <div class="flex-1">
                    <div class="flex justify-between items-center">
                        <span class="font-bold text-white">${fData.displayName}</span>
                        <span class="text-xs text-yellow-500 font-mono">${RANKS[Math.min(fData.stats?.rankLevel || 0, 4)].split(' ')[1]}</span>
                    </div>
                    <div class="flex justify-between items-center mt-1">
                        ${statusHtml}
                        <span class="text-[10px] text-gray-500">積分: ${fData.stats?.totalScore || 0}</span>
                    </div>
                </div>
            `;
            container.appendChild(div);
        });

    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="text-red-400 text-center">載入失敗</div>';
    }
};

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds > 86400) return Math.floor(seconds/86400) + "天前";
    if (seconds > 3600) return Math.floor(seconds/3600) + "小時前";
    if (seconds > 60) return Math.floor(seconds/60) + "分鐘前";
    return "剛剛";
}

// 頁面切換控制 (加入 page-social)
window.switchToPage = (pageId) => {
    if (isBattleActive && pageId !== 'page-battle') {
        alert("⚔️ 戰鬥/配對中無法切換頁面！\n請先取消配對或完成對戰。");
        return;
    }

    document.querySelectorAll('.page-section').forEach(el => { el.classList.remove('active-page', 'hidden'); el.classList.add('hidden'); });
    const target = document.getElementById(pageId);
    if(target) { target.classList.remove('hidden'); target.classList.add('active-page'); }
    
    document.querySelectorAll('#nav-grid button').forEach(btn => {
        if(isBattleActive) {
            btn.classList.add('nav-locked');
        } else {
            btn.classList.remove('nav-locked');
        }

        if (btn.dataset.target === pageId) { 
            btn.classList.add('text-white'); 
            btn.classList.remove('text-gray-400');
            if (pageId === 'page-social') {
                btn.querySelector('i').className = "fa-solid fa-users mb-1 text-lg text-cyan-400 transition-colors";
            }
        } else { 
            btn.classList.remove('text-white'); 
            btn.classList.add('text-gray-400'); 
            if (btn.dataset.target === 'page-social') {
                 btn.querySelector('i').className = "fa-solid fa-users mb-1 text-lg group-hover:text-cyan-400 transition-colors";
            }
        }
    });
    
    if (pageId === 'page-settings') {
        renderInventory();
        loadUserHistory();
    }
    if (pageId === 'page-admin') {
        loadAdminData();
    }
    if (pageId === 'page-social') {
        loadFriendList(); 
    }
};

// ==========================================
//  (其餘原有函式：updateUIStats, buildPathTree, countJsonFiles, etc... 保持不變，直接沿用)
// ==========================================

function updateUIStats() {
    if(!currentUserData) return;
    const stats = currentUserData.stats;
    
    if(typeof stats.currentStreak === 'undefined') stats.currentStreak = 0;
    if(typeof stats.bestStreak === 'undefined') stats.bestStreak = 0;
    if(typeof stats.totalCorrect === 'undefined') stats.totalCorrect = 0;
    if(typeof stats.totalAnswered === 'undefined') stats.totalAnswered = 0;

    const rankColors = [
        "text-orange-600", "text-gray-300", "text-yellow-400", "text-blue-600",
        "text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-500 to-red-500"
    ];

    const maxRankIndex = RANKS.length - 1;
    const rankIndex = Math.min(stats.rankLevel || 0, maxRankIndex);

    const rankEl = document.getElementById('display-rank');
    rankEl.innerText = RANKS[rankIndex] || "未知";
    const colorClass = rankColors[rankIndex] || "text-white";
    rankEl.className = `text-5xl font-black mb-2 animate-pulse ${colorClass}`;

    document.getElementById('display-stars').innerText = stats.currentStars;
    document.getElementById('display-score').innerText = stats.totalScore;
    document.getElementById('display-streak').innerText = stats.currentStreak;
    document.getElementById('display-best-streak').innerText = stats.bestStreak;
    
    const accuracy = stats.totalAnswered > 0 ? ((stats.totalCorrect / stats.totalAnswered) * 100).toFixed(1) : "0.0";
    document.getElementById('display-accuracy').innerText = accuracy + "%";
    
    setTimeout(() => { document.getElementById('progress-bar').style.width = `${(stats.currentStars / 10) * 100}%`; }, 100);
}

function buildPathTree(paths) {
    const tree = { name: "root", children: {} };
    paths.forEach(path => {
        const parts = path.split('/');
        let current = tree;
        parts.forEach((part, index) => {
            if (!current.children[part]) {
                current.children[part] = {
                    name: part,
                    type: index === parts.length - 1 ? 'file' : 'folder',
                    fullPath: index === parts.length - 1 ? path : null,
                    children: {}
                };
            }
            current = current.children[part];
        });
    });
    return tree;
}

function countJsonFiles(node) {
    if (node.type === 'file') return 1;
    let count = 0;
    for (const key in node.children) {
        count += countJsonFiles(node.children[key]);
    }
    return count;
}

window.renderCascadingSelectors = (tree, currentPath) => {
    const container = document.getElementById('bank-selectors-container');
    const hiddenInput = document.getElementById('set-source-final-value');
    const hint = document.getElementById('bank-selection-hint');
    
    if (!container) return;

    container.innerHTML = ''; 
    let selectedParts = (currentPath && currentPath !== 'ai') ? currentPath.split('/') : ['ai'];

    const createSelect = (level, currentNode) => {
        const wrapper = document.createElement('div');
        const select = document.createElement('select');
        select.className = "w-full bg-slate-900/50 border border-slate-600 text-white rounded-xl p-3 outline-none focus:border-yellow-500 transition-all cursor-pointer";
        
        const defaultOpt = document.createElement('option');
        defaultOpt.value = "";
        defaultOpt.innerText = level === 0 ? "-- 請選擇模式 --" : "-- 請選擇分類 --";
        defaultOpt.disabled = true;
        if (!selectedParts[level]) defaultOpt.selected = true;
        select.appendChild(defaultOpt);

        if (level === 0) {
            const aiOpt = document.createElement('option');
            aiOpt.value = "ai";
            aiOpt.innerText = "✨ AI 隨機生成";
            if (selectedParts[0] === 'ai') aiOpt.selected = true;
            select.appendChild(aiOpt);
        }

        const keys = Object.keys(currentNode.children);
        if (keys.length === 0 && level > 0) return;

        keys.forEach(key => {
            const node = currentNode.children[key];
            const opt = document.createElement('option');
            opt.value = key;
            opt.innerText = node.type === 'file' ? `📄 ${key.replace('.json', '')}` : `📂 ${key}`;
            if (selectedParts[level] === key) opt.selected = true;
            select.appendChild(opt);
        });

        select.onchange = (e) => {
            const val = e.target.value;
            const newParts = selectedParts.slice(0, level);
            newParts.push(val);
            const currentFullPath = newParts.join('/');

            if (val === 'ai') {
                hiddenInput.value = 'ai';
                hint.innerText = "目前設定：AI 隨機出題";
                hint.className = "text-xs text-green-400 mt-1";
                renderCascadingSelectors(tree, 'ai');
            } else {
                const nextNode = currentNode.children[val];
                let hasSubFolders = false;
                if (nextNode.type === 'folder') {
                    for (const childKey in nextNode.children) {
                        if (nextNode.children[childKey].type === 'folder') {
                            hasSubFolders = true;
                            break;
                        }
                    }
                }

                if (nextNode.type === 'file') {
                    hiddenInput.value = currentFullPath;
                    hint.innerText = `✅ 已選擇考卷：${val.replace('.json', '')}`;
                    hint.className = "text-xs text-green-400 mt-1";
                    renderCascadingSelectors(tree, currentFullPath);
                } else if (hasSubFolders) {
                    hiddenInput.value = ""; 
                    hint.innerText = "⚠️ 請繼續選擇下一層分類...";
                    hint.className = "text-xs text-yellow-500 mt-1";
                    renderCascadingSelectors(tree, newParts.join('/'));
                } else {
                    hiddenInput.value = currentFullPath;
                    const count = countJsonFiles(nextNode);
                    hint.innerText = `📂 已選擇分類：${val} (全卷混合 ${count} 份考卷)`;
                    hint.className = "text-xs text-blue-400 mt-1";
                    renderCascadingSelectors(tree, currentFullPath);
                }
            }
        };
        container.appendChild(wrapper);
        wrapper.appendChild(select);

        const currentVal = selectedParts[level];
        if (currentVal && currentVal !== 'ai' && currentNode.children[currentVal]) {
            createSelect(level + 1, currentNode.children[currentVal]);
        }
    };
    createSelect(0, tree);
};

async function updateSettingsInputs() {
    if (currentUserData && currentUserData.profile) {
        document.getElementById('set-level').value = currentUserData.profile.educationLevel || "國中一年級";
        document.getElementById('set-strong').value = currentUserData.profile.strongSubjects || "";
        document.getElementById('set-weak').value = currentUserData.profile.weakSubjects || "";
        
        const settings = currentUserData.gameSettings || { source: 'ai', difficulty: 'medium' };
        const diffSelect = document.getElementById('set-difficulty');
        if(diffSelect) diffSelect.value = settings.difficulty;

        const container = document.getElementById('bank-selectors-container');
        const hiddenInput = document.getElementById('set-source-final-value');
        const hint = document.getElementById('bank-selection-hint');

        if (container) {
            hiddenInput.value = settings.source;
            if(settings.source === 'ai') {
                hint.innerText = "目前設定：AI 隨機出題";
                hint.className = "text-xs text-green-400 mt-1";
            } else {
                hint.innerText = `已選擇：${settings.source.replace('.json', '')}`;
                hint.className = "text-xs text-blue-400 mt-1";
            }

            try {
                const res = await fetch('/api/banks');
                const data = await res.json();
                if (data.files && Array.isArray(data.files)) {
                    allBankFiles = data.files; 
                    const tree = buildPathTree(data.files);
                    renderCascadingSelectors(tree, settings.source);
                }
            } catch (e) {
                console.error("無法載入題庫列表", e);
                container.innerHTML = '<div class="text-red-400 text-xs">載入失敗</div>';
            }
        }
    }
}

async function getCleanSubjects(rawText) {
    if (!rawText) return "";
    try {
        const response = await fetch('/api/analyze-subjects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: rawText })
        });
        const data = await response.json();
        return data.subjects;
    } catch (e) { return rawText; }
}

window.submitOnboarding = async () => {
    const level = document.getElementById('ob-level').value;
    const rawStrong = document.getElementById('ob-strong').value;
    const rawWeak = document.getElementById('ob-weak').value;
    if(!level) { alert("請選擇年級"); return; }
    const btn = document.querySelector('button[onclick="submitOnboarding()"]');
    btn.innerText = "AI 分析中..."; btn.disabled = true;
    const cleanStrong = await getCleanSubjects(rawStrong);
    const cleanWeak = await getCleanSubjects(rawWeak);
    await updateDoc(doc(db, "users", auth.currentUser.uid), { 
        "profile.educationLevel": level, 
        "profile.strongSubjects": cleanStrong, 
        "profile.weakSubjects": cleanWeak,
    });
    currentUserData.profile.educationLevel = level; 
    currentUserData.profile.strongSubjects = cleanStrong; 
    currentUserData.profile.weakSubjects = cleanWeak;
    updateSettingsInputs(); 
    updateUIStats(); 
    switchToPage('page-home');          
    document.getElementById('bottom-nav').classList.remove('hidden'); 
    localStorage.removeItem('currentQuiz'); 
    quizBuffer = []; 
    fillBuffer(); 
    btn.innerText = "開始旅程 🚀"; btn.disabled = false;
};

window.saveProfile = async () => {
    const level = document.getElementById('set-level').value;
    const rawStrong = document.getElementById('set-strong').value;
    const rawWeak = document.getElementById('set-weak').value;
    const source = document.getElementById('set-source-final-value').value; 
    const difficulty = document.getElementById('set-difficulty').value;

    if (!source) {
        alert("請完整選擇出題來源");
        return;
    }

    const btn = document.querySelector('button[onclick="saveProfile()"]');
    btn.innerText = "處理中..."; btn.disabled = true;

    const cleanStrong = await getCleanSubjects(rawStrong);
    const cleanWeak = await getCleanSubjects(rawWeak);
    document.getElementById('set-strong').value = cleanStrong;
    document.getElementById('set-weak').value = cleanWeak;

    await updateDoc(doc(db, "users", auth.currentUser.uid), { 
        "profile.educationLevel": level, 
        "profile.strongSubjects": cleanStrong, 
        "profile.weakSubjects": cleanWeak,
        "gameSettings": { source, difficulty } 
    });

    currentUserData.profile.educationLevel = level;
    currentUserData.profile.strongSubjects = cleanStrong;
    currentUserData.profile.weakSubjects = cleanWeak;
    currentUserData.gameSettings = { source, difficulty };

    currentBankData = null; 
    localStorage.removeItem('currentQuiz'); 
    quizBuffer = []; 
    fillBuffer();

    btn.innerText = "儲存成功！"; 
    setTimeout(() => { 
        btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> 更新設定`; 
        btn.disabled = false; 
    }, 2000);
};

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function switchToAI() {
    await updateDoc(doc(db, "users", auth.currentUser.uid), { "gameSettings.source": 'ai' });
    currentUserData.gameSettings.source = 'ai';
    return fetchOneQuestion(); 
}

async function fetchOneQuestion() {
    const settings = currentUserData.gameSettings || { source: 'ai', difficulty: 'medium' };
    const rankName = RANKS[Math.min(currentUserData.stats.rankLevel || 0, RANKS.length - 1)];
    
    if (settings.source === 'ai') {
        const BACKEND_URL = "/api/generate-quiz";
        const level = currentUserData.profile.educationLevel || "一般";
        
        let rawWeakString = currentUserData.profile.weakSubjects || "";
        let rawStrongString = currentUserData.profile.strongSubjects || "";
        let weakArray = rawWeakString.split(/[,，\s]+/).filter(s => s.trim().length > 0);
        let strongArray = rawStrongString.split(/[,，\s]+/).filter(s => s.trim().length > 0);
        const generalTopics = ["台灣歷史", "世界地理", "生活科學", "邏輯推理", "國語文常識", "科技新知"];
        let targetSubject = "";
        const rand = Math.random(); 

        if (weakArray.length > 0 && rand < 0.6) targetSubject = weakArray[Math.floor(Math.random() * weakArray.length)];
        else {
            const pool = [...strongArray, ...generalTopics];
            targetSubject = pool[Math.floor(Math.random() * pool.length)];
        }
        
        const response = await fetch(BACKEND_URL, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                subject: targetSubject, level: level, rank: rankName, difficulty: settings.difficulty 
            })
        });
        
        if (!response.ok) throw new Error(`Server Error: ${response.status}`);
        const data = await response.json();
        let aiText = data.text;
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) aiText = jsonMatch[0];
        const rawData = JSON.parse(aiText);
        
        let allOptions = [rawData.correct, ...rawData.wrong];
        allOptions = shuffleArray(allOptions);
        const correctIndex = allOptions.indexOf(rawData.correct);
        
        return {
            data: { q: rawData.q, opts: allOptions, ans: correctIndex, exp: rawData.exp },
            rank: rankName,
            badge: `🎯 題目: [${targetSubject}]` 
        };
    } 
    else {
        let targetSource = settings.source; 

        if (!currentBankData || currentBankData.sourcePath !== targetSource) {
            let filesToFetch = [];
            if (targetSource.endsWith('.json')) {
                filesToFetch = [targetSource];
            } else {
                if (allBankFiles.length === 0) {
                     try {
                         const res = await fetch('/api/banks');
                         const data = await res.json();
                         allBankFiles = data.files || [];
                     } catch (e) { console.error(e); }
                }
                filesToFetch = allBankFiles.filter(f => f.startsWith(targetSource + '/'));
                if (filesToFetch.length === 0) {
                    console.error("資料夾下無題目:", targetSource);
                    return switchToAI();
                }
            }

            try {
                console.log(`📚 正在載入 ${filesToFetch.length} 份考卷...`);
                const fetchPromises = filesToFetch.map(filePath => 
                    fetch(`/banks/${filePath}?t=${Date.now()}`)
                        .then(res => {
                            if (!res.ok) throw new Error(`Failed to load ${filePath}`);
                            return res.json();
                        })
                        .catch(err => {
                            console.warn(`跳過損壞的檔案: ${filePath}`, err);
                            return []; 
                        })
                );
                const results = await Promise.all(fetchPromises);
                const mergedQuestions = results.flat();
                if (mergedQuestions.length === 0) throw new Error("沒有讀取到任何有效題目");
                currentBankData = { 
                    sourcePath: targetSource, 
                    questions: mergedQuestions 
                };
            } catch (e) {
                console.error("題庫載入錯誤:", e);
                alert("題庫載入失敗，切換回 AI 模式");
                return switchToAI();
            }
        }

        const filteredQuestions = currentBankData.questions.filter(q => q.difficulty === settings.difficulty);
        const pool = filteredQuestions.length > 0 ? filteredQuestions : currentBankData.questions;
        if (pool.length === 0) throw new Error("題庫是空的！");

        const rawData = pool[Math.floor(Math.random() * pool.length)];
        let allOptions = shuffleArray([rawData.correct, ...rawData.wrong]);
        const correctIndex = allOptions.indexOf(rawData.correct);

        let displaySubject = rawData.subject;
        if (!displaySubject) {
            displaySubject = targetSource.split('/').pop().replace('.json', '');
        }

        return {
            data: { q: rawData.q, opts: allOptions, ans: correctIndex, exp: rawData.exp },
            rank: rankName,
            badge: `🎯 題目: [${displaySubject}]` 
        };
    }
}

async function fillBuffer() {
    if (isFetchingBuffer || quizBuffer.length >= BUFFER_SIZE) return;
    isFetchingBuffer = true;
    try {
        while (quizBuffer.length < BUFFER_SIZE) {
            const question = await fetchOneQuestion();
            quizBuffer.push(question);
        }
    } catch (e) { console.warn("⚠️ 背景補貨失敗", e); } finally { isFetchingBuffer = false; }
}

window.startQuizFlow = async () => {
    switchToPage('page-quiz');
    document.getElementById('quiz-container').classList.add('hidden');
    document.getElementById('feedback-section').classList.add('hidden');
    document.getElementById('btn-giveup').classList.remove('hidden');
    
    const savedQuiz = localStorage.getItem('currentQuiz');
    if (savedQuiz) {
        const q = JSON.parse(savedQuiz);
        renderQuiz(q.data, q.rank, q.badge);
        fillBuffer(); return;
    }
    if (quizBuffer.length > 0) {
        const nextQ = quizBuffer.shift(); localStorage.setItem('currentQuiz', JSON.stringify(nextQ));
        renderQuiz(nextQ.data, nextQ.rank, nextQ.badge); fillBuffer(); 
    } else {
        document.getElementById('quiz-loading').classList.remove('hidden');
        document.getElementById('loading-text').innerText = "正在現場生成題目...";
        try {
            const q = await fetchOneQuestion(); localStorage.setItem('currentQuiz', JSON.stringify(q));
            renderQuiz(q.data, q.rank, q.badge); fillBuffer();
        } catch (e) { console.error(e); alert("出題失敗"); switchToPage('page-home'); }
    }
};

function renderQuiz(data, rank, topic) {
    document.getElementById('quiz-loading').classList.add('hidden');
    document.getElementById('quiz-container').classList.remove('hidden');
    document.getElementById('quiz-badge').innerText = `${topic} | ${rank}`;
    document.getElementById('question-text').innerText = data.q;
    const container = document.getElementById('options-container');
    container.innerHTML = ''; 
    data.opts.forEach((optText, idx) => {
        const btn = document.createElement('button');
        btn.id = `option-btn-${idx}`;
        btn.className = "w-full text-left p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition border border-slate-600 flex items-center gap-3 active:scale-95";
        btn.innerHTML = `<span class="bg-slate-800 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-blue-400 border border-slate-600">${String.fromCharCode(65+idx)}</span><span class="flex-1">${optText}</span>`;
        btn.onclick = () => handleAnswer(idx, data.ans, data.q, data.exp);
        container.appendChild(btn);
    });
}

async function handleAnswer(userIdx, correctIdx, questionText, explanation) {
    const isCorrect = userIdx === correctIdx;
    const opts = document.querySelectorAll('[id^="option-btn-"]');
    opts.forEach((btn, idx) => {
        btn.onclick = null; btn.classList.add('btn-disabled');
        if (idx === correctIdx) btn.classList.add('btn-correct');
        else if (idx === userIdx && !isCorrect) btn.classList.add('btn-wrong');
    });
    const fbSection = document.getElementById('feedback-section');
    const fbTitle = document.getElementById('feedback-title');
    const fbIcon = document.getElementById('feedback-icon');
    const fbText = document.getElementById('feedback-text');
    document.getElementById('btn-giveup').classList.add('hidden');
    fbSection.classList.remove('hidden');

    if(isCorrect) {
        fbTitle.innerText = "回答正確！"; fbTitle.className = "text-xl font-bold text-green-400";
        fbIcon.innerHTML = '<i class="fa-solid fa-circle-check text-green-400"></i>';
        if (navigator.vibrate) navigator.vibrate(50);
    } else {
        fbTitle.innerText = "回答錯誤..."; fbTitle.className = "text-xl font-bold text-red-400";
        fbIcon.innerHTML = '<i class="fa-solid fa-circle-xmark text-red-400"></i>';
        if (navigator.vibrate) navigator.vibrate(200);
    }
    localStorage.removeItem('currentQuiz');
    fbText.innerText = explanation || "AI 未提供詳細解析。";

    let stats = currentUserData.stats;
    stats.totalAnswered++;
    if (isCorrect) {
        stats.totalCorrect++; stats.currentStreak++;
        if (stats.currentStreak > stats.bestStreak) stats.bestStreak = stats.currentStreak;
        stats.currentStars++; stats.totalScore += 10 + (stats.rankLevel * 5) + (stats.currentStreak * 2);
        
        if (stats.currentStars >= 10) {
            if (stats.rankLevel < RANKS.length - 1) { 
                stats.rankLevel++; 
                stats.currentStars = 0; 
                fbTitle.innerText += ` (晉升 ${RANKS[stats.rankLevel]}!)`; 
            } else { 
                stats.currentStars = 10; 
            }
        }
    } else {
        stats.currentStreak = 0; stats.currentStars--;
        if (stats.currentStars < 0) {
            if (stats.rankLevel > 0) { 
                stats.rankLevel--; 
                stats.currentStars = 8; 
                fbTitle.innerText += ` (降級...)`; 
            } else { 
                stats.currentStars = 0; 
            }
        }
    }
    updateDoc(doc(db, "users", auth.currentUser.uid), { stats: stats });
    addDoc(collection(db, "exam_logs"), { uid: auth.currentUser.uid, email: auth.currentUser.email, question: questionText, isCorrect: isCorrect, rankAtTime: RANKS[stats.rankLevel], timestamp: serverTimestamp() }).catch(e => console.error(e));
    updateUIStats(); fillBuffer();
}

window.giveUpQuiz = () => { if(confirm("確定要放棄這題嗎？")) handleAnswer(-1, -2, document.getElementById('question-text').innerText, "您選擇了放棄此題。"); };
window.nextQuestion = () => { startQuizFlow(); };

// ==========================================
//  PvP Battle Logic (Modified to invite random online players)
// ==========================================

window.startBattleMatchmaking = async () => {
    if (!auth.currentUser) {
        alert("請先登入才能進行對戰！");
        return;
    }

    console.log("🚀 開始配對..."); 

    isBattleActive = true;
    switchToPage('page-battle');
    document.getElementById('battle-lobby').classList.remove('hidden');
    document.getElementById('battle-arena').classList.add('hidden');
    document.getElementById('battle-status-text').innerText = "🔍 搜尋對手中...";

    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

    const myPlayerData = { 
        uid: auth.currentUser.uid, 
        name: currentUserData.displayName || "玩家", 
        score: 0, 
        done: false,
        equipped: currentUserData.equipped || { frame: '', avatar: '' } 
    };

    try {
        const q = query(
            collection(db, "rooms"), 
            where("status", "==", "waiting"),
            where("createdAt", ">", twoMinutesAgo), 
            limit(5) 
        );
        
        const snapshot = await getDocs(q);
        let joinedRoomId = null;

        if (!snapshot.empty) {
            const availableDocs = snapshot.docs.filter(d => {
                const data = d.data();
                return data.host && data.host.uid !== auth.currentUser.uid;
            });
            
            if (availableDocs.length > 0) {
                const targetDoc = availableDocs[Math.floor(Math.random() * availableDocs.length)];
                const roomRef = doc(db, "rooms", targetDoc.id);

                try {
                    await runTransaction(db, async (transaction) => {
                        const sfDoc = await transaction.get(roomRef);
                        if (!sfDoc.exists()) throw "Document does not exist!";

                        const data = sfDoc.data();
                        
                        if (data.status === "waiting" && !data.guest) {
                            transaction.update(roomRef, {
                                guest: myPlayerData,
                                status: "ready"
                            });
                            joinedRoomId = targetDoc.id;
                        } else {
                            throw "Room is full"; 
                        }
                    });
                } catch (e) {
                    console.log("配對衝突 (正常現象)，將建立新房間:", e);
                }
            }
        }

        if (joinedRoomId) {
            currentBattleId = joinedRoomId;
            document.getElementById('battle-status-text').innerText = "✅ 配對成功！連接中...";
        } else {
            document.getElementById('battle-status-text').innerText = "👑 建立房間，並邀請線上玩家...";
            const roomRef = await addDoc(collection(db, "rooms"), {
                host: myPlayerData,
                guest: null,
                status: "waiting",
                round: 1,
                createdAt: serverTimestamp() 
            });
            currentBattleId = roomRef.id;

            // 🔥 新增：當自己是房主時，邀請其他線上玩家
            inviteOnlinePlayers(currentBattleId);
        }

        listenToBattleRoom(currentBattleId);

    } catch (e) {
        console.error("配對系統錯誤:", e);
        if (e.message.includes("index")) {
            alert("⚠️ 系統錯誤：Firebase 需要建立索引。\n請按 F12 打開 Console，點擊連結建立 Firestore 複合索引 (status + createdAt)");
        } else {
            alert("配對失敗，請重試：" + e.message);
            leaveBattle();
        }
    }
};

function listenToBattleRoom(roomId) {
    if (battleUnsub) battleUnsub();

    battleUnsub = onSnapshot(doc(db, "rooms", roomId), async (docSnap) => {
        if (!docSnap.exists()) return;
        const room = docSnap.data();
        
        if (!auth.currentUser) return;
        const isHost = room.host.uid === auth.currentUser.uid;

        if (room.status === "ready") {
            document.getElementById('battle-lobby').classList.add('hidden');
            document.getElementById('battle-arena').classList.remove('hidden');
            
            const hostScore = room.host?.score || 0;
            const guestScore = room.guest?.score || 0;

            document.getElementById('p1-score').innerText = isHost ? hostScore : guestScore;
            document.getElementById('p2-score').innerText = isHost ? guestScore : hostScore;
            document.getElementById('battle-round').innerText = room.round;

            const myData = isHost ? room.host : room.guest;
            const oppData = isHost ? room.guest : room.host;

            if (myData) {
                document.getElementById('battle-my-avatar').innerHTML = getAvatarHtml(myData.equipped, "w-16 h-16");
            }
            if (oppData) {
                document.getElementById('battle-opp-avatar').innerHTML = getAvatarHtml(oppData.equipped, "w-16 h-16");
            }

            if (!room.currentQuestion) {
                document.getElementById('battle-loading').classList.remove('hidden');
                document.getElementById('battle-quiz-box').classList.add('hidden');
                
                if (isHost) {
                    generateSharedQuiz(roomId);
                } 
                return; 
            }
            
            document.getElementById('battle-loading').classList.add('hidden');
            document.getElementById('battle-quiz-box').classList.remove('hidden');
            document.getElementById('battle-q-text').innerText = room.currentQuestion.q || "題目讀取錯誤";
            
            const container = document.getElementById('battle-options');
            
            if (myData && !myData.done) {
                document.getElementById('battle-waiting-msg').classList.add('hidden');
                
                container.innerHTML = '';
                const options = Array.isArray(room.currentQuestion.opts) ? room.currentQuestion.opts : [];
                
                if (options.length === 0) {
                    container.innerHTML = '<div class="text-red-400 text-center py-4">選項載入異常</div>';
                } else {
                    options.forEach((opt, idx) => {
                        const btn = document.createElement('button');
                        btn.className = "w-full text-left p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition border border-slate-600 active:scale-95";
                        btn.innerHTML = `<span class="bg-slate-800 w-8 h-8 rounded-full inline-flex items-center justify-center text-sm font-bold text-blue-400 border border-slate-600 mr-3">${String.fromCharCode(65+idx)}</span><span>${opt}</span>`;
                        btn.onclick = () => handleBattleAnswer(roomId, idx, room.currentQuestion.ans, isHost);
                        container.appendChild(btn);
                    });
                }
            } else {
                container.innerHTML = '<div class="text-center text-gray-400 italic py-4 bg-slate-700/30 rounded-lg">✓ 已提交答案</div>';
                document.getElementById('battle-waiting-msg').classList.remove('hidden');
            }

            if (room.host?.done && room.guest?.done) {
                if (isHost) {
                    setTimeout(async () => {
                        if (room.round >= 3) {
                            await updateDoc(doc(db, "rooms", roomId), { status: "finished" });
                        } else {
                            await updateDoc(doc(db, "rooms", roomId), {
                                round: room.round + 1,
                                currentQuestion: null,
                                "host.done": false,
                                "guest.done": false
                            });
                        }
                    }, 2000); 
                }
            }
        }

        if (room.status === "finished") {
            document.getElementById('battle-arena').classList.add('hidden');
            document.getElementById('battle-result').classList.remove('hidden');
            
            const myScore = isHost ? (room.host?.score || 0) : (room.guest?.score || 0);
            const oppScore = isHost ? (room.guest?.score || 0) : (room.host?.score || 0);
            
            const titleEl = document.getElementById('battle-result-title');
            const msgEl = document.getElementById('battle-result-msg');

            if (myScore > oppScore) {
                titleEl.innerText = "🎉 勝利！";
                titleEl.className = "text-3xl font-bold mb-2 text-green-400 animate-bounce";
                msgEl.innerText = `你以 ${myScore} : ${oppScore} 擊敗對手！`;
            } else if (myScore < oppScore) {
                titleEl.innerText = "💔 惜敗...";
                titleEl.className = "text-3xl font-bold mb-2 text-red-400";
                msgEl.innerText = `對手以 ${oppScore} : ${myScore} 獲勝`;
            } else {
                titleEl.innerText = "🤝 平手";
                titleEl.className = "text-3xl font-bold mb-2 text-yellow-400";
                msgEl.innerText = `雙方 ${myScore} : ${oppScore} 平分秋色`;
            }
        }
    });
}

let isGenerating = false;

async function generateSharedQuiz(roomId) {
    if (isGenerating) return;
    
    isGenerating = true; 
    console.log("🚀 房主正在生成題目...");

    try {
        const q = await fetchOneQuestion(); 
        
        await updateDoc(doc(db, "rooms", roomId), {
            currentQuestion: {
                q: q.data.q,
                opts: q.data.opts,
                ans: q.data.ans
            }
        });
        console.log("✅ 題目已生成並同步！");

    } catch (e) {
        console.error("❌ 題目生成失敗:", e);
    } finally {
        isGenerating = false; 
    }
}

async function handleBattleAnswer(roomId, userIdx, correctIdx, isHost) {
    const isCorrect = userIdx === correctIdx;
    const scoreToAdd = isCorrect ? 100 : 0;
    
    if (navigator.vibrate) navigator.vibrate(isCorrect ? 50 : 200);

    const updateField = isHost ? "host" : "guest";
    const roomRef = doc(db, "rooms", roomId);
    const roomSnap = await getDoc(roomRef);
    const room = roomSnap.data();
    const currentScore = isHost ? room.host.score : room.guest.score;

    await updateDoc(roomRef, {
        [`${updateField}.score`]: currentScore + scoreToAdd,
        [`${updateField}.done`]: true
    });
}

window.leaveBattle = async () => {
    if (battleUnsub) {
        battleUnsub();
        battleUnsub = null;
    }
    
    if (currentBattleId) {
        const roomIdToRemove = currentBattleId;
        
        getDoc(doc(db, "rooms", roomIdToRemove)).then(async (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                if (data.status === "waiting" && data.host.uid === auth.currentUser.uid) {
                    await deleteDoc(doc(db, "rooms", roomIdToRemove));
                    console.log("🗑️ 已清理閒置房間:", roomIdToRemove);
                }
            }
        }).catch(err => console.error("清理房間失敗:", err));
    }

    isBattleActive = false;
    currentBattleId = null;
    
    switchToPage('page-home');
};

window.loadUserHistory = async () => {
    const ul = document.getElementById('history-list');
    if(!ul) return; 
    ul.innerHTML = '<li class="text-center py-10"><div class="loader"></div></li>';
    try {
        const q = query(collection(db, "exam_logs"), where("uid", "==", auth.currentUser.uid), orderBy("timestamp", "desc"), limit(20));
        const snap = await getDocs(q);
        ul.innerHTML = '';
        if (snap.empty) { ul.innerHTML = '<li class="text-center text-gray-500 py-4">還沒有答題紀錄</li>'; return; }
        snap.forEach(doc => {
            const log = doc.data();
            const time = log.timestamp ? new Date(log.timestamp.toDate()).toLocaleString() : '--';
            const li = document.createElement('li');
            li.className = `p-3 rounded-lg text-xs border-l-4 mb-2 bg-slate-700/50 ${log.isCorrect ? 'border-green-500' : 'border-red-500'}`;
            li.innerHTML = `
                <div class="flex justify-between mb-1"><span class="text-gray-400 font-mono">${time}</span><span class="${log.isCorrect ? 'text-green-400' : 'text-red-400'} font-bold">${log.isCorrect ? '答對' : '答錯'}</span></div>
                <div class="text-white mb-2 text-sm">${log.question}</div>
                <div class="text-gray-500 text-right">當時段位: ${log.rankAtTime}</div>
            `;
            ul.appendChild(li);
        });
    } catch (e) {
        console.error(e);
        if(e.message.includes("requires an index")) ul.innerHTML = '<li class="text-center text-yellow-400 py-4 p-4">⚠️ 請按 F12 打開 Console 點擊連結建立 Firebase 索引</li>';
        else ul.innerHTML = '<li class="text-center text-red-400 py-4">讀取失敗</li>';
    }
};

window.loadAdminLogs = async () => {
    const ul = document.getElementById('admin-logs-list');
    if(!ul) return; 
    ul.innerHTML = '<li class="text-center py-10"><div class="loader"></div></li>';
    try {
        const q = query(collection(db, "exam_logs"), orderBy("timestamp", "desc"), limit(30));
        const snap = await getDocs(q);
        ul.innerHTML = '';
        snap.forEach(doc => {
            const log = doc.data();
            const time = log.timestamp ? new Date(log.timestamp.toDate()).toLocaleTimeString() : '--:--';
            const li = document.createElement('li');
            li.className = `p-3 rounded-lg text-xs border-l-4 mb-2 bg-slate-700/50 ${log.isCorrect ? 'border-green-500' : 'border-red-500'}`;
            li.innerHTML = `
                <div class="flex justify-between mb-1"><span class="font-bold text-gray-300 truncate w-2/3">${log.email}</span><span class="text-gray-500 font-mono">${time}</span></div>
                <div class="text-gray-400 mb-2 line-clamp-2">${log.question}</div>
                <div class="flex justify-between items-center bg-slate-900/50 p-1 rounded"><span class="text-gray-400">${log.rankAtTime}</span><span class="${log.isCorrect ? 'text-green-400' : 'text-red-400'} font-bold px-2 py-0.5 rounded">${log.isCorrect ? 'CORRECT' : 'WRONG'}</span></div>
            `;
            ul.appendChild(li);
        });
    } catch (e) { ul.innerHTML = '<li class="text-center text-red-400 py-4">讀取失敗 (權限不足)</li>'; }
};

window.loadLeaderboard = async () => {
    const tbody = document.getElementById('leaderboard-body');
    tbody.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-gray-500"><div class="loader"></div></td></tr>';
    try {
        const q = query(
            collection(db, "users"), 
            orderBy("stats.rankLevel", "desc"), 
            orderBy("stats.totalScore", "desc"), 
            limit(10)
        );
        
        const snap = await getDocs(q);
        tbody.innerHTML = '';
        let i = 1;
        snap.forEach(doc => {
            const d = doc.data();
            const isMe = auth.currentUser && d.uid === auth.currentUser.uid;
            const equipped = d.equipped || {};
            const avatarHtml = getAvatarHtml(equipped, "w-8 h-8");

            const row = `
                <tr class="border-b border-slate-700/50 ${isMe ? 'bg-blue-900/20' : ''} hover:bg-slate-700/50 transition">
                    <td class="px-4 py-4 font-bold ${i===1?'text-yellow-400':(i===2?'text-gray-300':(i===3?'text-orange-400':'text-gray-500'))}">${i}</td>
                    <td class="px-4 py-4 flex items-center gap-3">
                        ${avatarHtml}
                        <span class="${isMe ? 'text-blue-300 font-bold' : ''}">${d.displayName}</span>
                    </td>
                    <td class="px-4 py-4 text-right font-mono text-blue-300">
                        ${RANKS[d.stats.rankLevel] || "青銅"} <span class="text-xs text-gray-500 block">${d.stats.totalScore} pts</span>
                    </td>
                </tr>`;
            tbody.innerHTML += row; 
            i++;
        });
    } catch (e) { 
        console.error(e); 
        if(e.message.includes("index")) {
            tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-yellow-400 text-center text-xs">⚠️ 請按 F12 開啟 Console，點擊連結建立複合索引<br>(stats.rankLevel + stats.totalScore)</td></tr>';
        } else {
            tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-red-400 text-center">無法讀取排行榜</td></tr>'; 
        }
    }
};

function renderVisual(type, value, sizeClass = "w-12 h-12") {
    const isImage = value && (value.includes('.') || value.includes('/'));

    if (type === 'frame') {
        if (isImage) {
            return `
            <div class="${sizeClass} rounded-full bg-slate-800 flex items-center justify-center relative" style="overflow: visible !important;">
                <div class="w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-slate-800 relative z-0">
                    <i class="fa-solid fa-user text-gray-500"></i>
                </div>
                <img src="${value}" class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[140%] w-auto object-contain pointer-events-none z-20" style="max-width: none;"> 
            </div>`;
        } else {
            return `<div class="${sizeClass} rounded-full border-2 border-gray-600 ${value} flex items-center justify-center bg-slate-800 relative z-0">
                        <i class="fa-solid fa-user text-gray-500"></i>
                    </div>`;
        }
    } else if (type === 'avatar') {
        return `<div class="${sizeClass} rounded-full overflow-hidden bg-slate-800 border-2 border-slate-600 relative z-10">
                    <img src="${value}" class="avatar-img" onerror="this.style.display='none';this.parentElement.innerHTML='<i class=\'fa-solid fa-image text-red-500\'></i>'">
                </div>`;
    }
    return '';
}

function getAvatarHtml(equipped, sizeClass = "w-10 h-10") {
    const frame = equipped?.frame || '';
    const avatar = equipped?.avatar || '';
    const isFrameImg = frame && (frame.includes('.') || frame.includes('/'));

    const imgContent = avatar 
        ? `<img src="${avatar}" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"> <i class="fa-solid fa-user text-gray-400 absolute hidden"></i>`
        : `<i class="fa-solid fa-user text-gray-400"></i>`;

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

window.updateUserAvatarDisplay = () => {
    if (!currentUserData) return;
    
    const homeSection = document.querySelector('#page-home > div'); 
    
    if (!homeSection) {
        console.warn("⚠️ 警告：找不到首頁 (#page-home > div)，無法渲染頭像。");
        return;
    }

    let homeAvatarContainer = document.getElementById('home-avatar-container');
    if (!homeAvatarContainer) {
        const avatarDiv = document.createElement('div');
        avatarDiv.id = 'home-avatar-container';
        avatarDiv.className = 'absolute top-6 left-6 z-10'; 
        homeSection.appendChild(avatarDiv);
        homeAvatarContainer = avatarDiv;
    }

    homeAvatarContainer.innerHTML = getAvatarHtml(currentUserData.equipped, "w-16 h-16");
};

window.loadAdminData = async () => {
    loadAdminLogs(); 
    
    const listContainer = document.getElementById('admin-product-list');
    listContainer.innerHTML = '<div class="text-center text-gray-500">載入商品中...</div>';

    try {
        const q = query(collection(db, "products"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        
        listContainer.innerHTML = '';
        if(snap.empty) {
            listContainer.innerHTML = '<div class="text-center text-gray-500">尚無商品</div>';
            return;
        }

        snap.forEach(doc => {
            const item = doc.data();
            const div = document.createElement('div');
            div.className = 'admin-item-row cursor-pointer';
            div.onclick = () => editProduct(doc.id, item);

            div.innerHTML = `
                <div class="flex items-center gap-3">
                    ${renderVisual(item.type, item.value, "w-8 h-8")}
                    <div>
                        <div class="font-bold text-white text-sm">${item.name}</div>
                        <div class="text-xs text-gray-400">${item.type} | $${item.price}</div>
                    </div>
                </div>
                <div class="text-blue-400 text-xs"><i class="fa-solid fa-pen"></i> 編輯</div>
            `;
            listContainer.appendChild(div);
        });
    } catch (e) {
        console.error(e);
        listContainer.innerHTML = '<div class="text-red-400 text-center">載入失敗</div>';
    }
};

window.toggleAdminForm = () => {
    const body = document.getElementById('admin-form-body');
    const arrow = document.getElementById('admin-form-arrow');
    
    if (body.classList.contains('hidden')) {
        body.classList.remove('hidden');
        arrow.style.transform = 'rotate(0deg)';
    } else {
        body.classList.add('hidden');
        arrow.style.transform = 'rotate(180deg)';
    }
};

window.openAdminForm = () => {
    const body = document.getElementById('admin-form-body');
    const arrow = document.getElementById('admin-form-arrow');
    body.classList.remove('hidden');
    arrow.style.transform = 'rotate(0deg)';
}

window.editProduct = (id, data) => {
    document.getElementById('admin-edit-id').value = id; 
    document.getElementById('admin-p-name').value = data.name;
    document.getElementById('admin-p-type').value = data.type;
    document.getElementById('admin-p-value').value = data.value;
    document.getElementById('admin-p-price').value = data.price;
    
    document.getElementById('admin-form-title').innerText = "✏️ 編輯商品";
    const saveBtn = document.getElementById('admin-btn-save'); 
    saveBtn.innerText = "更新商品";
    saveBtn.classList.replace('bg-red-600', 'bg-blue-600');
    
    document.getElementById('admin-btn-del').classList.remove('hidden'); 
    toggleAdminInputPlaceholder(); 
    
    openAdminForm();
    document.getElementById('page-admin').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

window.resetAdminForm = () => {
    document.getElementById('admin-edit-id').value = ''; 
    document.getElementById('admin-p-name').value = '';
    document.getElementById('admin-p-value').value = '';
    document.getElementById('admin-p-price').value = '';
    
    document.getElementById('admin-form-title').innerText = "➕ 上架新商品";
    const saveBtn = document.getElementById('admin-btn-save');
    saveBtn.innerText = "上架商品";
    saveBtn.classList.replace('bg-blue-600', 'bg-red-600');
    
    document.getElementById('admin-btn-del').classList.add('hidden'); 
    toggleAdminInputPlaceholder(); 
    
    openAdminForm();
};

window.saveProduct = async () => {
    if (!currentUserData || !currentUserData.isAdmin) {
        return alert("權限不足！請去 Firebase Console 將 isAdmin 設為 true");
    }

    const docId = document.getElementById('admin-edit-id').value; 
    const name = document.getElementById('admin-p-name').value;
    const type = document.getElementById('admin-p-type').value;
    const value = document.getElementById('admin-p-value').value;
    const priceRaw = document.getElementById('admin-p-price').value;
    const price = parseInt(priceRaw);

    if (!name || !value || isNaN(price)) {
        return alert("請填寫完整資訊 (名稱、數值、價格)");
    }

    const productData = { name, type, value, price, updatedAt: serverTimestamp() };
    const btn = document.getElementById('admin-btn-save');
    btn.innerText = "處理中...";
    btn.disabled = true;

    try {
        if (docId) {
            await updateDoc(doc(db, "products", docId), productData);
            alert(`商品「${name}」更新成功！`);
        } else {
            productData.createdAt = serverTimestamp();
            await addDoc(collection(db, "products"), productData);
            alert(`商品「${name}」上架成功！`);
        }
        resetAdminForm();
        loadAdminData(); 
    } catch (e) {
        console.error("Save Error:", e);
        alert("操作失敗，請查看 Console (F12)");
    } finally {
        btn.disabled = false;
        if(!docId) btn.innerText = "上架商品";
        else btn.innerText = "更新商品";
    }
};

window.deleteProduct = async () => {
    const docId = document.getElementById('admin-edit-id').value;
    if (!docId) return;
    if (!confirm("確定要下架此商品嗎？")) return;

    try {
        await deleteDoc(doc(db, "products", docId));
        alert("刪除成功");
        resetAdminForm();
        loadAdminData();
    } catch (e) {
        console.error(e);
        alert("刪除失敗");
    }
};

window.toggleAdminInputPlaceholder = async () => {
    const type = document.getElementById('admin-p-type').value;
    const input = document.getElementById('admin-p-value');
    const hint = document.getElementById('admin-hint');
    const selectorDiv = document.getElementById('admin-asset-selector');

    selectorDiv.classList.remove('hidden');

    if (type === 'frame') {
        input.placeholder = "CSS 類名 (frame-gold) 或 圖片路徑 (assets/frame.png)";
        hint.innerText = "支援 CSS 類名 (需寫在 style.css) 或 圖片路徑";
    } else {
        input.placeholder = "圖片路徑 (例: assets/avatar1.png)";
        hint.innerText = "手動輸入或從上方選擇未使用的圖片";
    }
    
    await loadUnusedAssets();
};

async function loadUnusedAssets() {
    const select = document.getElementById('admin-asset-select');
    select.innerHTML = '<option value="">-- 掃描中... --</option>';

    try {
        const res = await fetch('/api/assets');
        const data = await res.json();
        const allImages = data.images || [];

        const q = query(collection(db, "products"));
        const snap = await getDocs(q);
        const usedImages = new Set();
        
        snap.forEach(doc => {
            const item = doc.data();
            if (item.value && (item.value.includes('.') || item.value.includes('/'))) {
                usedImages.add(item.value);
            }
        });

        const unusedImages = allImages.filter(img => !usedImages.has(img));

        select.innerHTML = '<option value="">-- 請選擇一張圖片 --</option>';
        if (unusedImages.length === 0) {
            const opt = document.createElement('option');
            opt.innerText = "(沒有可用的新圖片)";
            opt.disabled = true;
            select.appendChild(opt);
        } else {
            unusedImages.forEach(img => {
                const opt = document.createElement('option');
                opt.value = img;
                opt.innerText = img.replace('assets/', '');
                select.appendChild(opt);
            });
        }
    } catch (e) {
        console.error(e);
        select.innerHTML = '<option value="">讀取失敗</option>';
    }
}

window.selectAdminImage = (value) => {
    if (!value) return;
    document.getElementById('admin-p-value').value = value;
    const preview = document.getElementById('admin-asset-preview');
    preview.src = value;
    preview.classList.remove('hidden');
};

window.renderInventory = async (filterType = 'frame') => {
    const container = document.getElementById('settings-inventory-grid'); 
    if (!container) return; 

    const userInv = currentUserData.inventory || [];
    
    container.innerHTML = '<div class="col-span-4 text-center text-gray-500 py-4"><div class="loader"></div></div>';

    if (userInv.length === 0) {
        container.innerHTML = '<div class="col-span-4 text-center text-gray-500 py-4 text-xs">背包空空的，去商店逛逛吧！</div>';
        return;
    }

    const q = query(collection(db, "products"));
    const snap = await getDocs(q);
    const allProducts = {};
    snap.forEach(d => allProducts[d.id] = d.data());

    container.innerHTML = '';
    let count = 0;

    userInv.forEach(pid => {
        const item = allProducts[pid];
        if (!item) return; 
        
        const isEquipped = (currentUserData.equipped[item.type] === item.value);
        const div = document.createElement('div');
        div.className = `inventory-item ${isEquipped ? 'selected' : ''}`;
        div.onclick = () => equipItem(item.type, pid, item.value); 
        
        const badge = isEquipped ? '<div class="absolute top-0 right-0 bg-green-500 text-[10px] px-1 rounded-bl">E</div>' : '';

        div.innerHTML = `
            ${renderVisual(item.type, item.value, "w-10 h-10")}
            ${badge}
        `;
        container.appendChild(div);
        count++;
    });

    if (count === 0) {
        container.innerHTML = `<div class="col-span-4 text-center text-gray-500 py-4 text-xs">背包裡沒有物品</div>`;
    }
};

window.loadStoreItems = async () => {
    const grid = document.getElementById('store-grid');
    document.getElementById('store-user-points').innerText = currentUserData.stats.totalScore;
    
    try {
        const q = query(collection(db, "products"), orderBy("price", "asc"));
        const snap = await getDocs(q);
        grid.innerHTML = '';
        
        if (snap.empty) {
            grid.innerHTML = '<div class="col-span-2 text-center text-gray-500">商店目前空空如也...</div>';
            return;
        }

        snap.forEach(doc => {
            const item = doc.data();
            const pid = doc.id;
            const isOwned = currentUserData.inventory && currentUserData.inventory.includes(pid);
            const isEquipped = (currentUserData.equipped[item.type] === item.value);
            
            let visual = renderVisual(item.type, item.value, "w-14 h-14");

            let btnAction = '';
            if (isEquipped) {
                btnAction = `<button class="w-full mt-2 bg-green-600 text-white text-xs py-1.5 rounded cursor-default opacity-50">已裝備</button>`;
            } else if (isOwned) {
                btnAction = `<button onclick="equipItem('${item.type}', '${pid}', '${item.value}')" class="w-full mt-2 bg-slate-600 hover:bg-slate-500 text-white text-xs py-1.5 rounded">裝備</button>`;
            } else {
                btnAction = `<button onclick="buyItem('${pid}', ${item.price})" class="w-full mt-2 bg-blue-600 hover:bg-blue-500 text-white text-xs py-1.5 rounded flex items-center justify-center gap-1"><i class="fa-solid fa-coins text-yellow-300"></i> ${item.price}</button>`;
            }

            const card = document.createElement('div');
            card.className = `store-card ${item.type}-item relative`;
            card.innerHTML = `
                ${isOwned ? '<div class="absolute top-2 right-2 text-green-400 text-xs"><i class="fa-solid fa-check"></i></div>' : ''}
                ${visual}
                <div class="text-sm font-bold text-white mt-2">${item.name}</div>
                <div class="text-xs text-gray-400 mb-1">${item.type === 'frame' ? '相框' : '頭像'}</div>
                ${btnAction}
            `;
            grid.appendChild(card);
        });
    } catch (e) { console.error(e); }
};

window.buyItem = async (pid, price) => {
    if (!currentUserData || !currentUserData.stats) return alert("資料載入中，請稍後");

    if (currentUserData.stats.totalScore < price) {
        return alert(`積分不足！你需要 ${price} 分，目前只有 ${currentUserData.stats.totalScore} 分`);
    }

    if (!confirm(`確定要花費 ${price} 積分購買嗎？`)) return;

    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        let newInventory = currentUserData.inventory || [];
        
        if(newInventory.includes(pid)) return alert("你已經擁有此商品了");
        
        newInventory.push(pid);
        const newScore = currentUserData.stats.totalScore - price;

        currentUserData.stats.totalScore = newScore;
        currentUserData.inventory = newInventory;

        await updateDoc(userRef, {
            "stats.totalScore": newScore,
            "inventory": newInventory
        });

        alert("購買成功！");
        updateUIStats();
        loadStoreItems();
        if(document.getElementById('page-settings').classList.contains('active-page')) {
            renderInventory();
        }
    } catch(e) {
        console.error(e);
        alert("購買失敗: " + e.message);
    }
};

window.equipItem = async (type, pid, value) => {
    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        if (type === 'frame') currentUserData.equipped.frame = value;
        if (type === 'avatar') currentUserData.equipped.avatar = value;

        await updateDoc(userRef, { "equipped": currentUserData.equipped });

        updateUserAvatarDisplay();
        loadStoreItems(); 
        if(document.getElementById('page-settings').classList.contains('active-page')) {
            renderInventory();
        }
    } catch (e) {
        console.error(e);
        alert("裝備失敗");
    }
};

window.filterStore = (type, btnElement) => {
    const items = document.querySelectorAll('.store-card');
    items.forEach(item => {
        if (type === 'all') {
            item.classList.remove('hidden');
        } else {
            if (item.classList.contains(`${type}-item`)) {
                item.classList.remove('hidden');
            } else {
                item.classList.add('hidden');
            }
        }
    });

    if (btnElement) {
        document.querySelectorAll('.store-tab').forEach(tab => {
            tab.className = 'store-tab flex-1 py-2 text-xs font-bold rounded-lg transition-all bg-slate-800 text-gray-400 hover:bg-slate-700';
            const icon = tab.querySelector('i');
            if(icon) icon.classList.replace('fa-solid', 'fa-regular');
        });
        
        btnElement.className = 'store-tab active-tab flex-1 py-2 text-xs font-bold rounded-lg transition-all bg-pink-600 text-white shadow-lg shadow-pink-900/50';
        
        const activeIcon = btnElement.querySelector('i');
        if(activeIcon) activeIcon.classList.replace('fa-regular', 'fa-solid');
    }
};

function checkAdminRole(isAdmin) {
    const navGrid = document.getElementById('nav-grid');
    if (isAdmin && !document.getElementById('btn-admin-nav')) {
        // 🔥 修改：5 個預設按鈕，加管理變 6 個
        navGrid.classList.remove('grid-cols-5'); 
        navGrid.classList.add('grid-cols-6');
        const btn = document.createElement('button');
        btn.id = "btn-admin-nav"; btn.dataset.target = "page-admin";
        btn.className = "flex flex-col items-center justify-center hover:bg-white/5 text-gray-400 hover:text-red-400 transition group";
        btn.onclick = () => { loadAdminLogs(); switchToPage('page-admin'); };
        btn.innerHTML = `<i class="fa-solid fa-user-shield mb-1 text-lg group-hover:text-red-400 transition-colors"></i><span class="text-[10px]">管理</span>`;
        navGrid.appendChild(btn);
    }
}

// 1. 注入通知容器 (Toasts)
function injectNotificationContainer() {
    if (document.getElementById('notification-container')) return;
    const div = document.createElement('div');
    div.id = 'notification-container';
    div.className = "fixed top-4 right-4 z-[100] flex flex-col gap-2 w-72 pointer-events-none"; // pointer-events-none 讓點擊穿透，卡片本身再開
    document.body.appendChild(div);
}

// 2. 監聽通知
function listenForNotifications() {
    if (notificationUnsub) notificationUnsub();
    
    // 監聽 users/{uid}/notifications 子集合
    const q = query(collection(db, "users", auth.currentUser.uid, "notifications"), orderBy("timestamp", "desc"), limit(5));
    
    notificationUnsub = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const data = change.doc.data();
                // 只顯示 1 分鐘內的邀請，避免舊通知一直跳
                const now = new Date();
                const inviteTime = data.timestamp ? data.timestamp.toDate() : new Date(0);
                if ((now - inviteTime) < 60 * 1000) {
                    showNotification(change.doc.id, data);
                }
            }
        });
    });
}

// 3. 顯示通知卡片
function showNotification(docId, data) {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    
    // UI 設計
    toast.className = "bg-slate-800/90 backdrop-blur-md border border-yellow-500/50 p-4 rounded-xl shadow-2xl transform translate-x-full transition-all duration-300 pointer-events-auto flex flex-col gap-2";
    toast.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="bg-yellow-500/20 p-2 rounded-full text-yellow-400">
                <i class="fa-solid fa-swords"></i>
            </div>
            <div>
                <h4 class="font-bold text-white text-sm">對戰邀請！</h4>
                <p class="text-xs text-gray-300 mt-1">玩家 <span class="text-yellow-300 font-bold">${data.hostName}</span> 邀請你一決勝負！</p>
            </div>
        </div>
        <div class="flex gap-2 mt-1">
            <button onclick="rejectInvite('${docId}', this)" class="flex-1 bg-slate-700 hover:bg-slate-600 text-xs py-2 rounded text-gray-300 transition">忽略</button>
            <button onclick="acceptInvite('${data.roomId}', '${docId}', this)" class="flex-1 bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500 text-xs py-2 rounded text-white font-bold shadow-lg transition animate-pulse">
                接受挑戰 ⚔️
            </button>
        </div>
    `;

    container.appendChild(toast);
    
    // 進場動畫
    requestAnimationFrame(() => {
        toast.classList.remove('translate-x-full');
    });

    // 10秒後自動消失
    setTimeout(() => {
        dismissToast(toast, docId);
    }, 10000);
}

// 4. 忽略邀請
window.rejectInvite = async (docId, btn) => {
    const toast = btn.closest('div').parentElement; // 找到外層 div
    dismissToast(toast, docId);
};

// 5. 接受邀請 (加入指定房間)
window.acceptInvite = async (roomId, docId, btn) => {
    const toast = btn.closest('div').parentElement;
    dismissToast(toast, docId); // 先關閉通知
    
    // 加入指定房間邏輯
    await joinBattleRoom(roomId);
};

// 輔助：移除 Toast 並刪除資料庫紀錄
async function dismissToast(element, docId) {
    element.classList.add('translate-x-full', 'opacity-0');
    setTimeout(() => {
        if(element.parentElement) element.parentElement.removeChild(element);
    }, 300);

    // 刪除 Firestore 中的通知文件，避免重複顯示
    try {
        await deleteDoc(doc(db, "users", auth.currentUser.uid, "notifications", docId));
    } catch(e) { console.error("刪除通知失敗", e); }
}

// 🔥 新增：隨機邀請線上玩家 (由建立房間者呼叫)
async function inviteOnlinePlayers(roomId) {
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        
        // 1. 搜尋線上玩家
        // 注意：這需要複合索引 (lastActive + uid 雖然不能直接混用，但可以用 client side filter)
        const q = query(
            collection(db, "users"), 
            where("lastActive", ">", fiveMinutesAgo),
            limit(20) // 限制抓取數量，避免讀取太多
        );
        
        const snapshot = await getDocs(q);
        
        // 2. 排除自己，並隨機選 3 人
        const candidates = snapshot.docs
            .filter(d => d.id !== auth.currentUser.uid)
            .map(d => d.id);
            
        if (candidates.length === 0) return;

        // 洗牌並取前 3 個
        const selectedIds = shuffleArray(candidates).slice(0, 3);
        
        console.log(`正在邀請 ${selectedIds.length} 位玩家...`);

        // 3. 發送邀請 (寫入對方的 notifications)
        const batch = [];
        selectedIds.forEach(targetUid => {
            const ref = collection(db, "users", targetUid, "notifications");
            addDoc(ref, {
                type: "battle_invite",
                roomId: roomId,
                hostName: currentUserData.displayName || "神秘玩家",
                timestamp: serverTimestamp()
            });
        });

    } catch (e) {
        console.error("邀請發送失敗 (可能是索引問題或權限):", e);
    }
}

// 🔥 新增：加入指定房間 (供接受邀請使用)
async function joinBattleRoom(roomId) {
    if (isBattleActive) return alert("你已經在戰鬥或配對中了！");
    
    // 檢查房間是否存在
    const roomRef = doc(db, "rooms", roomId);
    const roomSnap = await getDoc(roomRef);
    
    if (!roomSnap.exists()) return alert("該房間已不存在");
    const roomData = roomSnap.data();
    
    if (roomData.status !== "waiting" || roomData.guest) {
        return alert("該房間已滿或遊戲已開始");
    }

    // 準備加入
    const myPlayerData = { 
        uid: auth.currentUser.uid, 
        name: currentUserData.displayName, 
        score: 0, 
        done: false,
        equipped: currentUserData.equipped || { frame: '', avatar: '' } 
    };

    isBattleActive = true;
    switchToPage('page-battle');
    document.getElementById('battle-lobby').classList.add('hidden');
    document.getElementById('battle-arena').classList.remove('hidden');
    
    try {
        await updateDoc(roomRef, {
            guest: myPlayerData,
            status: "ready"
        });
        currentBattleId = roomId;
        listenToBattleRoom(roomId);
    } catch (e) {
        console.error(e);
        alert("加入房間失敗");
        leaveBattle();
    }
}


// ==========================================
//  🔥 社交系統 (UI & 上線狀態)
// ==========================================

function injectSocialUI() {
    if (document.getElementById('btn-social-nav')) return;

    const navGrid = document.getElementById('nav-grid');
    navGrid.classList.remove('grid-cols-5');
    navGrid.classList.add('grid-cols-6');

    const btn = document.createElement('button');
    btn.id = "btn-social-nav";
    btn.setAttribute("onclick", "switchToPage('page-social')");
    btn.dataset.target = "page-social";
    btn.className = "flex flex-col items-center justify-center hover:bg-white/5 text-gray-400 hover:text-white transition group";
    btn.innerHTML = `<i class="fa-solid fa-users mb-1 text-lg group-hover:text-cyan-400 transition-colors"></i><span class="text-[10px]">社交</span>`;
    
    const settingsBtn = navGrid.lastElementChild;
    navGrid.insertBefore(btn, settingsBtn);

    const main = document.querySelector('main');
    const pageSocial = document.createElement('div');
    pageSocial.id = "page-social";
    pageSocial.className = "page-section hidden";
    pageSocial.innerHTML = `
        <div class="sticky top-0 bg-slate-900/95 backdrop-blur-sm z-20 pb-4 border-b border-slate-800 mb-4">
            <h2 class="text-2xl font-bold text-cyan-400 flex items-center gap-2">
                <i class="fa-solid fa-users"></i> 好友列表
            </h2>
            <div class="mt-4 bg-slate-800 p-4 rounded-xl border border-slate-700">
                <div class="text-xs text-gray-400 mb-1">我的好友代碼</div>
                <div class="flex justify-between items-center">
                    <span class="text-2xl font-mono font-bold text-white tracking-widest" id="my-friend-code">...</span>
                    <button onclick="copyFriendCode()" class="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-white transition">複製</button>
                </div>
            </div>
            <div class="flex gap-2 mt-3">
                <input type="text" id="input-friend-code" placeholder="輸入對方代碼 (不分大小寫)" class="flex-1 bg-slate-900 border border-slate-600 text-white rounded-lg p-3 outline-none focus:border-cyan-500 uppercase">
                <button onclick="addFriend()" class="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white px-4 rounded-lg font-bold shadow-lg">
                    <i class="fa-solid fa-user-plus"></i>
                </button>
            </div>
        </div>
        <div id="friend-list-container" class="space-y-3 pb-20">
            <div class="text-center text-gray-500 py-10">載入中...</div>
        </div>
    `;
    main.appendChild(pageSocial);
}

function startPresenceSystem() {
    if (presenceInterval) clearInterval(presenceInterval);
    
    const updatePresence = async () => {
        if (!auth.currentUser) return;
        try {
            const userRef = doc(db, "users", auth.currentUser.uid);
            await updateDoc(userRef, {
                lastActive: serverTimestamp() 
            });
        } catch (e) { console.error("Presence update failed", e); }
    };

    updatePresence();
    presenceInterval = setInterval(updatePresence, 60 * 1000);
}

window.copyFriendCode = () => {
    const code = document.getElementById('my-friend-code').innerText;
    navigator.clipboard.writeText(code).then(() => alert("代碼已複製！"));
};

window.addFriend = async () => {
    const input = document.getElementById('input-friend-code');
    const targetCode = input.value.trim().toUpperCase();
    
    if (!targetCode) return alert("請輸入代碼");
    if (targetCode === currentUserData.friendCode) return alert("不能加自己為好友 XD");

    const btn = document.querySelector('button[onclick="addFriend()"]');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
        const q = query(collection(db, "users"), where("friendCode", "==", targetCode));
        const snap = await getDocs(q);

        if (snap.empty) {
            alert("找不到此代碼，請確認是否輸入正確。");
            return;
        }

        const targetUserDoc = snap.docs[0];
        const targetUserId = targetUserDoc.id;
        const targetUserData = targetUserDoc.data();

        if (currentUserData.friends.includes(targetUserId)) {
            alert("你們已經是好友囉！");
            return;
        }

        await runTransaction(db, async (transaction) => {
            const myRef = doc(db, "users", auth.currentUser.uid);
            const friendRef = doc(db, "users", targetUserId);

            transaction.update(myRef, { friends: arrayUnion(targetUserId) });
            transaction.update(friendRef, { friends: arrayUnion(auth.currentUser.uid) });
        });

        currentUserData.friends.push(targetUserId);
        
        alert(`成功添加 ${targetUserData.displayName} 為好友！`);
        input.value = "";
        loadFriendList();

    } catch (e) {
        console.error(e);
        alert("新增失敗：" + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus"></i>';
    }
};

window.loadFriendList = async () => {
    const container = document.getElementById('friend-list-container');
    const myCodeEl = document.getElementById('my-friend-code');
    
    if (currentUserData && currentUserData.friendCode) {
        myCodeEl.innerText = currentUserData.friendCode;
    }

    if (!currentUserData.friends || currentUserData.friends.length === 0) {
        container.innerHTML = `
            <div class="text-center py-10 opacity-50">
                <i class="fa-solid fa-user-group text-4xl mb-3"></i>
                <p>還沒有好友...</p>
                <p class="text-xs mt-1">快把代碼分享給朋友吧！</p>
            </div>`;
        return;
    }

    container.innerHTML = '<div class="loader"></div>';

    try {
        const promises = currentUserData.friends.map(uid => getDoc(doc(db, "users", uid)));
        const docs = await Promise.all(promises);

        container.innerHTML = '';
        
        docs.forEach(d => {
            if (!d.exists()) return;
            const fData = d.data();
            
            const now = new Date();
            const lastActive = fData.lastActive ? fData.lastActive.toDate() : new Date(0);
            const diffMinutes = (now - lastActive) / 1000 / 60;
            const isOnline = diffMinutes < 5;

            const statusHtml = isOnline 
                ? `<span class="text-green-400 text-xs flex items-center gap-1"><div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div> 線上</span>`
                : `<span class="text-gray-500 text-xs">離線 (${getTimeAgo(lastActive)})</span>`;

            const div = document.createElement('div');
            div.className = "bg-slate-800/50 p-3 rounded-xl border border-slate-700 flex items-center gap-3";
            div.innerHTML = `
                ${getAvatarHtml(fData.equipped, "w-12 h-12")}
                <div class="flex-1">
                    <div class="flex justify-between items-center">
                        <span class="font-bold text-white">${fData.displayName}</span>
                        <span class="text-xs text-yellow-500 font-mono">${RANKS[Math.min(fData.stats?.rankLevel || 0, 4)].split(' ')[1]}</span>
                    </div>
                    <div class="flex justify-between items-center mt-1">
                        ${statusHtml}
                        <span class="text-[10px] text-gray-500">積分: ${fData.stats?.totalScore || 0}</span>
                    </div>
                </div>
            `;
            container.appendChild(div);
        });

    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="text-red-400 text-center">載入失敗</div>';
    }
};

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds > 86400) return Math.floor(seconds/86400) + "天前";
    if (seconds > 3600) return Math.floor(seconds/3600) + "小時前";
    if (seconds > 60) return Math.floor(seconds/60) + "分鐘前";
    return "剛剛";
}
