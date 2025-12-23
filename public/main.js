import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp, where, onSnapshot, runTransaction, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- 1. Firebase 設定 ---
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

// --- 2. 無極限段位設定 ---
const RANK_SYSTEM = [
    { name: "🥉 青銅", threshold: 0 },       // 0
    { name: "🥈 白銀", threshold: 1000 },    // 1000
    { name: "🥇 黃金", threshold: 2500 },    // 2500
    { name: "💎 鉑金", threshold: 5000 },    // 5000
    { name: "🔷 鑽石", threshold: 9000 },    // 9000
    { name: "🌠 星耀", threshold: 15000 },   // 15000
    { name: "🌌 銀河", threshold: 25000 },   // 25000
    { name: "👑 傳說", threshold: 40000 },   // 40000
    { name: "⚛️ 永恆", threshold: 60000 }    // 60000+ (無上限)
];
const RANKS = RANK_SYSTEM.map(r => r.name);

// --- 3. 全域變數 ---
let quizBuffer = [];
const BUFFER_SIZE = 1; 
let isFetchingBuffer = false; 
let battleUnsub = null; 
let currentBattleId = null;
let isBattleActive = false; 
let currentBankData = null; 
let presenceInterval = null;
let notificationUnsub = null;
let allBankFiles = [];

// --- 4. 認證與初始化 ---
window.googleLogin = () => { signInWithPopup(auth, provider).catch((error) => showToastMsg("登入失敗: " + error.code, "error")); };
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

        injectSocialUI();
        injectNotificationContainer();

        const userRef = doc(db, "users", user.uid);
        try {
            const docSnap = await getDoc(userRef);
            if (docSnap.exists()) {
                currentUserData = docSnap.data();
                // 資料補丁
                if (!currentUserData.inventory) currentUserData.inventory = [];
                if (!currentUserData.equipped) currentUserData.equipped = { frame: '', avatar: '' };
                if (!currentUserData.friends) currentUserData.friends = [];
                if (!currentUserData.friendCode) {
                    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
                    await updateDoc(userRef, { friendCode: code });
                    currentUserData.friendCode = code;
                }
                recalcUserRank(); 
            } else {
                const code = Math.random().toString(36).substring(2, 8).toUpperCase();
                currentUserData = {
                    uid: user.uid, displayName: user.displayName, email: user.email,
                    profile: { educationLevel: "", strongSubjects: "", weakSubjects: "" },
                    inventory: [], equipped: { frame: '', avatar: '' }, 
                    stats: { rankLevel: 0, currentStars: 0, totalScore: 0, currentStreak: 0, bestStreak: 0, totalCorrect: 0, totalAnswered: 0 },
                    friends: [], friendCode: code, isAdmin: false
                };
                await setDoc(userRef, currentUserData);
            }

            startPresenceSystem();
            listenForNotifications();
            updateUserAvatarDisplay();
            updateSettingsInputs();
            checkAdminRole(currentUserData.isAdmin);
            updateUIStats();

            if (!currentUserData.profile.educationLevel) {
                switchToPage('page-onboarding'); 
                document.getElementById('bottom-nav').classList.add('hidden'); 
            } else {
                switchToPage('page-home');
                fillBuffer(); 
            }
        } catch (error) { 
            showToastMsg("資料讀取錯誤: " + error.message, "error"); 
        }
    } else {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('bottom-nav').classList.add('hidden');
    }
});

// --- 5. 核心邏輯：段位計算 ---
function recalcUserRank() {
    if (!currentUserData || !currentUserData.stats) return;
    
    const score = currentUserData.stats.totalScore || 0;
    let newRankLevel = 0;

    for (let i = RANK_SYSTEM.length - 1; i >= 0; i--) {
        if (score >= RANK_SYSTEM[i].threshold) {
            newRankLevel = i;
            break;
        }
    }

    let stars = 0;
    const currentThreshold = RANK_SYSTEM[newRankLevel].threshold;
    
    if (newRankLevel < RANK_SYSTEM.length - 1) {
        const nextThreshold = RANK_SYSTEM[newRankLevel + 1].threshold;
        const gap = nextThreshold - currentThreshold;
        const progress = score - currentThreshold;
        stars = Math.floor((progress / gap) * 10);
    } else {
        const progress = score - currentThreshold;
        stars = Math.floor(progress / 2000); 
    }

    currentUserData.stats.rankLevel = newRankLevel;
    currentUserData.stats.currentStars = stars;

    updateDoc(doc(db, "users", auth.currentUser.uid), { 
        "stats.rankLevel": newRankLevel,
        "stats.currentStars": stars
    }).catch(e => showToastMsg("段位同步失敗", "error"));
}

// --- 6. 頁面導航與 UI ---
window.switchToPage = (pageId) => {
    if (isBattleActive && pageId !== 'page-battle') {
        showToastMsg("⚔️ 戰鬥中無法切換頁面！", "error");
        return;
    }
    document.querySelectorAll('.page-section').forEach(el => { el.classList.remove('active-page', 'hidden'); el.classList.add('hidden'); });
    const target = document.getElementById(pageId);
    if(target) { target.classList.remove('hidden'); target.classList.add('active-page'); }
    
    document.querySelectorAll('#nav-grid button').forEach(btn => {
        if(isBattleActive) btn.classList.add('nav-locked');
        else btn.classList.remove('nav-locked');

        if (btn.dataset.target === pageId) { 
            btn.classList.add('text-white'); btn.classList.remove('text-gray-400');
            if (pageId === 'page-social') btn.querySelector('i').className = "fa-solid fa-users mb-1 text-lg text-cyan-400 transition-colors";
        } else { 
            btn.classList.remove('text-white'); btn.classList.add('text-gray-400'); 
            if (btn.dataset.target === 'page-social') btn.querySelector('i').className = "fa-solid fa-users mb-1 text-lg group-hover:text-cyan-400 transition-colors";
        }
    });
    
    if (pageId === 'page-settings') { renderInventory(); loadUserHistory(); }
    if (pageId === 'page-admin') loadAdminProducts(); 
    if (pageId === 'page-social') loadFriendList();
};

function updateUIStats() {
    if(!currentUserData) return;
    const stats = currentUserData.stats;
    
    const rankColors = [
        "text-orange-600", "text-gray-300", "text-yellow-400", 
        "text-transparent bg-clip-text bg-gradient-to-r from-cyan-200 to-blue-400", "text-blue-600",
        "text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-500 to-red-500", 
        "text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-indigo-400 animate-pulse", 
        "text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 via-yellow-500 to-yellow-200 drop-shadow-lg", 
        "text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-green-500 to-blue-500 animate-[pulse_0.5s_infinite]"
    ];

    const rankIndex = Math.min(stats.rankLevel || 0, RANKS.length - 1);
    const rankEl = document.getElementById('display-rank');
    rankEl.innerText = RANKS[rankIndex] || "未知";
    rankEl.className = `text-5xl font-black mb-2 ${rankColors[rankIndex] || "text-white"}`;

    document.getElementById('display-stars').innerText = stats.currentStars || 0;
    document.getElementById('display-score').innerText = stats.totalScore || 0;
    document.getElementById('display-streak').innerText = stats.currentStreak || 0;
    document.getElementById('display-best-streak').innerText = stats.bestStreak || 0;
    
    const accuracy = stats.totalAnswered > 0 ? ((stats.totalCorrect / stats.totalAnswered) * 100).toFixed(1) : "0.0";
    document.getElementById('display-accuracy').innerText = accuracy + "%";
    
    let progressPercent = 0;
    if (rankIndex >= RANKS.length - 1) {
        progressPercent = 100;
        document.getElementById('display-stars').innerHTML = `<i class="fa-solid fa-infinity"></i> ${stats.currentStars}`; 
    } else {
        progressPercent = (stats.currentStars / 10) * 100;
    }
    
    setTimeout(() => { document.getElementById('progress-bar').style.width = `${progressPercent}%`; }, 100);
}

// --- 7. 答題邏輯與計分 ---
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

    const oldRank = currentUserData.stats.rankLevel;

    if(isCorrect) {
        fbTitle.innerText = "回答正確！"; fbTitle.className = "text-xl font-bold text-green-400";
        fbIcon.innerHTML = '<i class="fa-solid fa-circle-check text-green-400"></i>';
        if (navigator.vibrate) navigator.vibrate(50);
        
        currentUserData.stats.totalCorrect++; 
        currentUserData.stats.currentStreak++;
        if (currentUserData.stats.currentStreak > currentUserData.stats.bestStreak) currentUserData.stats.bestStreak = currentUserData.stats.currentStreak;
        
        // 連勝獎勵
        let basePoints = 100 + (currentUserData.stats.rankLevel * 10);
        let streakBonus = currentUserData.stats.currentStreak >= 3 ? 50 : 0;
        currentUserData.stats.totalScore += (basePoints + streakBonus);

        if(streakBonus > 0) showToastMsg(`🔥 連勝獎勵！ +${streakBonus} 分`);

    } else {
        fbTitle.innerText = "回答錯誤..."; fbTitle.className = "text-xl font-bold text-red-400";
        fbIcon.innerHTML = '<i class="fa-solid fa-circle-xmark text-red-400"></i>';
        if (navigator.vibrate) navigator.vibrate(200);
        
        currentUserData.stats.currentStreak = 0; 
    }
    
    currentUserData.stats.totalAnswered++;
    recalcUserRank();

    if (currentUserData.stats.rankLevel > oldRank) {
        fbTitle.innerText += ` (晉升 ${RANKS[currentUserData.stats.rankLevel]}!)`; 
        showToastMsg(`🎉 恭喜晉升 ${RANKS[currentUserData.stats.rankLevel]}！`);
    }

    updateDoc(doc(db, "users", auth.currentUser.uid), { stats: currentUserData.stats });
    
    addDoc(collection(db, "exam_logs"), { 
        uid: auth.currentUser.uid, 
        email: auth.currentUser.email, 
        question: questionText, 
        isCorrect: isCorrect, 
        rankAtTime: RANKS[currentUserData.stats.rankLevel], 
        timestamp: serverTimestamp() 
    }).catch(e => {});
    
    updateUIStats(); 
    fillBuffer();
}

window.giveUpQuiz = () => { if(confirm("確定要放棄這題嗎？")) handleAnswer(-1, -2, document.getElementById('question-text').innerText, "您選擇了放棄此題。"); };
window.nextQuestion = () => { startQuizFlow(); };

// --- 8. 社交系統 (好友邀請 & 上線狀態) ---
function injectSocialUI() {
    if (document.getElementById('btn-social-nav')) return;
    const navGrid = document.getElementById('nav-grid');
    navGrid.classList.remove('grid-cols-5'); navGrid.classList.add('grid-cols-6');

    const btn = document.createElement('button');
    btn.id = "btn-social-nav"; btn.setAttribute("onclick", "switchToPage('page-social')"); btn.dataset.target = "page-social";
    btn.className = "flex flex-col items-center justify-center hover:bg-white/5 text-gray-400 hover:text-white transition group";
    btn.innerHTML = `<i class="fa-solid fa-users mb-1 text-lg group-hover:text-cyan-400 transition-colors"></i><span class="text-[10px]">社交</span>`;
    navGrid.insertBefore(btn, navGrid.lastElementChild);

    const pageSocial = document.createElement('div');
    pageSocial.id = "page-social"; pageSocial.className = "page-section hidden";
    pageSocial.innerHTML = `
        <div class="sticky top-0 bg-slate-900/95 backdrop-blur-sm z-20 pb-4 border-b border-slate-800 mb-4">
            <h2 class="text-2xl font-bold text-cyan-400 flex items-center gap-2"><i class="fa-solid fa-users"></i> 好友列表</h2>
            <div class="mt-4 bg-slate-800 p-4 rounded-xl border border-slate-700">
                <div class="text-xs text-gray-400 mb-1">我的好友代碼</div>
                <div class="flex justify-between items-center">
                    <span class="text-2xl font-mono font-bold text-white tracking-widest" id="my-friend-code">...</span>
                    <button onclick="copyFriendCode()" class="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-white transition">複製</button>
                </div>
            </div>
            <div class="flex gap-2 mt-3">
                <input type="text" id="input-friend-code" placeholder="輸入對方代碼" class="flex-1 bg-slate-900 border border-slate-600 text-white rounded-lg p-3 outline-none focus:border-cyan-500 uppercase">
                <button onclick="addFriend()" class="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white px-4 rounded-lg font-bold shadow-lg"><i class="fa-solid fa-user-plus"></i></button>
            </div>
        </div>
        <div id="friend-list-container" class="space-y-3 pb-20"><div class="text-center text-gray-500 py-10">載入中...</div></div>`;
    document.querySelector('main').appendChild(pageSocial);
}

function injectNotificationContainer() {
    if (document.getElementById('notification-container')) return;
    const div = document.createElement('div');
    div.id = 'notification-container';
    div.className = "fixed top-4 right-4 z-[100] flex flex-col gap-2 w-72 pointer-events-none";
    document.body.appendChild(div);
}

// 顯示通用 Toast 訊息
window.showToastMsg = (msg, type = "info") => {
    const container = document.getElementById('notification-container');
    if(!container) return;
    const toast = document.createElement('div');
    const colorClass = type === "error" ? "border-red-500/50" : "border-cyan-500/50";
    toast.className = `bg-slate-800/90 backdrop-blur-md border ${colorClass} p-3 rounded-xl shadow-2xl transform translate-x-full transition-all duration-300 pointer-events-auto flex items-center gap-3`;
    toast.innerHTML = `<i class="fa-solid fa-bell text-yellow-400"></i><span class="text-sm text-white">${msg}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.remove('translate-x-full'));
    setTimeout(() => {
        toast.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

function startPresenceSystem() {
    if (presenceInterval) clearInterval(presenceInterval);
    const updatePresence = async () => {
        if (!auth.currentUser) return;
        try { await updateDoc(doc(db, "users", auth.currentUser.uid), { lastActive: serverTimestamp() }); } catch (e) {}
    };
    updatePresence();
    presenceInterval = setInterval(updatePresence, 60 * 1000);
}

window.copyFriendCode = () => {
    const code = document.getElementById('my-friend-code').innerText;
    navigator.clipboard.writeText(code).then(() => showToastMsg("代碼已複製！"));
};

window.addFriend = async () => {
    const input = document.getElementById('input-friend-code');
    const targetCode = input.value.trim().toUpperCase();
    if (!targetCode || targetCode === currentUserData.friendCode) return showToastMsg("代碼無效", "error");

    const btn = document.querySelector('button[onclick="addFriend()"]');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
        const q = query(collection(db, "users"), where("friendCode", "==", targetCode));
        const snap = await getDocs(q);

        if (snap.empty) { showToastMsg("找不到此代碼", "error"); return; }
        const targetUserDoc = snap.docs[0];
        const targetUserId = targetUserDoc.id;

        if (currentUserData.friends.includes(targetUserId)) { showToastMsg("已經是好友囉！", "info"); return; }

        await runTransaction(db, async (transaction) => {
            transaction.update(doc(db, "users", auth.currentUser.uid), { friends: arrayUnion(targetUserId) });
            transaction.update(doc(db, "users", targetUserId), { friends: arrayUnion(auth.currentUser.uid) });
        });

        currentUserData.friends.push(targetUserId);
        showToastMsg(`成功添加 ${targetUserDoc.data().displayName} 為好友！`);
        input.value = "";
        loadFriendList();
    } catch (e) { console.error(e); showToastMsg("新增失敗", "error"); } finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus"></i>'; }
};

window.loadFriendList = async () => {
    const container = document.getElementById('friend-list-container');
    document.getElementById('my-friend-code').innerText = currentUserData.friendCode || "...";
    if (!currentUserData.friends || currentUserData.friends.length === 0) {
        container.innerHTML = `<div class="text-center py-10 opacity-50"><i class="fa-solid fa-user-group text-4xl mb-3"></i><p>還沒有好友...</p></div>`;
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
            const lastActive = fData.lastActive ? fData.lastActive.toDate() : new Date(0);
            const isOnline = (new Date() - lastActive) / 1000 / 60 < 5;
            const statusHtml = isOnline ? `<span class="text-green-400 text-xs flex items-center gap-1">🟢 線上</span>` : `<span class="text-gray-500 text-xs">離線</span>`;
            
            const rIndex = Math.min(fData.stats?.rankLevel || 0, RANKS.length - 1);
            const rName = RANKS[rIndex].split(' ')[1];

            const div = document.createElement('div');
            div.className = "bg-slate-800/50 p-3 rounded-xl border border-slate-700 flex items-center gap-3";
            div.innerHTML = `${getAvatarHtml(fData.equipped, "w-12 h-12")}<div class="flex-1"><div class="flex justify-between items-center"><span class="font-bold text-white">${fData.displayName}</span><span class="text-xs text-yellow-500 font-mono">${rName}</span></div><div class="flex justify-between items-center mt-1">${statusHtml}<span class="text-[10px] text-gray-500">積分: ${fData.stats?.totalScore||0}</span></div></div>`;
            container.appendChild(div);
        });
    } catch (e) { container.innerHTML = '<div class="text-red-400 text-center">載入失敗</div>'; }
};

function listenForNotifications() {
    if (notificationUnsub) notificationUnsub();
    const q = query(collection(db, "users", auth.currentUser.uid, "notifications"), orderBy("timestamp", "desc"), limit(5));
    notificationUnsub = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const data = change.doc.data();
                if ((new Date() - (data.timestamp?.toDate() || new Date(0))) < 60000) showInviteNotification(change.doc.id, data);
            }
        });
    });
}

function showInviteNotification(docId, data) {
    const container = document.getElementById('notification-container');
    const toast = document.createElement('div');
    toast.className = "bg-slate-800/90 backdrop-blur-md border border-yellow-500/50 p-4 rounded-xl shadow-2xl transform translate-x-full transition-all duration-300 pointer-events-auto flex flex-col gap-2";
    toast.innerHTML = `
        <div class="flex items-start gap-3"><div class="bg-yellow-500/20 p-2 rounded-full text-yellow-400"><i class="fa-solid fa-swords"></i></div><div><h4 class="font-bold text-white text-sm">對戰邀請！</h4><p class="text-xs text-gray-300 mt-1">玩家 <span class="text-yellow-300 font-bold">${data.hostName}</span> 邀請你一決勝負！</p></div></div>
        <div class="flex gap-2 mt-1"><button onclick="rejectInvite('${docId}', this)" class="flex-1 bg-slate-700 hover:bg-slate-600 text-xs py-2 rounded text-gray-300">忽略</button><button onclick="acceptInvite('${data.roomId}', '${docId}', this)" class="flex-1 bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500 text-xs py-2 rounded text-white font-bold shadow-lg animate-pulse">接受挑戰 ⚔️</button></div>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.remove('translate-x-full'));
    setTimeout(() => dismissToast(toast, docId), 10000);
}

window.rejectInvite = (docId, btn) => dismissToast(btn.closest('div').parentElement, docId);
window.acceptInvite = (roomId, docId, btn) => {
    dismissToast(btn.closest('div').parentElement, docId);
    joinBattleRoom(roomId);
};

async function dismissToast(element, docId) {
    element.classList.add('translate-x-full', 'opacity-0');
    setTimeout(() => { if(element.parentElement) element.parentElement.removeChild(element); }, 300);
    try { await deleteDoc(doc(db, "users", auth.currentUser.uid, "notifications", docId)); } catch(e){}
}

async function joinBattleRoom(roomId) {
    if (isBattleActive) return showToastMsg("你已經在戰鬥或配對中了！", "error");
    const roomRef = doc(db, "rooms", roomId);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) return showToastMsg("該房間已不存在", "error");
    const roomData = roomSnap.data();
    if (roomData.status !== "waiting" || roomData.guest) return showToastMsg("該房間已滿或遊戲已開始", "error");

    const myPlayerData = { uid: auth.currentUser.uid, name: currentUserData.displayName, score: 0, done: false, equipped: currentUserData.equipped || { frame: '', avatar: '' } };
    isBattleActive = true;
    switchToPage('page-battle');
    document.getElementById('battle-lobby').classList.add('hidden');
    document.getElementById('battle-arena').classList.remove('hidden');
    
    try {
        await updateDoc(roomRef, { guest: myPlayerData, status: "ready" });
        currentBattleId = roomId;
        listenToBattleRoom(roomId);
    } catch (e) { showToastMsg("加入房間失敗", "error"); leaveBattle(); }
}

async function inviteOnlinePlayers(roomId) {
    try {
        const q = query(collection(db, "users"), where("lastActive", ">", new Date(Date.now() - 5 * 60000)), limit(20));
        const snapshot = await getDocs(q);
        const candidates = snapshot.docs.filter(d => d.id !== auth.currentUser.uid).map(d => d.id);
        if (candidates.length === 0) return showToastMsg("目前無其他線上玩家");
        
        const selectedIds = shuffleArray(candidates).slice(0, 3);
        showToastMsg(`已邀請 ${selectedIds.length} 位線上玩家！`);
        
        selectedIds.forEach(targetUid => {
            addDoc(collection(db, "users", targetUid, "notifications"), {
                type: "battle_invite", roomId: roomId, hostName: currentUserData.displayName || "神秘玩家", timestamp: serverTimestamp()
            });
        });
    } catch (e) { 
        // 默默失敗或顯示錯誤
        if(e.message.includes("index")) showToastMsg("⚠️ 請建立 Firebase 索引 (lastActive)", "error");
    }
}

// --- 9. 對戰配對邏輯 ---
window.startBattleMatchmaking = async () => {
    if (!auth.currentUser) return showToastMsg("請先登入！", "error");
    isBattleActive = true;
    switchToPage('page-battle');
    document.getElementById('battle-lobby').classList.remove('hidden');
    document.getElementById('battle-arena').classList.add('hidden');
    document.getElementById('battle-status-text').innerText = "🔍 搜尋對手中...";

    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const myPlayerData = { uid: auth.currentUser.uid, name: currentUserData.displayName, score: 0, done: false, equipped: currentUserData.equipped };

    try {
        const q = query(collection(db, "rooms"), where("status", "==", "waiting"), where("createdAt", ">", twoMinutesAgo), limit(5));
        const snapshot = await getDocs(q);
        let joinedRoomId = null;

        if (!snapshot.empty) {
            const availableDocs = snapshot.docs.filter(d => d.data().host.uid !== auth.currentUser.uid);
            if (availableDocs.length > 0) {
                const targetDoc = availableDocs[Math.floor(Math.random() * availableDocs.length)];
                await runTransaction(db, async (t) => {
                    const sfDoc = await t.get(targetDoc.ref);
                    if (!sfDoc.exists() || sfDoc.data().guest) throw "Room full";
                    t.update(targetDoc.ref, { guest: myPlayerData, status: "ready" });
                    joinedRoomId = targetDoc.id;
                });
            }
        }

        if (joinedRoomId) {
            currentBattleId = joinedRoomId;
            document.getElementById('battle-status-text').innerText = "✅ 配對成功！";
        } else {
            document.getElementById('battle-status-text').innerText = "👑 建立房間...";
            const roomRef = await addDoc(collection(db, "rooms"), { host: myPlayerData, guest: null, status: "waiting", round: 1, createdAt: serverTimestamp() });
            currentBattleId = roomRef.id;
            inviteOnlinePlayers(currentBattleId);
        }
        listenToBattleRoom(currentBattleId);
    } catch (e) {
        if (e.message.includes("index")) showToastMsg("⚠️ 系統錯誤：Firebase 需要建立索引 (status + createdAt)", "error");
        else { showToastMsg("配對失敗", "error"); leaveBattle(); }
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
            document.getElementById('p1-score').innerText = isHost ? room.host.score : room.guest.score;
            document.getElementById('p2-score').innerText = isHost ? room.guest.score : room.host.score;
            document.getElementById('battle-round').innerText = room.round;
            document.getElementById('battle-my-avatar').innerHTML = getAvatarHtml((isHost ? room.host : room.guest).equipped, "w-16 h-16");
            document.getElementById('battle-opp-avatar').innerHTML = getAvatarHtml((isHost ? room.guest : room.host).equipped, "w-16 h-16");

            if (!room.currentQuestion) {
                document.getElementById('battle-loading').classList.remove('hidden');
                document.getElementById('battle-quiz-box').classList.add('hidden');
                if (isHost) generateSharedQuiz(roomId);
                return;
            }
            
            document.getElementById('battle-loading').classList.add('hidden');
            document.getElementById('battle-quiz-box').classList.remove('hidden');
            document.getElementById('battle-q-text').innerText = room.currentQuestion.q;
            
            const container = document.getElementById('battle-options');
            const myData = isHost ? room.host : room.guest;
            
            if (!myData.done) {
                document.getElementById('battle-waiting-msg').classList.add('hidden');
                container.innerHTML = '';
                room.currentQuestion.opts.forEach((opt, idx) => {
                    const btn = document.createElement('button');
                    btn.className = "w-full text-left p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition border border-slate-600 active:scale-95";
                    btn.innerHTML = `<span class="bg-slate-800 w-8 h-8 rounded-full inline-flex items-center justify-center text-sm font-bold text-blue-400 border border-slate-600 mr-3">${String.fromCharCode(65+idx)}</span><span>${opt}</span>`;
                    btn.onclick = () => handleBattleAnswer(roomId, idx, room.currentQuestion.ans, isHost);
                    container.appendChild(btn);
                });
            } else {
                container.innerHTML = '<div class="text-center text-gray-400 italic py-4 bg-slate-700/30 rounded-lg">✓ 已提交答案</div>';
                document.getElementById('battle-waiting-msg').classList.remove('hidden');
            }

            if (room.host.done && room.guest.done && isHost) {
                setTimeout(async () => {
                    if (room.round >= 3) await updateDoc(doc(db, "rooms", roomId), { status: "finished" });
                    else await updateDoc(doc(db, "rooms", roomId), { round: room.round + 1, currentQuestion: null, "host.done": false, "guest.done": false });
                }, 2000);
            }
        }
        if (room.status === "finished") {
            document.getElementById('battle-arena').classList.add('hidden');
            document.getElementById('battle-result').classList.remove('hidden');
            const myScore = isHost ? room.host.score : room.guest.score;
            const oppScore = isHost ? room.guest.score : room.host.score;
            document.getElementById('battle-result-title').innerText = myScore > oppScore ? "🎉 勝利！" : (myScore < oppScore ? "💔 惜敗..." : "🤝 平手");
            document.getElementById('battle-result-msg').innerText = `${myScore} : ${oppScore}`;
        }
    });
}

let isGenerating = false;
async function generateSharedQuiz(roomId) {
    if (isGenerating) return;
    isGenerating = true;
    showToastMsg("正在生成對戰題目...");
    try {
        const q = await fetchOneQuestion();
        await updateDoc(doc(db, "rooms", roomId), { currentQuestion: { q: q.data.q, opts: q.data.opts, ans: q.data.ans } });
        showToastMsg("題目準備就緒！");
    } catch (e) { showToastMsg("題目生成失敗", "error"); } finally { isGenerating = false; }
}

async function handleBattleAnswer(roomId, userIdx, correctIdx, isHost) {
    const isCorrect = userIdx === correctIdx;
    const updateField = isHost ? "host" : "guest";
    const roomRef = doc(db, "rooms", roomId);
    const roomSnap = await getDoc(roomRef);
    const score = (isHost ? roomSnap.data().host.score : roomSnap.data().guest.score) + (isCorrect ? 100 : 0);
    await updateDoc(roomRef, { [`${updateField}.score`]: score, [`${updateField}.done`]: true });
}

window.leaveBattle = async () => {
    if (battleUnsub) { battleUnsub(); battleUnsub = null; }
    if (currentBattleId) {
        const rid = currentBattleId;
        getDoc(doc(db, "rooms", rid)).then(async (snap) => {
            if (snap.exists() && snap.data().status === "waiting" && snap.data().host.uid === auth.currentUser.uid) {
                await deleteDoc(doc(db, "rooms", rid));
            }
        });
    }
    isBattleActive = false; currentBattleId = null;
    switchToPage('page-home');
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
        let targetSubject = "綜合";
        const response = await fetch(BACKEND_URL, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject: targetSubject, level: level, rank: rankName, difficulty: settings.difficulty })
        });
        const data = await response.json();
        const rawData = JSON.parse(data.text.replace(/```json/g, '').replace(/```/g, '').trim());
        let allOptions = shuffleArray([rawData.correct, ...rawData.wrong]);
        return { data: { q: rawData.q, opts: allOptions, ans: allOptions.indexOf(rawData.correct), exp: rawData.exp }, rank: rankName, badge: `🎯 AI` };
    } else {
        let targetSource = settings.source; 
        if (!currentBankData || currentBankData.sourcePath !== targetSource) {
            let filesToFetch = [];
            if (targetSource.endsWith('.json')) filesToFetch = [targetSource];
            else {
                if (allBankFiles.length === 0) {
                     try { const res = await fetch('/api/banks'); const data = await res.json(); allBankFiles = data.files || []; } catch (e) {}
                }
                filesToFetch = allBankFiles.filter(f => f.startsWith(targetSource + '/'));
                if (filesToFetch.length === 0) return switchToAI();
            }
            try {
                showToastMsg(`正在載入 ${filesToFetch.length} 份考卷...`);
                const fetchPromises = filesToFetch.map(filePath => fetch(`/banks/${filePath}?t=${Date.now()}`).then(res => res.json()).catch(()=>[]));
                const results = await Promise.all(fetchPromises);
                const mergedQuestions = results.flat();
                if (mergedQuestions.length === 0) throw new Error("無題目");
                currentBankData = { sourcePath: targetSource, questions: mergedQuestions };
            } catch (e) { return switchToAI(); }
        }
        const filtered = currentBankData.questions.filter(q => q.difficulty === settings.difficulty);
        const pool = filtered.length > 0 ? filtered : currentBankData.questions;
        const rawData = pool[Math.floor(Math.random() * pool.length)];
        let allOptions = shuffleArray([rawData.correct, ...rawData.wrong]);
        return { data: { q: rawData.q, opts: allOptions, ans: allOptions.indexOf(rawData.correct), exp: rawData.exp }, rank: rankName, badge: `🎯 ${rawData.subject || '題庫'}` };
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
    } catch (e) {} finally { isFetchingBuffer = false; }
}

function buildPathTree(paths) {
    const tree = { name: "root", children: {} };
    paths.forEach(path => {
        const parts = path.split('/');
        let current = tree;
        parts.forEach((part, index) => {
            if (!current.children[part]) current.children[part] = { name: part, type: index === parts.length - 1 ? 'file' : 'folder', fullPath: index === parts.length - 1 ? path : null, children: {} };
            current = current.children[part];
        });
    });
    return tree;
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
        const defaultOpt = document.createElement('option'); defaultOpt.value = ""; defaultOpt.innerText = "-- 請選擇 --"; defaultOpt.disabled = true;
        if (!selectedParts[level]) defaultOpt.selected = true; select.appendChild(defaultOpt);

        if (level === 0) { const aiOpt = document.createElement('option'); aiOpt.value = "ai"; aiOpt.innerText = "✨ AI 隨機生成"; if (selectedParts[0] === 'ai') aiOpt.selected = true; select.appendChild(aiOpt); }

        Object.keys(currentNode.children).forEach(key => {
            const node = currentNode.children[key];
            const opt = document.createElement('option'); opt.value = key; opt.innerText = node.type === 'file' ? `📄 ${key.replace('.json', '')}` : `📂 ${key}`;
            if (selectedParts[level] === key) opt.selected = true; select.appendChild(opt);
        });

        select.onchange = (e) => {
            const val = e.target.value;
            const newParts = selectedParts.slice(0, level); newParts.push(val);
            const currentFullPath = newParts.join('/');
            if (val === 'ai') { hiddenInput.value = 'ai'; hint.innerText = "目前設定：AI"; renderCascadingSelectors(tree, 'ai'); }
            else {
                const nextNode = currentNode.children[val];
                hiddenInput.value = currentFullPath;
                if (nextNode.type === 'file') { hint.innerText = `✅ ${val}`; renderCascadingSelectors(tree, currentFullPath); }
                else { 
                    let hasSubFolders = Object.values(nextNode.children).some(c => c.type === 'folder');
                    if(hasSubFolders) { hiddenInput.value = ""; hint.innerText = "⚠️ 請繼續選擇..."; }
                    else hint.innerText = `📂 ${val}`;
                    renderCascadingSelectors(tree, newParts.join('/')); 
                }
            }
        };
        container.appendChild(wrapper);
        wrapper.appendChild(select);
        const currentVal = selectedParts[level];
        if (currentVal && currentVal !== 'ai' && currentNode.children[currentVal]) createSelect(level + 1, currentNode.children[currentVal]);
    };
    createSelect(0, tree);
};

window.saveProfile = async () => {
    const level = document.getElementById('set-level').value;
    const rawStrong = document.getElementById('set-strong').value;
    const rawWeak = document.getElementById('set-weak').value;
    const source = document.getElementById('set-source-final-value').value;
    const difficulty = document.getElementById('set-difficulty').value;
    if (!source) return showToastMsg("請完整選擇出題來源", "error");
    const btn = document.querySelector('button[onclick="saveProfile()"]');
    btn.innerText = "處理中..."; btn.disabled = true;
    const cleanStrong = await getCleanSubjects(rawStrong);
    const cleanWeak = await getCleanSubjects(rawWeak);
    document.getElementById('set-strong').value = cleanStrong;
    document.getElementById('set-weak').value = cleanWeak;
    await updateDoc(doc(db, "users", auth.currentUser.uid), { "profile.educationLevel": level, "profile.strongSubjects": cleanStrong, "profile.weakSubjects": cleanWeak, "gameSettings": { source, difficulty } });
    currentUserData.profile.educationLevel = level; currentUserData.profile.strongSubjects = cleanStrong; currentUserData.profile.weakSubjects = cleanWeak; currentUserData.gameSettings = { source, difficulty };
    currentBankData = null; localStorage.removeItem('currentQuiz'); quizBuffer = []; fillBuffer();
    btn.innerText = "儲存成功！"; setTimeout(() => { btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> 更新設定`; btn.disabled = false; }, 2000);
};

window.loadAdminProducts = async () => {
    loadAdminLogs(); 
    const listContainer = document.getElementById('admin-product-list');
    listContainer.innerHTML = '<div class="text-center text-gray-500">載入商品中...</div>';
    try {
        const q = query(collection(db, "products"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        listContainer.innerHTML = '';
        if(snap.empty) { listContainer.innerHTML = '<div class="text-center text-gray-500">尚無商品</div>'; return; }
        snap.forEach(doc => {
            const item = doc.data();
            const div = document.createElement('div');
            div.className = 'admin-item-row cursor-pointer';
            div.onclick = () => editProduct(doc.id, item);
            div.innerHTML = `<div class="flex items-center gap-3">${renderVisual(item.type, item.value, "w-8 h-8")}<div><div class="font-bold text-white text-sm">${item.name}</div><div class="text-xs text-gray-400">${item.type} | $${item.price}</div></div></div><div class="text-blue-400 text-xs"><i class="fa-solid fa-pen"></i> 編輯</div>`;
            listContainer.appendChild(div);
        });
    } catch (e) { listContainer.innerHTML = '<div class="text-red-400 text-center">載入失敗</div>'; }
};

window.loadAdminData = window.loadAdminProducts;

function renderVisual(type, value, sizeClass = "w-12 h-12") {
    const isImage = value && (value.includes('.') || value.includes('/'));
    if (type === 'frame') {
        if (isImage) return `<div class="${sizeClass} rounded-full bg-slate-800 flex items-center justify-center relative" style="overflow: visible !important;"><div class="w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-slate-800 relative z-0"><i class="fa-solid fa-user text-gray-500"></i></div><img src="${value}" class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[140%] w-auto object-contain pointer-events-none z-20" style="max-width: none;"></div>`;
        else return `<div class="${sizeClass} rounded-full border-2 border-gray-600 ${value} flex items-center justify-center bg-slate-800 relative z-0"><i class="fa-solid fa-user text-gray-500"></i></div>`;
    } else if (type === 'avatar') {
        return `<div class="${sizeClass} rounded-full overflow-hidden bg-slate-800 border-2 border-slate-600 relative z-10"><img src="${value}" class="avatar-img" onerror="this.style.display='none';this.parentElement.innerHTML='<i class=\'fa-solid fa-image text-red-500\'></i>'"></div>`;
    }
    return '';
}

function getAvatarHtml(equipped, sizeClass = "w-10 h-10") {
    const frame = equipped?.frame || '';
    const avatar = equipped?.avatar || '';
    const isFrameImg = frame && (frame.includes('.') || frame.includes('/'));
    const imgContent = avatar ? `<img src="${avatar}" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"> <i class="fa-solid fa-user text-gray-400 absolute hidden"></i>` : `<i class="fa-solid fa-user text-gray-400"></i>`;
    const borderClass = frame ? '' : 'border-2 border-slate-600';
    const cssFrameClass = (!isFrameImg && frame) ? frame : '';
    const frameImgElement = isFrameImg ? `<img src="${frame}" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); height: 145%; width: auto; max-width: none; z-index: 50; pointer-events: none;">` : '';
    return `<div class="${sizeClass} rounded-full bg-slate-800 flex items-center justify-center relative ${borderClass} ${cssFrameClass}" style="overflow: visible !important;"><div class="w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-slate-800 relative z-0">${imgContent}</div>${frameImgElement}</div>`;
}

window.toggleAdminForm = () => {
    const body = document.getElementById('admin-form-body');
    const arrow = document.getElementById('admin-form-arrow');
    if (body.classList.contains('hidden')) { body.classList.remove('hidden'); arrow.style.transform = 'rotate(0deg)'; } 
    else { body.classList.add('hidden'); arrow.style.transform = 'rotate(180deg)'; }
};
window.openAdminForm = () => { document.getElementById('admin-form-body').classList.remove('hidden'); document.getElementById('admin-form-arrow').style.transform = 'rotate(0deg)'; }
window.editProduct = (id, data) => {
    document.getElementById('admin-edit-id').value = id; document.getElementById('admin-p-name').value = data.name; document.getElementById('admin-p-type').value = data.type; document.getElementById('admin-p-value').value = data.value; document.getElementById('admin-p-price').value = data.price;
    document.getElementById('admin-form-title').innerText = "✏️ 編輯商品";
    const saveBtn = document.getElementById('admin-btn-save'); saveBtn.innerText = "更新商品"; saveBtn.classList.replace('bg-red-600', 'bg-blue-600');
    document.getElementById('admin-btn-del').classList.remove('hidden'); toggleAdminInputPlaceholder(); openAdminForm(); document.getElementById('page-admin').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
window.resetAdminForm = () => {
    document.getElementById('admin-edit-id').value = ''; document.getElementById('admin-p-name').value = ''; document.getElementById('admin-p-value').value = ''; document.getElementById('admin-p-price').value = '';
    document.getElementById('admin-form-title').innerText = "➕ 上架新商品";
    const saveBtn = document.getElementById('admin-btn-save'); saveBtn.innerText = "上架商品"; saveBtn.classList.replace('bg-blue-600', 'bg-red-600');
    document.getElementById('admin-btn-del').classList.add('hidden'); toggleAdminInputPlaceholder(); openAdminForm();
};
window.saveProduct = async () => {
    if (!currentUserData || !currentUserData.isAdmin) return showToastMsg("權限不足！", "error");
    const docId = document.getElementById('admin-edit-id').value; const name = document.getElementById('admin-p-name').value; const type = document.getElementById('admin-p-type').value; const value = document.getElementById('admin-p-value').value; const price = parseInt(document.getElementById('admin-p-price').value);
    if (!name || !value || isNaN(price)) return showToastMsg("請填寫完整資訊", "error");
    const btn = document.getElementById('admin-btn-save'); btn.innerText = "處理中..."; btn.disabled = true;
    try {
        if (docId) { await updateDoc(doc(db, "products", docId), { name, type, value, price, updatedAt: serverTimestamp() }); showToastMsg("更新成功！"); } 
        else { await addDoc(collection(db, "products"), { name, type, value, price, createdAt: serverTimestamp() }); showToastMsg("上架成功！"); }
        resetAdminForm(); loadAdminProducts();
    } catch (e) { showToastMsg("操作失敗", "error"); } finally { btn.disabled = false; if(!docId) btn.innerText = "上架商品"; else btn.innerText = "更新商品"; }
};
window.deleteProduct = async () => {
    const docId = document.getElementById('admin-edit-id').value; if (!docId || !confirm("確定要下架嗎？")) return;
    try { await deleteDoc(doc(db, "products", docId)); showToastMsg("刪除成功"); resetAdminForm(); loadAdminProducts(); } catch (e) { showToastMsg("刪除失敗", "error"); }
};
window.toggleAdminInputPlaceholder = async () => {
    const type = document.getElementById('admin-p-type').value; const input = document.getElementById('admin-p-value'); const hint = document.getElementById('admin-hint'); document.getElementById('admin-asset-selector').classList.remove('hidden');
    if (type === 'frame') { input.placeholder = "CSS Class 或 圖片路徑"; hint.innerText = "CSS Class (style.css) 或 圖片"; } else { input.placeholder = "圖片路徑"; hint.innerText = "手動輸入或從上方選擇"; }
    await loadUnusedAssets();
};
async function loadUnusedAssets() {
    const select = document.getElementById('admin-asset-select'); select.innerHTML = '<option value="">-- 掃描中... --</option>';
    try {
        const res = await fetch('/api/assets'); const data = await res.json(); const allImages = data.images || [];
        const q = query(collection(db, "products")); const snap = await getDocs(q); const usedImages = new Set();
        snap.forEach(d => { if (d.data().value?.includes('.') || d.data().value?.includes('/')) usedImages.add(d.data().value); });
        const unused = allImages.filter(img => !usedImages.has(img));
        select.innerHTML = '<option value="">-- 請選擇 --</option>';
        unused.forEach(img => { const opt = document.createElement('option'); opt.value = img; opt.innerText = img.replace('assets/', ''); select.appendChild(opt); });
    } catch (e) { select.innerHTML = '<option value="">讀取失敗</option>'; }
}
window.selectAdminImage = (value) => { if (!value) return; document.getElementById('admin-p-value').value = value; const p = document.getElementById('admin-asset-preview'); p.src = value; p.classList.remove('hidden'); };

function checkAdminRole(isAdmin) {
    const navGrid = document.getElementById('nav-grid');
    if (isAdmin && !document.getElementById('btn-admin-nav')) {
        navGrid.classList.remove('grid-cols-5'); navGrid.classList.add('grid-cols-6');
        const btn = document.createElement('button'); btn.id = "btn-admin-nav"; btn.dataset.target = "page-admin";
        btn.className = "flex flex-col items-center justify-center hover:bg-white/5 text-gray-400 hover:text-red-400 transition group";
        btn.onclick = () => { loadAdminLogs(); switchToPage('page-admin'); };
        btn.innerHTML = `<i class="fa-solid fa-user-shield mb-1 text-lg group-hover:text-red-400 transition-colors"></i><span class="text-[10px]">管理</span>`;
        navGrid.appendChild(btn);
    }
}
