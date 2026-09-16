// 🔥 修正：使用純 URL 引入 Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, 
    query, orderBy, limit, getDocs, serverTimestamp, where, onSnapshot, runTransaction, 
    arrayUnion, arrayRemove, writeBatch, startAfter 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { applyCultivationReward, showCultivationFeedback } from './cultivation-rules.js';

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
// 🔥 新增這行：將玩家資料開放給修仙模組讀取
window.getCurrentUserData = () => currentUserData;

// --- 全域狀態變數 ---
let isBattleResultProcessed = false; // 防止重複領取獎勵
let systemUnsub = null;              // 系統指令監聽 (強制重整)
let localReloadToken = null;         // 本地重整標記
let inviteUnsub = null;              // 邀請監聽
let battleUnsub = null;              // 對戰房監聽
let chatUnsub = null;                // 聊天室監聽
let currentBattleId = null;          // 當前對戰 ID
let isBattleActive = false;          // 是否在對戰中
let quizBuffer = [];                 // 題目緩衝
const BUFFER_SIZE = 3;               // 🔥 緩衝題數改為 3
let isFetchingBuffer = false; 
let currentBankData = null; 
let presenceInterval = null; 
let allBankFiles = [];
let currentSelectSlot = null;

let isAnswering = false;             // 防止答題連點
const answeredSoloQuizzes = new WeakSet();
let timerInterval = null;
// --- 對戰動畫控制 (新增) ---
let lastProcessedLogId = null;       // 記錄最後一次播放的戰鬥日誌 ID
let isPlayingSequence = false;       // 是否正在播放序列動畫中
// --- 單人挑戰 Session 狀態 ---
let soloSession = {
    active: false,
    currentStep: 0,
    maxSteps: 10,
    correctCount: 0,
    wrongCount: 0,
    history: [] // 紀錄這 10 題的詳細狀況
};
// ==========================================
// 🌍 國際化 (i18n) 設定
// ==========================================
let currentLang = localStorage.getItem('app_lang') || 'zh-TW';

const translations = {
    'zh-TW': {
        app_title: "青雲問道 · 以學入道",
        app_name: "青雲問道",
        not_logged_in: "未登入",
        welcome_title: "一念起，入仙途",
        welcome_desc: "以知識為靈根，以每一題為修行。",
        btn_login_google: "使用 Google 登入",
        
        // Onboarding
        ob_title: "👋 嗨！初次見面",
        ob_desc: "設定資料讓題目更適合你：",
        ob_label_level: "你是幾年級學生？",
        ob_label_strong: "擅長科目",
        ob_label_weak: "弱項科目",
        ob_placeholder_strong: "例如：歷史, 英文",
        ob_placeholder_weak: "例如：數學, 理化",
        btn_start_journey: "開始旅程",
        
        // Levels
        level_elem_mid: "國小 (中年級)",
        level_elem_high: "國小 (高年級)",
        level_jh_1: "國中 (一年級)",
        level_jh_2: "國中 (二年級)",
        level_jh_3: "國中 (三年級)",
        level_sh: "高中 / 高職",
        level_univ: "大學 / 社會人士",

        // Home
        btn_solo: "單人挑戰",
        btn_pvp: "雙人對戰",
        label_net_progress: "淨勝",
        stat_score: "總積分",
        stat_accuracy: "正確率",
        stat_streak: "當前連對",
        stat_best_streak: "最佳連對",

        // Quiz
        loading_title: "雲端大腦運算中",
        loading_text: "AI 正在趕工出題中...",
        label_analysis: "AI 解析：",
        btn_back_home: "返回大廳",
        btn_next_q: "下一題",
        btn_giveup: "放棄此題 (換下一題)",
        msg_correct: "回答正確！",
        msg_wrong: "回答錯誤...",
        msg_rank_up: "🎉 晉升至",
        msg_rank_down: "⚠️ 降級至",

        // Store
        store_title: "道具商店",
        tab_all: "全部",
        tab_frame: "相框",
        tab_avatar: "頭像",
        msg_loading_products: "載入商品中...",
        btn_equip: "裝備",
        btn_equipped: "已裝備",
        msg_buy_confirm: "確定要花費 {price} 積分購買嗎？",
        msg_buy_success: "購買成功！",
        msg_no_funds: "積分不足！",
        // 加在 translations['zh-TW'] 裡面
        admin_inventory_title: "📦 現有商品庫存",

        // Battle
        battle_searching: "正在搜尋對手...",
        battle_connecting: "正在連接對戰伺服器",
        btn_cancel_match: "取消配對",
        battle_me: "我方",
        battle_opp: "對手",
        battle_generating: "正在生成題目...",
        battle_waiting_opp: "等待對手作答中...",
        battle_ended: "對戰結束",
        battle_calculating: "計算結果中...",
        btn_play_again: "再來一局",
        battle_win: "🎉 勝利！",
        battle_lose: "💔 惜敗...",
        battle_draw: "🤝 平手",

        // Rank
        rank_title: "全服排行榜",
        th_player: "玩家",
        th_rank: "段位",

        // Settings
        settings_title: "個人設定",
        label_level: "年級 / 身份",
        label_strong: "擅長科目",
        label_weak: "弱項 (加強練習)",
        placeholder_strong: "輸入擅長科目...",
        placeholder_weak: "輸入想加強的科目...",
        label_source: "出題來源",
        label_difficulty: "題目難度",
        hint_select_bank: "請依序選擇分類...",
        diff_easy: "🟢 簡單 (Easy)",
        diff_medium: "🟡 中等 (Medium)",
        diff_hard: "🔴 困難 (Hard)",
        btn_update_settings: "更新設定",
        history_title: "答題紀錄",
        inventory_title: "我的背包",
        btn_logout: "登出帳號",
        loading: "載入中...",

        // Admin
        admin_title: "管理後台",
        admin_new_mode: "新增模式",
        admin_maintenance: "系統維護",
        btn_recalc_rank: "重算全服玩家段位",
        msg_recalc_warn: "說明：這會遍歷所有使用者，根據其「淨積分」重新設定段位。",
        admin_add_product: "➕ 上架新商品",
        admin_label_name: "商品名稱",
        admin_label_price: "價格 (分)",
        admin_label_type: "商品類型",
        admin_select_img: "從伺服器選擇圖片：",
        btn_save_product: "上架商品",
        admin_inventory_title: "📦 現有商品庫存",
        tab_cards: "卡牌",

        // Nav
        nav_home: "首頁",
        nav_quiz: "答題",
        nav_store: "商店",
        nav_rank: "排行",
        nav_settings: "設定",
        nav_social: "社交",
        nav_admin: "管理",

        // Ranks
        rank_bronze: "🥉 青銅",
        rank_silver: "🥈 白銀",
        rank_gold: "🥇 黃金",
        rank_diamond: "🔷 鑽石",
        rank_star: "🌟 星耀",
        rank_master: "🟣 大師",
        rank_grandmaster: "🔥 宗師",
        rank_king: "👑 王者",
        analysis_title: "能力分析圖譜",
        analysis_desc: "基於近期答題表現分析 (正確率)"
    },
    'en': {
        app_title: "Qingyun · The Path of Learning",
        app_name: "Qingyun",
        not_logged_in: "Guest",
        welcome_title: "Begin Your Journey",
        welcome_desc: "Cultivate knowledge, one question at a time.",
        btn_login_google: "Login with Google",
        
        ob_title: "👋 Hi there!",
        ob_desc: "Let's personalize your experience:",
        ob_label_level: "Your Education Level?",
        ob_label_strong: "Strong Subjects",
        ob_label_weak: "Weak Subjects",
        ob_placeholder_strong: "e.g., History, English",
        ob_placeholder_weak: "e.g., Math, Science",
        btn_start_journey: "Start Journey",
        
        level_elem_mid: "Elementary (Mid)",
        level_elem_high: "Elementary (High)",
        level_jh_1: "Junior High (Grade 7)",
        level_jh_2: "Junior High (Grade 8)",
        level_jh_3: "Junior High (Grade 9)",
        level_sh: "Senior High",
        level_univ: "University / Adult",

        btn_solo: "Solo Mode",
        btn_pvp: "PvP Battle",
        label_net_progress: "Net Score",
        stat_score: "Total Score",
        stat_accuracy: "Accuracy",
        stat_streak: "Streak",
        stat_best_streak: "Best Streak",

        loading_title: "AI Thinking...",
        loading_text: "Generating your challenge...",
        label_analysis: "AI Analysis:",
        btn_back_home: "Home",
        btn_next_q: "Next",
        btn_giveup: "Give Up (Skip)",
        msg_correct: "Correct!",
        msg_wrong: "Wrong...",
        msg_rank_up: "🎉 Promoted to",
        msg_rank_down: "⚠️ Demoted to",

        store_title: "Item Store",
        tab_all: "All",
        tab_frame: "Frame",
        tab_avatar: "Avatar",
        msg_loading_products: "Loading products...",
        btn_equip: "Equip",
        btn_equipped: "Equipped",
        msg_buy_confirm: "Spend {price} points to buy?",
        msg_buy_success: "Purchase Successful!",
        msg_no_funds: "Insufficient Points!",

        battle_searching: "Searching for opponent...",
        battle_connecting: "Connecting to server...",
        btn_cancel_match: "Cancel",
        battle_me: "You",
        battle_opp: "Enemy",
        battle_generating: "Generating Question...",
        battle_waiting_opp: "Waiting for opponent...",
        battle_ended: "Battle Ended",
        battle_calculating: "Calculating results...",
        btn_play_again: "Play Again",
        battle_win: "🎉 VICTORY!",
        battle_lose: "💔 DEFEAT...",
        battle_draw: "🤝 DRAW",

        rank_title: "Leaderboard",
        th_player: "Player",
        th_rank: "Rank",

        settings_title: "Settings",
        label_level: "Level / Identity",
        label_strong: "Strong Subjects",
        label_weak: "Weak Subjects",
        placeholder_strong: "Enter strong subjects...",
        placeholder_weak: "Enter weak subjects...",
        label_source: "Quiz Source",
        label_difficulty: "Difficulty",
        hint_select_bank: "Select a category...",
        diff_easy: "🟢 Easy",
        diff_medium: "🟡 Medium",
        diff_hard: "🔴 Hard",
        btn_update_settings: "Update Settings",
        history_title: "History",
        inventory_title: "Inventory",
        btn_logout: "Logout",
        loading: "Loading...",

        admin_title: "Admin Panel",
        admin_new_mode: "New Item",
        admin_maintenance: "Maintenance",
        btn_recalc_rank: "Recalculate Ranks",
        msg_recalc_warn: "This will recalculate all users' ranks based on net score.",
        admin_add_product: "➕ Add Product",
        admin_label_name: "Product Name",
        admin_label_price: "Price",
        admin_label_type: "Type",
        admin_select_img: "Select Image:",
        btn_save_product: "Save Product",
        admin_inventory_title: "📦 Current Inventory",

        nav_home: "Home",
        nav_quiz: "Quiz",
        nav_store: "Store",
        nav_rank: "Rank",
        nav_settings: "Settings",
        nav_social: "Social",
        nav_admin: "Admin",

        rank_bronze: "🥉 Bronze",
        rank_silver: "🥈 Silver",
        rank_gold: "🥇 Gold",
        rank_diamond: "🔷 Diamond",
        rank_star: "🌟 Star",
        rank_master: "🟣 Master",
        rank_grandmaster: "🔥 Grandmaster",
        rank_king: "👑 King",
        analysis_title: "能力分析圖譜",
        analysis_desc: "基於近期答題表現分析 (正確率)"
    }
};

// 輔助函式：取得翻譯
function t(key, params = {}) {
    let str = translations[currentLang][key] || key;
    for (const [k, v] of Object.entries(params)) {
        str = str.replace(`{${k}}`, v);
    }
    return str;
}

// 輔助函式：更新 DOM 文字
window.updateTexts = () => {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[currentLang][key]) {
            el.innerText = translations[currentLang][key];
        }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (translations[currentLang][key]) {
            el.placeholder = translations[currentLang][key];
        }
    });
    
    // 更新按鈕文字
    const langBtn = document.getElementById('lang-display');
    if(langBtn) langBtn.innerText = currentLang === 'zh-TW' ? 'EN' : '中文';
    
    updateUIStats();
};

window.toggleLanguage = () => {
    currentLang = currentLang === 'zh-TW' ? 'en' : 'zh-TW';
    localStorage.setItem('app_lang', currentLang);
    updateTexts();
};
// ==========================================
// 🛠️ 管理員強力除錯工具 (已修正：支援 Error 物件解析)
// ==========================================
window.setupAdminDebug = function() {
    // 防止重複初始化
    if (window.isDebugInit) return;
    window.isDebugInit = true;

    const consoleDiv = document.getElementById('admin-debug-console');
    const logContainer = document.getElementById('debug-logs');
    const debugCount = document.getElementById('debug-count');
    const showBtn = document.getElementById('btn-show-debug');

    if (!consoleDiv || !logContainer) return;

    // 顯示介面
    consoleDiv.classList.remove('hidden');
    if(showBtn) showBtn.classList.remove('hidden');

    const initMsg = document.createElement('div');
    initMsg.className = "text-green-400 text-[11px] font-mono border-b border-white/5 pb-1";
    initMsg.innerText = "🔧 Admin Debugger Active: Error Tracing Enabled...";
    logContainer.prepend(initMsg);

    // 🔥 [核心修正] 格式化參數，專門處理 Error 物件與物件迴圈
    const formatLogArgs = (args) => {
        return args.map(arg => {
            // 1. 如果是錯誤物件，強制印出 message 與 stack
            if (arg instanceof Error) {
                return `[Error] ${arg.message}\n<span class="opacity-50 text-[9px]">${arg.stack}</span>`;
            }
            // 2. 如果是普通物件，嘗試轉 JSON
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return `[Object] (Circular)`;
                }
            }
            // 3. 其他轉字串
            return String(arg);
        }).join(' ');
    };

    // 輔助函式：新增日誌到畫面
    const addLog = (msg, type = 'info') => {
        const div = document.createElement('div');
        const now = new Date();
        const time = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
        
        let colorClass = 'text-gray-300';
        let prefix = '[LOG]';

        if (type === 'error') {
            colorClass = 'text-red-400 font-bold bg-red-900/20 p-1 rounded border-l-2 border-red-500';
            prefix = '❌';
            // 更新錯誤計數
            let count = parseInt(debugCount.innerText) || 0;
            debugCount.innerText = count + 1;
        } else if (type === 'warn') {
            colorClass = 'text-yellow-400 bg-yellow-900/10';
            prefix = '⚠️';
        } else if (msg.includes('[Front-Image]') || msg.includes('[UI-Render]')) {
            colorClass = 'text-cyan-300 font-bold';
            prefix = '🎨';
        }

        div.className = `break-words text-[11px] font-mono border-b border-white/5 pb-1 ${colorClass}`;
        // 支援 HTML (讓 Stack Trace 可以換行)
        div.innerHTML = `<span class="opacity-50 mr-2 text-[9px]">${time}</span><span class="mr-1 opacity-75">${prefix}</span>${msg}`;
        
        logContainer.prepend(div);
    };

    // 1. 攔截 console.error
    const originalError = console.error;
    console.error = function(...args) {
        originalError.apply(console, args);
        // 使用新的格式化函式
        addLog(formatLogArgs(args), 'error');
    };

    // 2. 攔截 console.warn
    const originalWarn = console.warn;
    console.warn = function(...args) {
        originalWarn.apply(console, args);
        addLog(formatLogArgs(args), 'warn');
    };

    // 3. 攔截全域錯誤
    window.onerror = function(msg, url, line, col, error) {
        const stack = error ? error.stack : '';
        addLog(`${msg}\nLocation: ${url}:${line}:${col}\n${stack}`, 'error');
        return false; 
    };

    // 4. 攔截 Promise 錯誤
    window.onunhandledrejection = function(event) {
        // 有些 Promise error 是物件，有些是字串
        const reason = event.reason instanceof Error ? event.reason.message : event.reason;
        addLog(`Unhandled Promise: ${reason}`, 'error');
    };
    
    // 5. 攔截 console.log
    const originalLog = console.log;
    console.log = function(...args) {
        originalLog.apply(console, args);
        
        const msg = formatLogArgs(args);
        const keywords = ['[Front-Image]', '[UI-Render]', 'Generate', '戰', 'API Error', 'Prompt'];
        
        if (keywords.some(k => msg.includes(k))) {
           addLog(msg, 'info');
        }
    };
};
// ==========================================
// 1. 定義修仙境界與升級門檻 (取代舊版段位)
// ==========================================
const REALMS = [
    { name: '凡人', sub: '初入仙途', need: 0, emoji: '🌱' },
    { name: '煉氣', sub: '一層', need: 5, emoji: '🌬️' },
    { name: '煉氣', sub: '二層', need: 10, emoji: '🌬️' },
    { name: '煉氣', sub: '三層', need: 15, emoji: '🌬️' },
    { name: '煉氣', sub: '四層', need: 20, emoji: '🌬️' },
    { name: '煉氣', sub: '五層', need: 25, emoji: '🌬️' },
    { name: '煉氣', sub: '六層', need: 30, emoji: '🌬️' },
    { name: '煉氣', sub: '七層', need: 35, emoji: '🌬️' },
    { name: '煉氣', sub: '八層', need: 40, emoji: '🌬️' },
    { name: '煉氣', sub: '九層', need: 45, emoji: '🌬️' },
    { name: '築基', sub: '初期', need: 60, emoji: '🪨' },
    { name: '築基', sub: '中期', need: 80, emoji: '🪨' },
    { name: '築基', sub: '後期', need: 100, emoji: '🪨' },
    { name: '金丹', sub: '丹成一品', need: 120, emoji: '☀️' },
    { name: '元嬰', sub: '元嬰出竅', need: 500, emoji: '✨' },
    { name: '化神', sub: '神念通天', need: 800, emoji: '🔮' },
    { name: '煉虛', sub: '虛空悟道', need: 1200, emoji: '🌌' },
    { name: '合體', sub: '天地合一', need: 1800, emoji: '☯️' },
    { name: '大乘', sub: '大道將成', need: 2600, emoji: '⚡' },
    { name: '渡劫', sub: '雷劫問道', need: 3600, emoji: '⛈️' },
    { name: '真仙', sub: '踏入仙門', need: 5000, emoji: '🪽' }
];

function getRankName(level) {
    const idx = Math.min(level || 0, REALMS.length - 1);
    const r = REALMS[idx];
    return `${r.emoji} ${r.name} ${r.sub}`;
}

function calculateRankFromScore(totalScore) {
    let rank = 0;
    for (let i = REALMS.length - 1; i >= 0; i--) {
        if (totalScore >= REALMS[i].need) {
            rank = i;
            break;
        }
    }
    return rank;
}

// 綁定全域函式
window.googleLogin = () => { signInWithPopup(auth, provider).catch((error) => alert("Login Failed: " + error.code)); };
window.logout = () => { 
    localStorage.removeItem('currentQuiz');
    if (inviteUnsub) inviteUnsub(); // 登出時取消監聽
    if (systemUnsub) systemUnsub(); 
    if (chatUnsub) chatUnsub();
    signOut(auth).then(() => location.reload()); 
};

// ==========================================
// 🔐 登入狀態監聽 (核心邏輯)
// ==========================================
onAuthStateChanged(auth, async (user) => {
    // 先更新一次介面文字
    updateTexts();

    const userInfoEl = document.getElementById('user-info');

    if (user) {
        // 🔥【關鍵修正】登入後移除 data-i18n 屬性，防止 updateTexts() 把它覆蓋回 "未登入"
        if (userInfoEl) {
            userInfoEl.removeAttribute('data-i18n'); 
            userInfoEl.innerHTML = `<i class="fa-solid fa-user-astronaut"></i> ${user.displayName || '玩家'}`;
        }

        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('bottom-nav').classList.remove('hidden');
        document.getElementById('settings-email').innerText = user.email;

        injectSocialUI();

        const userRef = doc(db, "users", user.uid);
        try {
            const docSnap = await getDoc(userRef);
            
            if (docSnap.exists()) {
                currentUserData = docSnap.data();
                // 資料結構補全 (防呆)
                if (!currentUserData.inventory) currentUserData.inventory = [];
                if (!currentUserData.equipped) currentUserData.equipped = { frame: '', avatar: '' };
                if (!currentUserData.friends) currentUserData.friends = [];
                
                if (!currentUserData.friendCode) {
                    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
                    await updateDoc(userRef, { friendCode: code });
                    currentUserData.friendCode = code;
                }
            } else {
                // 新使用者初始化
                const code = Math.random().toString(36).substring(2, 8).toUpperCase();
                currentUserData = {
                    uid: user.uid, displayName: user.displayName, email: user.email,
                    profile: { educationLevel: "", strongSubjects: "", weakSubjects: "" },
                    inventory: [],
                    equipped: { frame: '', avatar: '' }, 
                    stats: { 
                        rankLevel: 0, currentStars: 0, totalScore: 0, gold: 0,
                        currentStreak: 0, bestStreak: 0, totalCorrect: 0, totalAnswered: 0
                    },
                    friends: [], 
                    friendCode: code, 
                    isAdmin: false
                };
                await setDoc(userRef, currentUserData);
            }

            // 啟動各項監聽服務
            startPresenceSystem();
            startInvitationListener(); 
            listenToSystemCommands();  
            
            updateUserAvatarDisplay();
            updateSettingsInputs();
            checkAdminRole(currentUserData.isAdmin);
            updateUIStats();

            // 根據資料完整度導向
            if (!currentUserData.profile.educationLevel || currentUserData.profile.educationLevel === "") {
                switchToPage('page-onboarding'); 
                document.getElementById('bottom-nav').classList.add('hidden'); 
            } else {
                switchToPage('page-home');
                fillBuffer(); 
            }

        } catch (error) { 
            console.error("Login Data Error:", error); 
            alert("資料載入失敗，請檢查網路"); 
        }
    } else {
        // 👋 登出狀態
        if (userInfoEl) {
            // 加回 data-i18n 屬性，讓它顯示翻譯的 "未登入"
            userInfoEl.setAttribute('data-i18n', 'not_logged_in');
            userInfoEl.innerText = t('not_logged_in');
        }

        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('bottom-nav').classList.add('hidden');
        
        // 登出時取消監聽，節省資源
        if (inviteUnsub) inviteUnsub();
        if (systemUnsub) systemUnsub();
        if (chatUnsub) chatUnsub();
    }
});

// ==========================================
//  Social & UI Injection (Tabbed Chat)
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
    btn.className = "nav-btn group w-full flex flex-col items-center justify-center h-full transition-all";
    btn.innerHTML = `<i class="fa-solid fa-users mb-1 text-lg group-hover:text-cyan-400 transition-colors"></i><span class="text-[10px]" data-i18n="nav_social">${t('nav_social')}</span>`;
    
    const settingsBtn = navGrid.lastElementChild;
    navGrid.insertBefore(btn, settingsBtn);

    const main = document.querySelector('main');
    const pageSocial = document.createElement('div');
    pageSocial.id = "page-social";
    pageSocial.className = "page-section hidden h-full flex flex-col"; 
    
    pageSocial.innerHTML = `
        <div class="sticky top-0 bg-slate-900/95 backdrop-blur-sm z-20 border-b border-slate-800">
            <h2 class="text-2xl font-bold text-cyan-400 flex items-center gap-2 p-4 pb-2">
                <i class="fa-solid fa-comments"></i> 社交中心
            </h2>
            
            <div class="flex px-4 gap-2 mb-2">
                <button onclick="switchSocialTab('friends')" id="tab-btn-friends" class="flex-1 py-2 text-xs font-bold rounded-lg transition-all bg-cyan-600 text-white shadow-lg">
                    <i class="fa-solid fa-user-group"></i> 好友
                </button>
                <button onclick="switchSocialTab('chat')" id="tab-btn-chat" class="flex-1 py-2 text-xs font-bold rounded-lg transition-all bg-slate-800 text-gray-400 hover:bg-slate-700">
                    <i class="fa-solid fa-earth-asia"></i> 全服聊天
                </button>
            </div>
        </div>

        <div id="section-friends" class="flex-1 overflow-y-auto p-4 pb-20">
            <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 mb-4">
                <div class="text-xs text-gray-400 mb-1">我的好友代碼</div>
                <div class="flex justify-between items-center">
                    <span class="text-2xl font-mono font-bold text-white tracking-widest" id="my-friend-code">...</span>
                    <button onclick="copyFriendCode()" class="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-white transition">複製</button>
                </div>
            </div>
            <div class="flex gap-2 mb-4">
                <input type="text" id="input-friend-code" placeholder="輸入代碼..." class="flex-1 bg-slate-900 border border-slate-600 text-white rounded-lg p-3 outline-none focus:border-cyan-500 uppercase">
                <button onclick="addFriend()" class="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white px-4 rounded-lg font-bold shadow-lg">
                    <i class="fa-solid fa-user-plus"></i>
                </button>
            </div>
            <div id="friend-list-container" class="space-y-3">
                <div class="text-center text-gray-500 py-10">${t('loading')}</div>
            </div>
        </div>

        <div id="section-chat" class="hidden flex-1 flex flex-col overflow-hidden relative pb-16">
            <div id="chat-messages" class="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
                <div class="text-center text-gray-500 text-xs py-4">歡迎來到全服聊天室 👋<br>請保持友善發言</div>
            </div>

            <div class="p-2 bg-slate-800 border-t border-slate-700 flex gap-2 items-center absolute bottom-0 w-full z-10">
                <input type="text" id="chat-input" maxlength="50" placeholder="說點什麼..." class="flex-1 bg-slate-900 border border-slate-600 text-white rounded-full px-4 py-2 text-sm outline-none focus:border-cyan-500" onkeypress="if(event.key==='Enter') sendChatMessage()">
                <button onclick="sendChatMessage()" class="bg-cyan-600 hover:bg-cyan-500 text-white w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition transform active:scale-95">
                    <i class="fa-solid fa-paper-plane"></i>
                </button>
            </div>
        </div>
    `;
    main.appendChild(pageSocial);
}

// 切換分頁 (好友/聊天)
window.switchSocialTab = (tab) => {
    const btnFriends = document.getElementById('tab-btn-friends');
    const btnChat = document.getElementById('tab-btn-chat');
    const secFriends = document.getElementById('section-friends');
    const secChat = document.getElementById('section-chat');

    if (tab === 'friends') {
        btnFriends.className = "flex-1 py-2 text-xs font-bold rounded-lg transition-all bg-cyan-600 text-white shadow-lg";
        btnChat.className = "flex-1 py-2 text-xs font-bold rounded-lg transition-all bg-slate-800 text-gray-400 hover:bg-slate-700";
        secFriends.classList.remove('hidden');
        secChat.classList.add('hidden');
        
        // 切回好友時，取消聊天室監聽以省流量
        if (chatUnsub) { chatUnsub(); chatUnsub = null; }
        loadFriendList();
    } else {
        btnChat.className = "flex-1 py-2 text-xs font-bold rounded-lg transition-all bg-cyan-600 text-white shadow-lg";
        btnFriends.className = "flex-1 py-2 text-xs font-bold rounded-lg transition-all bg-slate-800 text-gray-400 hover:bg-slate-700";
        secChat.classList.remove('hidden');
        secFriends.classList.add('hidden');
        
        // 啟用聊天室監聽
        listenToGlobalChat();
    }
};

// 監聽聊天訊息
function listenToGlobalChat() {
    if (chatUnsub) return; // 避免重複監聽

    const chatContainer = document.getElementById('chat-messages');
    const q = query(collection(db, "global_chat"), orderBy("timestamp", "desc"), limit(50));

    chatUnsub = onSnapshot(q, (snapshot) => {
        if(snapshot.size > 0 && chatContainer.innerHTML.includes('歡迎來到全服聊天室')) {
            chatContainer.innerHTML = '';
        }

        const messages = [];
        snapshot.forEach(doc => messages.push({id: doc.id, ...doc.data()}));
        messages.reverse(); // 轉成 舊 -> 新

        chatContainer.innerHTML = '';
        messages.forEach(msg => {
            renderChatMessage(msg, chatContainer);
        });

        // 自動捲動到底部
        chatContainer.scrollTop = chatContainer.scrollHeight;
    });
}

function renderChatMessage(msg, container) {
    const isMe = auth.currentUser && msg.uid === auth.currentUser.uid;
    const div = document.createElement('div');
    div.className = `flex gap-3 mb-4 ${isMe ? 'flex-row-reverse' : ''}`;
    
    // 頭像
    const equipped = { frame: msg.frame || '', avatar: msg.avatar || '' };
    const avatarHtml = getAvatarHtml(equipped, "w-8 h-8");
    const rankName = getRankName(msg.rankLevel || 0);
    const time = msg.timestamp ? new Date(msg.timestamp.toMillis()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...';

    div.innerHTML = `
        <div class="flex-shrink-0 flex flex-col items-center">
            ${avatarHtml}
        </div>
        <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[75%]">
            <div class="flex items-baseline gap-2 mb-1">
                <span class="text-[10px] text-yellow-500 font-mono border border-yellow-500/30 px-1 rounded bg-black/20">${rankName}</span>
                <span class="text-xs text-gray-400 font-bold">${msg.displayName}</span>
            </div>
            <div class="px-4 py-2 rounded-2xl text-sm break-words relative shadow-md ${isMe ? 'bg-cyan-600 text-white rounded-tr-none' : 'bg-slate-700 text-gray-200 rounded-tl-none'}">
                ${escapeHtml(msg.text)}
                <span class="text-[9px] opacity-50 absolute bottom-0.5 ${isMe ? 'left-[-30px]' : 'right-[-30px]'} w-8 text-center">${time}</span>
            </div>
        </div>
    `;
    container.appendChild(div);
}

window.sendChatMessage = async () => {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    if (!auth.currentUser) return alert("請先登入");

    input.value = ''; 

    try {
        await addDoc(collection(db, "global_chat"), {
            uid: auth.currentUser.uid,
            displayName: currentUserData.displayName,
            avatar: currentUserData.equipped?.avatar || '',
            frame: currentUserData.equipped?.frame || '',
            rankLevel: currentUserData.stats?.rankLevel || 0,
            text: text,
            timestamp: serverTimestamp()
        });
    } catch (e) {
        console.error("Send Error:", e);
        alert("發送失敗");
    }
};

function escapeHtml(text) {
    if (!text) return text;
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
// 新增：將 Markdown 圖片語法 ![alt](url) 轉換為 HTML <img>，並處理換行
function parseMarkdownImages(text) {
    if (!text) return text;

    // 1. 🔥 修改：先將換行符號 (\n) 轉換為 <br>
    let processedText = text.replace(/\n/g, '<br>');

    // 2. 匹配 ![alt](url) 格式
    const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    
    return processedText.replace(markdownImageRegex, (match, alt, url) => {
        // 回傳圖片的 HTML 結構 (移除樣板字串中的換行，保持整潔)
        return `<div class="my-3 rounded-lg overflow-hidden border border-white/10 shadow-lg bg-black/20"><img src="${url}" alt="${alt}" class="w-full h-auto block" onerror="this.parentElement.innerHTML='<p class=\'p-2 text-xs text-red-400\'>圖片載入失敗: ${url}</p>'"></div>`;
    });
}

window.copyFriendCode = () => {
    const code = document.getElementById('my-friend-code').innerText;
    navigator.clipboard.writeText(code).then(() => alert("Copied!"));
};

window.addFriend = async () => {
    const input = document.getElementById('input-friend-code');
    const targetCode = input.value.trim().toUpperCase();
    if (!targetCode) return alert("Please enter code");
    if (targetCode === currentUserData.friendCode) return alert("Cannot add yourself");

    const btn = document.querySelector('button[onclick="addFriend()"]');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
        const q = query(collection(db, "users"), where("friendCode", "==", targetCode));
        const snap = await getDocs(q);
        if (snap.empty) {
            alert("Code not found");
            btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus"></i>';
            return;
        }
        const targetUserDoc = snap.docs[0];
        const targetUserId = targetUserDoc.id;
        const targetUserData = targetUserDoc.data();

        if (currentUserData.friends.includes(targetUserId)) {
            alert("Already friends!");
            btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus"></i>';
            return;
        }

        await runTransaction(db, async (transaction) => {
            const myRef = doc(db, "users", auth.currentUser.uid);
            const friendRef = doc(db, "users", targetUserId);
            transaction.update(myRef, { friends: arrayUnion(targetUserId) });
            transaction.update(friendRef, { friends: arrayUnion(auth.currentUser.uid) });
        });

        currentUserData.friends.push(targetUserId);
        alert(`Added ${targetUserData.displayName}!`);
        input.value = "";
        loadFriendList();
    } catch (e) {
        console.error(e);
        alert("Error: " + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-user-plus"></i>';
    }
};

function startPresenceSystem() {
    if (presenceInterval) clearInterval(presenceInterval);
    const updatePresence = async () => {
        if (!auth.currentUser) return;
        try {
            await updateDoc(doc(db, "users", auth.currentUser.uid), { lastActive: serverTimestamp() });
        } catch (e) { console.error("Presence update failed", e); }
    };
    updatePresence();
    presenceInterval = setInterval(updatePresence, 60 * 1000);
}

window.loadFriendList = async () => {
    const container = document.getElementById('friend-list-container');
    const myCodeEl = document.getElementById('my-friend-code');
    if (currentUserData && currentUserData.friendCode) myCodeEl.innerText = currentUserData.friendCode;

    if (!currentUserData.friends || currentUserData.friends.length === 0) {
        container.innerHTML = `<div class="text-center py-10 opacity-50"><i class="fa-solid fa-user-group text-4xl mb-3"></i><p>${t('loading')}...</p></div>`;
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
            const statusHtml = isOnline ? `<span class="text-green-400 text-xs flex items-center gap-1"><div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div> Online</span>` : `<span class="text-gray-500 text-xs">Offline (${getTimeAgo(lastActive)})</span>`;
            
            const div = document.createElement('div');
            div.className = "bg-slate-800/50 p-3 rounded-xl border border-slate-700 flex items-center gap-3";
            div.innerHTML = `
                ${getAvatarHtml(fData.equipped, "w-12 h-12")}
                <div class="flex-1">
                    <div class="flex justify-between items-center">
                        <span class="font-bold text-white">${fData.displayName}</span>
                        <span class="text-xs text-yellow-500 font-mono">${getRankName(fData.stats?.rankLevel || 0)}</span>
                    </div>
                    <div class="flex justify-between items-center mt-1">
                        ${statusHtml}
                        <span class="text-[10px] text-gray-500">Pts: ${fData.stats?.totalScore || 0}</span>
                    </div>
                </div>
            `;
            container.appendChild(div);
        });
    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="text-red-400 text-center">Load Failed</div>';
    }
};

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds > 86400) return Math.floor(seconds/86400) + "d ago";
    if (seconds > 3600) return Math.floor(seconds/3600) + "h ago";
    if (seconds > 60) return Math.floor(seconds/60) + "m ago";
    return "Just now";
}

// 修改原本的 switchToPage
window.switchToPage = (pageId) => {
    if (isBattleActive && pageId !== 'page-battle') {
        alert("Battle in progress!");
        return;
    }
    
    if (pageId !== 'page-social' && chatUnsub) {
        chatUnsub();
        chatUnsub = null;
    }

    document.querySelectorAll('.page-section').forEach(el => { el.classList.remove('active-page', 'hidden'); el.classList.add('hidden'); });
    const target = document.getElementById(pageId);
    if(target) { target.classList.remove('hidden'); target.classList.add('active-page'); }
    
    document.querySelectorAll('.nav-btn').forEach(btn => {
        // 先移除所有人的發光狀態
        btn.classList.remove('active-nav-btn');
        
        // 只有目標頁面的按鈕加上發光狀態
        if (btn.dataset.target === pageId) {
            btn.classList.add('active-nav-btn');
        }
    });
    
    document.querySelectorAll('#nav-grid button').forEach(btn => {
        if(isBattleActive) btn.classList.add('nav-locked');
        else btn.classList.remove('nav-locked');

        if (btn.dataset.target === pageId) { 
            btn.classList.add('text-white'); 
            btn.classList.remove('text-gray-400');
            if (pageId === 'page-social') btn.querySelector('i').className = "fa-solid fa-users mb-1 text-lg text-cyan-400 transition-colors";
        } else { 
            btn.classList.remove('text-white'); 
            btn.classList.add('text-gray-400'); 
            if (btn.dataset.target === 'page-social') btn.querySelector('i').className = "fa-solid fa-users mb-1 text-lg group-hover:text-cyan-400 transition-colors";
        }
    });
    
    // --- 修改這裡 ---
    if (pageId === 'page-settings') { 
        renderInventory(); 
        if (window.renderKnowledgeGraph) window.renderKnowledgeGraph(); // 渲染圖譜
    }
    
    // 🔥 加上這段：切換到紀錄頁面時，載入答題歷史
    if (pageId === 'page-history') {
        loadUserHistory();
    }
    // ----------------
    
    if (pageId === 'page-admin') loadAdminData();
    if (pageId === 'page-social') {
        switchSocialTab('friends');
    }
    
    updateTexts();
};

window.updateUIStats = updateUIStats; // 🔥 新增：將函式暴露給全域，讓修仙規則可以呼叫它來刷新畫面
function updateUIStats() {
    if(!currentUserData) return;
    const stats = currentUserData.stats;
    
    const currentScore = stats.totalScore || 0;
    const realRankLevel = calculateRankFromScore(currentScore);
    
    if (stats.rankLevel !== realRankLevel) { stats.rankLevel = realRankLevel; }
    
    if(typeof stats.currentStreak === 'undefined') stats.currentStreak = 0;
    if(typeof stats.bestStreak === 'undefined') stats.bestStreak = 0;
    if(typeof stats.totalCorrect === 'undefined') stats.totalCorrect = 0;
    if(typeof stats.totalAnswered === 'undefined') stats.totalAnswered = 0;

    const rankIndex = Math.min(stats.rankLevel, REALMS.length - 1);
    const currentRealm = REALMS[rankIndex];
    const rankEl = document.getElementById('display-rank');
    rankEl.innerText = getRankName(stats.rankLevel); 
    rankEl.className = `text-5xl font-black mb-2 text-white`;

    let progressPercent = 100;
    let currentStarsDisplay = 10;
    let maxStarsDisplay = 10;

    if (rankIndex < REALMS.length - 1) {
        const currentBase = currentRealm.need;
        const nextBase = REALMS[rankIndex + 1].need;
        const required = nextBase - currentBase;
        const earned = currentScore - currentBase;
        progressPercent = Math.max(0, Math.min((earned / required) * 100, 100));
        currentStarsDisplay = Math.max(0, earned);
        maxStarsDisplay = required;
    } else {
        currentStarsDisplay = currentScore - currentRealm.need;
        maxStarsDisplay = "∞";
        progressPercent = 100;
    }

    const starValEl = document.getElementById('display-stars');
    if (starValEl) {
        starValEl.innerText = currentStarsDisplay;
        const parentSpan = starValEl.parentElement;
        if (parentSpan) {
            parentSpan.innerHTML = `<span id="display-stars" class="text-yellow-400 font-bold text-sm">${currentStarsDisplay}</span> <span class="text-xs opacity-50">/ ${maxStarsDisplay}</span>`;
        }
    }
    
    document.getElementById('display-score').innerText = stats.totalScore;

    // 面板與主題輪詢都使用同一份 currentUserData，避免短暫更新後跳回舊值。
    window.dispatchEvent(new CustomEvent('xiuxian:stats-updated', {
        detail: {
            uid: currentUserData.uid,
            totalScore: Number(stats.totalScore) || 0,
            currentStreak: stats.currentStreak,
            stats
        }
    }));

    const storePts = document.getElementById('store-user-points');
    if(storePts) storePts.innerText = stats.gold || 0;
    
    const cardPts = document.getElementById('cards-user-points');
    if(cardPts) cardPts.innerText = stats.gold || 0;

    document.getElementById('display-streak').innerText = stats.currentStreak;
    document.getElementById('display-best-streak').innerText = stats.bestStreak;
    
    const accuracy = stats.totalAnswered > 0 ? ((stats.totalCorrect / stats.totalAnswered) * 100).toFixed(1) : "0.0";
    document.getElementById('display-accuracy').innerText = accuracy + "%";
    
    setTimeout(() => { 
        const pb = document.getElementById('progress-bar');
        if (pb) pb.style.width = `${progressPercent}%`; 
    }, 100);
}

function buildPathTree(paths) {
    const tree = { name: "root", children: {} };
    paths.forEach(path => {
        const parts = path.split('/');
        let current = tree;
        parts.forEach((part, index) => {
            if (!current.children[part]) {
                current.children[part] = { name: part, type: index === parts.length - 1 ? 'file' : 'folder', fullPath: index === parts.length - 1 ? path : null, children: {} };
            }
            current = current.children[part];
        });
    });
    return tree;
}
function countJsonFiles(node) {
    if (node.type === 'file') return 1;
    let count = 0;
    for (const key in node.children) count += countJsonFiles(node.children[key]);
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
        defaultOpt.innerText = level === 0 ? "-- Mode --" : "-- Category --";
        defaultOpt.disabled = true;
        if (!selectedParts[level]) defaultOpt.selected = true;
        select.appendChild(defaultOpt);

        if (level === 0) {
            const aiOpt = document.createElement('option');
            aiOpt.value = "ai";
            aiOpt.innerText = "✨ AI Random";
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
                hint.innerText = "Mode: AI";
                hint.className = "text-xs text-green-400 mt-1";
                renderCascadingSelectors(tree, 'ai');
            } else {
                const nextNode = currentNode.children[val];
                let hasSubFolders = false;
                if (nextNode.type === 'folder') {
                    for (const childKey in nextNode.children) { if (nextNode.children[childKey].type === 'folder') { hasSubFolders = true; break; } }
                }
                if (nextNode.type === 'file') {
                    hiddenInput.value = currentFullPath;
                    hint.innerText = `✅ Selected: ${val.replace('.json', '')}`;
                    hint.className = "text-xs text-green-400 mt-1";
                    renderCascadingSelectors(tree, currentFullPath);
                } else if (hasSubFolders) {
                    hiddenInput.value = "";
                    hint.innerText = "⚠️ Select next category...";
                    hint.className = "text-xs text-yellow-500 mt-1";
                    renderCascadingSelectors(tree, newParts.join('/'));
                } else {
                    hiddenInput.value = currentFullPath;
                    const count = countJsonFiles(nextNode);
                    hint.innerText = `📂 Folder: ${val} (${count} quizzes)`;
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

window.toggleSourceMode = () => {
    const mode = document.getElementById('set-source-mode').value;
    const bankContainer = document.getElementById('bank-source-container');
    const focusedContainer = document.getElementById('focused-source-container');
    
    if (mode === 'bank') {
        bankContainer.classList.remove('hidden');
        focusedContainer.classList.add('hidden');
    } else if (mode === 'focused') {
        bankContainer.classList.add('hidden');
        focusedContainer.classList.remove('hidden');
    } else {
        bankContainer.classList.add('hidden');
        focusedContainer.classList.add('hidden');
    }
};

async function updateSettingsInputs() {
    if (currentUserData && currentUserData.profile) {
        document.getElementById('set-display-name').value = currentUserData.displayName || "";
        document.getElementById('set-level').value = currentUserData.profile.educationLevel || "國中一年級";
        document.getElementById('set-strong').value = currentUserData.profile.strongSubjects || "";
        document.getElementById('set-weak').value = currentUserData.profile.weakSubjects || "";
        
        const settings = currentUserData.gameSettings || { sourceMode: 'random', source: 'ai', difficulty: 'medium', focusedUnits: [] };
        
        const diffSelect = document.getElementById('set-difficulty');
        if(diffSelect) diffSelect.value = settings.difficulty || 'auto';
        
        const sourceModeSelect = document.getElementById('set-source-mode');
        if(sourceModeSelect) {
            sourceModeSelect.value = settings.sourceMode || 'random';
            window.toggleSourceMode();
        }

        // 初始化題庫選擇
        const hiddenInput = document.getElementById('set-source-final-value');
        const hint = document.getElementById('bank-selection-hint');
        if (hiddenInput) {
            hiddenInput.value = settings.source || 'ai';
            if(settings.source === 'ai') {
                hint.innerText = "Mode: AI";
                hint.className = "text-xs text-green-400 mt-1";
            } else {
                hint.innerText = `Selected: ${(settings.source||'').replace('.json', '')}`;
                hint.className = "text-xs text-blue-400 mt-1";
            }
            try {
                const res = await fetch('/api/banks');
                const data = await res.json();
                if (data.files && Array.isArray(data.files)) {
                    allBankFiles = data.files;
                    const tree = buildPathTree(data.files);
                    renderCascadingSelectors(tree, settings.source || 'ai');
                }
            } catch (e) { console.error("Error loading banks", e); }
        }

        // 初始化專注練習清單
        window.soloSelectedUnits = settings.focusedUnits || [];
        window.renderSelectedUnitsList();
        try {
            const res = await fetch('/api/units');
            const data = await res.json();
            if (data.files && Array.isArray(data.files)) {
                const tree = buildPathTree(data.files);
                renderSoloUnitSelectors(tree, "");
            }
        } catch (e) {
            console.error("Failed to load units", e);
        }
    }
}

async function getCleanSubjects(rawText) {
    if (!rawText) return "";
    try {
        const response = await fetch('/api/analyze-subjects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: rawText }) });
        const data = await response.json();
        return data.subjects;
    } catch (e) { return rawText; }
}

window.submitOnboarding = async () => {
    const level = document.getElementById('ob-level').value;
    const rawStrong = document.getElementById('ob-strong').value;
    const rawWeak = document.getElementById('ob-weak').value;
    if(!level) { alert("Please select level"); return; }
    const btn = document.querySelector('button[onclick="submitOnboarding()"]');
    btn.innerText = "Processing..."; btn.disabled = true;
    const cleanStrong = await getCleanSubjects(rawStrong);
    const cleanWeak = await getCleanSubjects(rawWeak);
    await updateDoc(doc(db, "users", auth.currentUser.uid), { "profile.educationLevel": level, "profile.strongSubjects": cleanStrong, "profile.weakSubjects": cleanWeak });
    currentUserData.profile.educationLevel = level; currentUserData.profile.strongSubjects = cleanStrong; currentUserData.profile.weakSubjects = cleanWeak;
    updateSettingsInputs(); updateUIStats(); switchToPage('page-home'); document.getElementById('bottom-nav').classList.remove('hidden'); localStorage.removeItem('currentQuiz'); quizBuffer = []; fillBuffer(); btn.innerText = "Go! 🚀"; btn.disabled = false;
};

window.saveProfile = async () => {
    const displayName = document.getElementById('set-display-name').value.trim();
    const level = document.getElementById('set-level').value;
    const rawStrong = document.getElementById('set-strong').value;
    const rawWeak = document.getElementById('set-weak').value;
    const sourceMode = document.getElementById('set-source-mode').value;
    const source = document.getElementById('set-source-final-value').value; 
    const difficulty = document.getElementById('set-difficulty').value;

    if (!displayName) { alert("名稱不能為空！"); return; }
    if (sourceMode === 'bank' && (!source || source === 'ai')) { alert("請選擇題庫檔案！"); return; }
    if (sourceMode === 'focused' && (!window.soloSelectedUnits || window.soloSelectedUnits.length === 0)) { alert("請至少加入一個單元！"); return; }

    const btn = document.querySelector('button[onclick="saveProfile()"]');
    btn.innerText = "Saving..."; btn.disabled = true;
    
    const cleanStrong = await getCleanSubjects(rawStrong);
    const cleanWeak = await getCleanSubjects(rawWeak);
    document.getElementById('set-strong').value = cleanStrong;
    document.getElementById('set-weak').value = cleanWeak;
    
    const newSettings = { 
        sourceMode: sourceMode, 
        source: source, 
        difficulty: difficulty,
        focusedUnits: [...(window.soloSelectedUnits || [])]
    };

    await updateDoc(doc(db, "users", auth.currentUser.uid), { 
        "displayName": displayName,
        "profile.educationLevel": level, 
        "profile.strongSubjects": cleanStrong, 
        "profile.weakSubjects": cleanWeak, 
        "gameSettings": newSettings 
    });
    
    currentUserData.displayName = displayName;
    currentUserData.profile.educationLevel = level; 
    currentUserData.profile.strongSubjects = cleanStrong; 
    currentUserData.profile.weakSubjects = cleanWeak; 
    currentUserData.gameSettings = newSettings;
    
    // 更新畫面上方顯示的名稱
    const userInfoEl = document.getElementById('user-info');
    if (userInfoEl) userInfoEl.innerHTML = `<i class="fa-solid fa-user-astronaut"></i> ${displayName}`;

    currentBankData = null; 
    localStorage.removeItem('currentQuiz'); 
    quizBuffer = []; 
    fillBuffer();
    
    btn.innerText = "Saved!"; 
    setTimeout(() => { btn.innerHTML = `UPDATE SYSTEM`; btn.disabled = false; }, 2000);
};

async function switchToAI() {
    await updateDoc(doc(db, "users", auth.currentUser.uid), { "gameSettings.sourceMode": 'random' });
    currentUserData.gameSettings.sourceMode = 'random';
    const sm = document.getElementById('set-source-mode');
    if(sm) { sm.value = 'random'; toggleSourceMode(); }
    return fetchOneQuestion(); 
}

// ==========================================
//  出題核心 (AI / 題庫 - 支援資料夾混合)
// ==========================================
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// [新增] 智慧難度判斷邏輯
function getSmartDifficulty() {
    if (!currentUserData || !currentUserData.stats) return 'easy';

    const rank = currentUserData.stats.rankLevel || 0;
    const streak = currentUserData.stats.currentStreak || 0;
    
    // 1. 基礎難度 (依照段位)
    // 0-1 (青銅/白銀): easy
    // 2-4 (黃金/鑽石/星耀): medium
    // 5+ (大師以上): hard
    let baseDiff = 'easy';
    if (rank >= 5) baseDiff = 'hard';
    else if (rank >= 2) baseDiff = 'medium';

    // 2. 連勝加成 (Streak Bonus)
    // 如果連對 3 題以上，強迫提升一級難度 (挑戰時刻)
    if (streak >= 3) {
        if (baseDiff === 'easy') return 'medium';
        if (baseDiff === 'medium') return 'hard';
        return 'hard'; // 已經是 hard 就維持
    }

    return baseDiff;
}

async function fillBuffer() {
    if (isFetchingBuffer || quizBuffer.length >= BUFFER_SIZE) return;
    isFetchingBuffer = true;
    try {
        while (quizBuffer.length < BUFFER_SIZE) {
            const question = await fetchOneQuestion();
            quizBuffer.push(question);
        }
    } catch (e) { console.warn("Background fetch failed", e); } finally { isFetchingBuffer = false; }
}

// ==========================================
//  Quiz UI Logic
// ==========================================
window.startQuizFlow = async (isNewSession = false) => {
    if (!soloSession.active && !isNewSession) {
        // 直接默認啟動無限模式
        soloSession = {
            active: true,
            mode: 'infinite',
            correctCount: 0,
            wrongCount: 0,
            history: []
        };
    }

    switchToPage('page-quiz');
    
    document.getElementById('quiz-container').classList.add('hidden');
    document.getElementById('feedback-section').classList.add('hidden');
    document.getElementById('btn-giveup').classList.remove('hidden');

    const progressPanel = document.getElementById('solo-progress-panel');
    if (progressPanel) {
        progressPanel.classList.remove('hidden');
        document.getElementById('solo-correct-count').innerText = soloSession.correctCount;
        document.getElementById('solo-wrong-count').innerText = soloSession.wrongCount;
    }

    window.quizStartTime = Date.now(); 

    if (quizBuffer.length > 0) { 
        const nextQ = quizBuffer.shift(); 
        window.currentActiveQuiz = nextQ; 
        renderQuiz(nextQ.data, nextQ.rank, nextQ.badge); 
        fillBuffer(); 
    } else {
        document.getElementById('quiz-loading').classList.remove('hidden');
        document.getElementById('loading-text').innerText = t('loading_text');
        try { 
            const q = await fetchOneQuestion(); 
            window.currentActiveQuiz = q; 
            renderQuiz(q.data, q.rank, q.badge); 
            fillBuffer(); 
        } catch (e) { 
            console.error(e); 
            alert("Failed to start"); 
            switchToPage('page-home'); 
        }
    }
};

// ==========================================
// 🆕 單人模式選擇與啟動邏輯
// ==========================================

// ==========================================
// 🆕 單人模式選擇與啟動邏輯 (支援複選與資料夾)
// ==========================================

//🔥 全域變數新增：儲存已選清單與目前正在瀏覽的項目
window.soloSelectedUnits = []; 
window.currentBrowsingUnit = null; 
window.soloSelectedUnitDetail = ""; 

//🔥 修改：國中單元多階層遞迴選擇器，全面支援新版學科 JSON 結構 (如 chinese.json, english.json)
window.renderSoloUnitSelectors = async (tree, currentPath) => {
    const container = document.getElementById('solo-unit-selectors-container');
    const hint = document.getElementById('solo-unit-hint');
    const btnAdd = document.getElementById('btn-add-unit');
    if (!container) return;
    
    container.innerHTML = ''; 
    let selectedParts = currentPath ? currentPath.split('/') : [];

    const createSelect = async (level, currentNode) => {
        const select = document.createElement('select');
        select.className = "w-full bg-slate-900/50 border border border-slate-600 text-white rounded-lg p-2 text-xs outline-none focus:border-cyan-500 mb-2 cursor-pointer";
        
        const defaultOpt = document.createElement('option');
        defaultOpt.value = "";
        defaultOpt.innerText = level === 0 ? "-- 選擇學科 --" : "-- 選擇學期/章節 --";
        defaultOpt.disabled = true;
        if (!selectedParts[level]) defaultOpt.selected = true;
        select.appendChild(defaultOpt);

        Object.keys(currentNode.children).forEach(key => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.innerText = key.replace('.json', '');
            if (selectedParts[level] === key) opt.selected = true;
            select.appendChild(opt);
        });

        select.onchange = (e) => {
            const val = e.target.value;
            const newParts = selectedParts.slice(0, level);
            newParts.push(val);
            const newPath = newParts.join('/');
            
            window.soloSelectedUnitDetail = ""; 
            window.currentBrowsingUnit = { path: newPath, detail: "", sub_topics: [] }; 
            
            hint.innerText = `✅ 目錄：${newPath.replace('.json', '')}`;
            hint.className = "text-[10px] text-cyan-400 font-mono truncate max-w-[200px] inline-block";
            btnAdd.classList.remove('hidden');

            renderSoloUnitSelectors(tree, newPath);
        };
        container.appendChild(select);

        const currentVal = selectedParts[level];
        if (currentVal && currentNode.children[currentVal]) {
            const nextNode = currentNode.children[currentVal];
            if (nextNode.type === 'file') {
                await renderInnerUnitSelect(nextNode.fullPath);
            } else {
                await createSelect(level + 1, nextNode);
            }
        }
    };

    //🔥 內部優化函式：支援讀取全新結構化的國文、英文、數學等學科 JSON 檔
    async function renderInnerUnitSelect(filePath) {
        try {
            const res = await fetch(`/middle_school_unit_name/${filePath}`);
            if (!res.ok) throw new Error("File not found");
            const units = await res.json();

            const select = document.createElement('select');
            select.className = "w-full bg-slate-900/50 border border border-cyan-500/50 text-cyan-200 rounded-lg p-2 text-xs outline-none mb-2 animate-pulse cursor-pointer";
            const defaultOpt = document.createElement('option');
            defaultOpt.value = "";
            defaultOpt.innerText = "-- 選擇具體單元 (選填) --";
            defaultOpt.selected = !window.soloSelectedUnitDetail;
            select.appendChild(defaultOpt);

            //🔥 同步支援兩種格式：舊版物件陣列 [{name: 'xxx'}] 與 新版具有主鍵的單元結構
            units.forEach(u => {
                const opt = document.createElement('option');
                // 兼容 u.name (舊版) 或 u.unit / u.title (全新版本結構)
                const unitName = u.name || u.unit || u.title || (typeof u === 'string' ? u : "");
                if (!unitName) return;

                opt.value = unitName;
                opt.innerText = unitName;
                if (window.soloSelectedUnitDetail === unitName) opt.selected = true;
                select.appendChild(opt);
            });

            select.onchange = (e) => {
                const val = e.target.value;
                if (!val) {
                    window.soloSelectedUnitDetail = "";
                    window.currentBrowsingUnit = { path: filePath, detail: "", sub_topics: [] };
                    hint.innerText = `✅ 目錄：${filePath.replace('.json', '')}`;
                } else {
                    window.soloSelectedUnitDetail = val;
                    // 尋找對應的單元物件以抓取對應的知識點 (details 或 sub_topics)
                    const selectedUnit = units.find(u => (u.name === val || u.unit === val || u.title === val));
                    //🔥 智慧映射：將新版 JSON 的 details 欄位自動映射為前端出題所需的 sub_topics
                    const rawTopics = selectedUnit ? (selectedUnit.sub_topics || selectedUnit.details || []) : [];
                    
                    window.currentBrowsingUnit = { 
                        path: filePath, 
                        detail: val, 
                        sub_topics: Array.isArray(rawTopics) ? rawTopics : [rawTopics]
                    };
                    hint.innerText = `✅ 單元：${val}`;
                }
                hint.className = "text-[10px] text-green-400 font-mono truncate max-w-[200px] inline-block";
                btnAdd.classList.remove('hidden');
            };
            container.appendChild(select);
        } catch (e) {
            console.error("[JSON-Error] 讀取學科單元檔案失敗:", e);
        }
    }
    await createSelect(0, tree);
};

//🔥 新增：加入選定項目至清單
window.addCurrentUnitToSelection = () => {
    if (!window.currentBrowsingUnit) return;
    if (!window.soloSelectedUnits) window.soloSelectedUnits = [];
    
    // 檢查是否已存在
    const exists = window.soloSelectedUnits.some(u => 
        u.path === window.currentBrowsingUnit.path && 
        u.detail === window.currentBrowsingUnit.detail
    );
    if (exists) {
        alert("這個單元/目錄已經在清單中了！");
        return;
    }
    
    window.soloSelectedUnits.push({ ...window.currentBrowsingUnit });
    window.renderSelectedUnitsList();
    
    // 視覺反饋
    const btn = document.getElementById('btn-add-unit');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> 成功';
    btn.classList.add('bg-green-500');
    setTimeout(() => {
        btn.innerHTML = originalText;
        btn.classList.remove('bg-green-500');
    }, 1000);
};

//🔥 新增：從清單移除項目
window.removeSelectedUnit = (index) => {
    window.soloSelectedUnits.splice(index, 1);
    window.renderSelectedUnitsList();
};

//🔥 新增：渲染已選清單 UI
window.renderSelectedUnitsList = () => {
    const list = document.getElementById('solo-selected-units-list');
    if (!list) return;
    
    if (!window.soloSelectedUnits || window.soloSelectedUnits.length === 0) {
        list.innerHTML = '<div class="text-[10px] text-gray-500 text-center py-2 border border-dashed border-gray-600 rounded">尚未選擇，請在上方選取後點擊「加入」</div>';
        return;
    }
    
    list.innerHTML = '';
    window.soloSelectedUnits.forEach((unit, idx) => {
        const div = document.createElement('div');
        div.className = "flex justify-between items-center bg-slate-700/60 px-2 py-1.5 rounded border border-slate-600 mb-1 group hover:bg-slate-600 transition-colors";
        
        let label = unit.detail 
            ? `<span class="text-gray-400">[${unit.path.replace('.json', '')}]</span> <span class="text-cyan-200">${unit.detail}</span>` 
            : `<span class="text-cyan-200">📂 ${unit.path.replace('.json', '')} <span class="text-[9px] text-gray-400">(整個目錄)</span></span>`;
        
        div.innerHTML = `
            <div class="text-[10px] truncate w-[90%]" title="${unit.detail || unit.path}">${label}</div>
            <button onclick="removeSelectedUnit(${idx})" class="text-gray-500 hover:text-red-400 transition-colors px-1">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;
        list.appendChild(div);
    });
};

async function fetchOneQuestion() {
    const settings = currentUserData.gameSettings || { sourceMode: 'random', source: 'ai', difficulty: 'auto', focusedUnits: [] };
    const rankName = getRankName(currentUserData.stats.rankLevel || 0);
    let finalDifficulty = settings.difficulty;
    if (!finalDifficulty || finalDifficulty === 'auto') {
        finalDifficulty = getSmartDifficulty();
    }

    const sourceMode = settings.sourceMode || 'random';

    // 1. 專注練習 (AI)
    if (sourceMode === 'focused' && settings.focusedUnits && settings.focusedUnits.length > 0) {
        const randomUnit = settings.focusedUnits[Math.floor(Math.random() * settings.focusedUnits.length)];
        const parts = randomUnit.path.split('/');
        const subject = parts[0]; 
        
        let targetTopic = randomUnit.detail || randomUnit.path.replace('.json', '');
        if (randomUnit.sub_topics && randomUnit.sub_topics.length > 0) {
            targetTopic += ` (核心考點細項：${randomUnit.sub_topics.join('、')})`;
        }

        const weakSubjects = (currentUserData.profile.weakSubjects || "").split(',').map(s => s.trim());
        if (weakSubjects.includes(subject)) finalDifficulty = "easy";

        console.log(`[AI-專注出題] 學科: ${subject} | 範圍: ${targetTopic} | 難度: ${finalDifficulty}`);

        try {
            const response = await fetch("/api/generate-quiz", {
                method: "POST", 
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    subject: subject, 
                    specificTopic: targetTopic, 
                    level: currentUserData.profile.educationLevel || "國中", 
                    rank: rankName, 
                    difficulty: finalDifficulty,
                    language: currentLang,
                    knowledgeMap: currentUserData.stats.knowledgeMap || {} 
                })
            });
            if (!response.ok) throw new Error(`Server Error: ${response.status}`);
            const data = await response.json();
            let aiText = data.text;
            const jsonMatch = aiText.match(/\{[\s\S]*\}/);
            if (jsonMatch) aiText = jsonMatch[0];
            const rawData = JSON.parse(aiText);

            let allOptions = shuffleArray([rawData.correct, ...rawData.wrong]);
            return {
                data: { q: rawData.q, opts: allOptions, ans: allOptions.indexOf(rawData.correct), exp: rawData.exp },
                rank: rankName,
                badge: `🎯 ${subject} | ${rawData.sub_topic || '精選'}`
            };
        } catch (e) {
            console.error("[AI-出題失敗]", e);
            throw e;
        }
    } 
    // 2. 題庫練習 (原本的 file based)
    else if (sourceMode === 'bank') {
        let targetSource = settings.source; 
        if (!currentBankData || currentBankData.sourcePath !== targetSource) {
            let filesToFetch = [];
            if (targetSource && targetSource.endsWith('.json')) { 
                filesToFetch = [targetSource]; 
            } else if (targetSource && targetSource !== 'ai') {
                if (allBankFiles.length === 0) {
                    try { 
                        const res = await fetch('/api/banks'); 
                        const data = await res.json(); 
                        allBankFiles = data.files || []; 
                    } catch (e) { console.error(e); }
                }
                filesToFetch = allBankFiles.filter(f => f.startsWith(targetSource + '/'));
                if (filesToFetch.length === 0) return await switchToAI();
            } else {
                return await switchToAI();
            }

            try {
                const fetchPromises = filesToFetch.map(filePath => 
                    fetch(`/banks/${filePath}?t=${Date.now()}`)
                        .then(res => { if (!res.ok) throw new Error(); return res.json(); })
                        .catch(err => [])
                );
                const results = await Promise.all(fetchPromises);
                const mergedQuestions = results.flat();
                if (mergedQuestions.length === 0) throw new Error("No questions");
                currentBankData = { sourcePath: targetSource, questions: mergedQuestions };
            } catch (e) { 
                console.error("[Fetch-Bank-Error] 題庫讀取失敗:", e); 
                return await switchToAI(); 
            }
        }

        const filteredQuestions = currentBankData.questions.filter(q => q.difficulty === finalDifficulty);
        const pool = filteredQuestions.length > 0 ? filteredQuestions : currentBankData.questions;
        const rawData = pool[Math.floor(Math.random() * pool.length)];
        let allOptions = shuffleArray([rawData.correct, ...rawData.wrong]);
        let displaySubject = rawData.subject || settings.source.split('/').pop().replace('.json', '');
        
        return { 
            data: { q: rawData.q, opts: allOptions, ans: allOptions.indexOf(rawData.correct), exp: rawData.exp }, 
            rank: rankName, 
            badge: `🎯 ${displaySubject} | ${finalDifficulty.toUpperCase()}` 
        };
    } 
    // 3. 綜合題目 (AI Random)
    else {
        const allSubjects = ["國文", "英文", "數學", "公民", "歷史", "地理", "物理", "化學", "生物"];
        let targetSubject = allSubjects[Math.floor(Math.random() * allSubjects.length)];
        
        try {
            const response = await fetch("/api/generate-quiz", {
                method: "POST", 
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    subject: targetSubject, 
                    level: currentUserData.profile.educationLevel || "General", 
                    rank: rankName, 
                    difficulty: finalDifficulty,
                    language: currentLang,
                    knowledgeMap: currentUserData.stats.knowledgeMap || {} 
                })
            });

            if (!response.ok) throw new Error(`Server Error: ${response.status}`);
            const data = await response.json();
            let aiText = data.text;
            const jsonMatch = aiText.match(/\{[\s\S]*\}/);
            if (jsonMatch) aiText = jsonMatch[0];
            const rawData = JSON.parse(aiText);

            let allOptions = shuffleArray([rawData.correct, ...rawData.wrong]);
            return {
                data: { q: rawData.q, opts: allOptions, ans: allOptions.indexOf(rawData.correct), exp: rawData.exp },
                rank: rankName,
                badge: `🎯 ${rawData.subject} | ${rawData.sub_topic || '綜合'}`
            };
        } catch (e) {
            console.error("[Fetch-AI-Error] AI 一般模式生成失敗:", e);
            throw e;
        }
    }
}

/// 🔥 修改：在進入下一題前才清除舊題目，確保 startQuizFlow 能抓到新題目
window.nextQuestion = () => { 
    window.currentActiveQuiz = null; 
    startQuizFlow(); 
};

async function handleAnswer(userIdx, correctIdx, questionText, explanation) {
    if (!currentUserData) return;
    const quiz = window.currentActiveQuiz;
    if (quiz) {
        if (answeredSoloQuizzes.has(quiz)) return;
        answeredSoloQuizzes.add(quiz);
    }

    const timeTaken = (Date.now() - (window.quizStartTime || Date.now())) / 1000;
    const isCorrect = userIdx === correctIdx;
    
    const opts = document.querySelectorAll('[id^="option-btn-"]');
    opts.forEach((btn, idx) => {
        btn.onclick = null; 
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        if (idx === correctIdx) btn.classList.add('bg-green-600', 'border-green-400', 'text-white');
        else if (idx === userIdx && !isCorrect) btn.classList.add('bg-red-600', 'border-red-400', 'text-white');
    });
    
    const fbSection = document.getElementById('feedback-section');
    const fbTitle = document.getElementById('feedback-title');
    const fbIcon = document.getElementById('feedback-icon');
    const fbText = document.getElementById('feedback-text');
    document.getElementById('btn-giveup').classList.add('hidden');
    if (fbSection) fbSection.classList.remove('hidden');

    if(isCorrect) {
        fbTitle.innerText = t('msg_correct'); 
        fbTitle.className = "text-xl font-bold text-green-400";
        fbIcon.innerHTML = '<i class="fa-solid fa-circle-check text-green-400"></i>';
        if (navigator.vibrate) navigator.vibrate(50);
    } else {
        fbTitle.innerText = t('msg_wrong'); 
        fbTitle.className = "text-xl font-bold text-red-400";
        fbIcon.innerHTML = '<i class="fa-solid fa-circle-xmark text-red-400"></i>';
        if (navigator.vibrate) navigator.vibrate(200);
    }
    
    fbText.innerHTML = parseMarkdownImages(explanation) || "AI did not provide explanation.";

    if (soloSession.active) {
        if (isCorrect) soloSession.correctCount++;
        else soloSession.wrongCount++;
        
        soloSession.history.push({ q: questionText, isCorrect: isCorrect, exp: explanation });

        const elCorrect = document.getElementById('solo-correct-count');
        const elWrong = document.getElementById('solo-wrong-count');
        if (elCorrect) elCorrect.innerText = soloSession.correctCount;
        if (elWrong) elWrong.innerText = soloSession.wrongCount;

        const nextBtn = document.getElementById('btn-next-step');
        if (nextBtn) {
            soloSession.currentStep++;
            nextBtn.innerText = `下一題 (目前連對: ${currentUserData.stats.currentStreak + (isCorrect?1:0)})`;
            nextBtn.className = "btn-cyber-primary flex-1 py-3 rounded-lg text-xs bg-cyan-600 text-white";
            nextBtn.onclick = window.nextQuestion; 
        }
    }

    let stats = currentUserData.stats;
    let scoreGain = 0;
    const cultivationReward = applyCultivationReward(stats, isCorrect);

    stats.totalAnswered++;
    if (isCorrect) {
        stats.totalCorrect++; 
        stats.currentStreak++;
        if (stats.currentStreak > stats.bestStreak) stats.bestStreak = stats.currentStreak;
        
        scoreGain = 20; // 無限模式獎勵
        fbTitle.innerHTML += ` <span class="text-yellow-400 text-sm ml-2 border border-yellow-500 rounded px-1">+${scoreGain}💰 · +${cultivationReward.gain} 修為</span>`;
    } else {
        stats.currentStreak = 0; 
    }

    if (window.currentActiveQuiz && window.currentActiveQuiz.badge) {
        const parts = window.currentActiveQuiz.badge.replace('🎯 ', '').split(' | ');
        if (parts.length >= 2) {
            const subject = parts[0].trim();
            const subTopic = parts[1].trim();

            if (!stats.knowledgeMap) stats.knowledgeMap = {};
            if (!stats.knowledgeMap[subject]) stats.knowledgeMap[subject] = {};
            if (!stats.knowledgeMap[subject][subTopic]) {
                stats.knowledgeMap[subject][subTopic] = { total: 0, correct: 0 };
            }

            stats.knowledgeMap[subject][subTopic].total += 1;
            if (isCorrect) {
                stats.knowledgeMap[subject][subTopic].correct += 1;
            }
        }
    }

    const newRank = calculateRankFromScore(stats.totalScore || 0);
    if (newRank > stats.rankLevel) stats.rankLevel = newRank;

    updateUIStats();

    try {
        const p1 = updateDoc(doc(db, "users", auth.currentUser.uid), { stats: stats })
            .then(() => showCultivationFeedback(cultivationReward, isCorrect));
        const p2 = addDoc(collection(db, "exam_logs"), { 
            uid: auth.currentUser.uid, 
            email: auth.currentUser.email, 
            question: questionText, 
            isCorrect: isCorrect, 
            timeTaken: timeTaken,
            topic: "Solo", 
            mode: 'infinite', 
            timestamp: serverTimestamp(),
            options: window.currentActiveQuiz?.data?.opts || [],
            correctIdx: correctIdx,
            userIdx: userIdx,
            explanation: explanation || ""
        });
        await Promise.all([p1, p2]);
    } catch (e) { console.error("Firebase Error", e); }
    
    fillBuffer();
}

async function generateVisualAid(imagePrompt) {
    // 直接回傳 null，不再發送請求
    return null;
}

// 2. [修改] renderQuiz 函式 (移除圖片載入邏輯)
async function renderQuiz(data, rank, topic) {
    document.getElementById('quiz-loading').classList.add('hidden');
    document.getElementById('quiz-container').classList.remove('hidden');
    document.getElementById('quiz-badge').innerText = `${topic} | ${rank}`;
    
    const questionTextEl = document.getElementById('question-text');
    // 只保留 Markdown 轉 HTML (若題目本身內含靜態圖 URL 仍可顯示)
    questionTextEl.innerHTML = parseMarkdownImages(data.q);

    // C. 渲染選項 (保持不變)
    const container = document.getElementById('options-container');
    container.innerHTML = ''; 
    data.opts.forEach((optText, idx) => {
        const btn = document.createElement('button');
        btn.id = `option-btn-${idx}`;
        // 🔥 這裡修復了斷裂的字串與 class 名稱
        btn.className = "w-full text-left p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition border border-slate-600 flex items-center gap-3 active:scale-95 mb-2";
        btn.innerHTML = `<span class="bg-slate-800 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-blue-400 border border-slate-600 shrink-0">${String.fromCharCode(65+idx)}</span><span class="flex-1">${optText}</span>`;
        btn.onclick = () => handleAnswer(idx, data.ans, data.q, data.exp);
        container.appendChild(btn);
    });

    // 🔥 新增：讓 MathJax 掃描畫面並將 $ $ 轉換成數學符號
    if (window.MathJax) {
        window.MathJax.typesetPromise([
            document.getElementById('question-text'),
            document.getElementById('options-container')
        ]).catch((err) => console.log(err.message));
    }
}

// 在 main.js 中搜尋 window.giveUpQuiz 並替換

window.giveUpQuiz = async () => { 
    // 🔥 修正：防止連點造成的死循環
    if (isAnswering) return; 
    
    // 使用自定義的 openConfirm (支援 Promise等待)
    const isConfirmed = await openConfirm("確定要放棄此題嗎？\n(將視為回答錯誤並中斷連勝)");
    
    if (isConfirmed) {
        // 🔥 標記為處理中，避免重複觸發 nextQuestion
        isAnswering = true; 
        
        // 視為回答錯誤 (-1)，但不扣分，僅中斷連勝
        await handleAnswer(-1, -2, document.getElementById('question-text').innerText, "Skipped by player.");
        
        // 🔥 強制重置鎖定狀態 (handleAnswer 內部可能會解鎖，但放棄邏輯需確保安全)
        setTimeout(() => {
            isAnswering = false;
        }, 500);
    }
};

// 🔥 新增：回報問題相關邏輯
window.openReportModal = () => {
    const modal = document.getElementById('report-modal');
    const box = document.getElementById('report-box');
    
    // 1. 重置 View 顯示狀態
    document.getElementById('report-input-view').classList.remove('hidden');
    document.getElementById('report-loading-view').classList.add('hidden');
    document.getElementById('report-result-view').classList.add('hidden');
    
    // 2. 清空輸入框
    document.getElementById('report-reason').value = '';

    // 🔥 關鍵修正：強制清空結果頁的殘留資訊
    document.getElementById('report-result-icon').innerHTML = '';
    document.getElementById('report-result-title').innerText = '';
    document.getElementById('report-result-msg').innerText = '';

    // 🔥 關鍵修正：重置按鈕行為與樣式
    // 避免按鈕還保留著上一題的「跳過並領獎」功能
    const resultBtn = document.querySelector('#report-result-view button');
    if (resultBtn) {
        resultBtn.onclick = () => closeReportModal(); // 還原為僅關閉
        resultBtn.innerText = "關閉";                 // 還原文字
        resultBtn.className = "btn-cyber-ghost w-full py-2 text-xs"; // 還原樣式
    }

    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        box.classList.remove('scale-95');
        box.classList.add('scale-100');
    });
};

window.closeReportModal = () => {
    const modal = document.getElementById('report-modal');
    const box = document.getElementById('report-box');
    modal.classList.add('opacity-0');
    box.classList.remove('scale-100');
    box.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

window.submitReport = async () => {
    const reason = document.getElementById('report-reason').value.trim();
    if (!reason) return alert("請輸入回報原因！");

    // 切換至 Loading 介面
    document.getElementById('report-input-view').classList.add('hidden');
    document.getElementById('report-loading-view').classList.remove('hidden');
    document.getElementById('report-loading-view').style.display = 'flex';

    // 取得當前題目資訊 (由記憶體變數取得)
    const currentQData = window.currentActiveQuiz;
    if (!currentQData || !currentQData.data) {
        alert("找不到題目資料");
        closeReportModal();
        return;
    }

    try {
        const res = await fetch('/api/verify-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: currentQData.data.q,
                options: currentQData.data.opts,
                correctIndex: currentQData.data.ans,
                explanation: currentQData.data.exp,
                userReason: reason
            })
        });

        const result = await res.json();

        // 切換至結果介面
        document.getElementById('report-loading-view').classList.add('hidden');
        document.getElementById('report-loading-view').style.display = '';
        document.getElementById('report-result-view').classList.remove('hidden');
        document.getElementById('report-result-view').style.display = 'flex';

        const iconEl = document.getElementById('report-result-icon');
        const titleEl = document.getElementById('report-result-title');
        const msgEl = document.getElementById('report-result-msg');

        // 重設按鈕事件 (避免重複綁定)
        const btn = document.querySelector('#report-result-view button');

        if (result.valid) {
            // ✅ 回報成功：發獎勵 + 跳過
            iconEl.innerHTML = '<i class="fa-solid fa-circle-check text-green-400 animate-bounce"></i>';
            titleEl.innerText = "回報成功！";
            titleEl.className = "text-lg font-bold mb-2 text-green-400";
            msgEl.innerText = `AI 判定：${result.reason}\n\n獲得補償 20 金幣，題目已跳過。`;

            // 發放獎勵 (改發金幣)
            if (currentUserData && currentUserData.stats) {
                currentUserData.stats.gold = (currentUserData.stats.gold || 0) + 20;
                await updateDoc(doc(db, "users", auth.currentUser.uid), { "stats.gold": currentUserData.stats.gold });
                updateUIStats();
            }

            // 設定按鈕行為：跳下一題
            btn.onclick = () => {
                closeReportModal();
                
                // 清除暫存
                window.currentActiveQuiz = null; 
                fillBuffer(); 
                
                // 稍微延遲執行，讓彈窗關閉動畫順暢
                setTimeout(() => startQuizFlow(), 300); 
            };
        } else {
            // ❌ 回報駁回
            iconEl.innerHTML = '<i class="fa-solid fa-circle-xmark text-red-400"></i>';
            titleEl.innerText = "回報駁回";
            titleEl.className = "text-lg font-bold mb-2 text-red-400";
            msgEl.innerText = `AI 判定：${result.reason}\n\n題目邏輯無誤，請繼續挑戰！`;
            
            // 設定按鈕行為：僅關閉視窗
            btn.onclick = () => closeReportModal();
        }

    } catch (e) {
        console.error(e);
        alert("連線錯誤，請稍後再試");
        closeReportModal();
    }
};


// ==========================================
//  🚀 隨機邀請系統 & 對戰邏輯
// ==========================================

function startInvitationListener() {
    if (inviteUnsub) inviteUnsub();
    const userInvitesRef = collection(db, "users", auth.currentUser.uid, "invitations");
    
    inviteUnsub = onSnapshot(userInvitesRef, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const invite = change.doc.data();
                const now = Date.now();
                const inviteTime = invite.timestamp ? invite.timestamp.toMillis() : now;
                
                if (now - inviteTime < 2 * 60 * 1000) {
                    showInviteToast(change.doc.id, invite);
                } else {
                    deleteDoc(change.doc.ref);
                }
            }
        });
    });
}

// 系統強制重整監聽
function listenToSystemCommands() {
    if (systemUnsub) systemUnsub();
    
    // 監聽 system/commands 文檔
    systemUnsub = onSnapshot(doc(db, "system", "commands"), (docSnap) => {
        if (!docSnap.exists()) return;
        
        const data = docSnap.data();
        const serverToken = data.reloadToken;

        // 第一次載入時，只記錄當前的 Token，不重整
        if (localReloadToken === null) {
            localReloadToken = serverToken;
            return;
        }

        // 如果伺服器的 Token 變了，代表管理員按下了重整按鈕
        if (serverToken && serverToken !== localReloadToken) {
            console.log("收到強制重整指令！");
            // 使用 callback 確保玩家按了確定才重整
            alert("系統進行更新，即將重新整理網頁...", () => {
                location.reload();
            });
        }
    });
}

// 顯示邀請通知 (使用 getAvatarHtml 修正顯示)
function showInviteToast(inviteId, data) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    
    toast.className = "bg-slate-800/95 backdrop-blur border-l-4 border-yellow-400 text-white p-4 rounded shadow-2xl flex items-center gap-4 transform transition-all duration-300 translate-x-full mb-3 relative overflow-hidden";
    
    const equippedData = { 
        frame: data.hostFrame || '', 
        avatar: data.hostAvatar || '' 
    };
    
    const avatarHtml = getAvatarHtml(equippedData, "w-12 h-12");

    toast.innerHTML = `
        <div class="flex-shrink-0">
             ${avatarHtml}
        </div>
        
        <div class="flex-1 min-w-0 z-10">
            <h4 class="font-bold text-sm truncate text-yellow-400 flex items-center gap-2">
                <i class="fa-solid fa-swords"></i> 對戰邀請！
            </h4>
            <p class="text-xs text-gray-300 truncate mb-2 mt-1">
                <span class="text-white font-bold">${data.hostName}</span> 邀請你對戰
            </p>
            <div class="flex gap-2">
                <button id="btn-acc-${inviteId}" class="bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white text-xs px-3 py-1.5 rounded font-bold transition shadow-lg">
                    <i class="fa-solid fa-check"></i> 接受
                </button>
                <button id="btn-dec-${inviteId}" class="bg-slate-700 hover:bg-slate-600 text-gray-300 text-xs px-3 py-1.5 rounded transition border border-slate-600">
                    拒絕
                </button>
            </div>
        </div>
        
        <div class="absolute -right-2 -bottom-2 text-6xl text-white/5 pointer-events-none">
            <i class="fa-solid fa-gamepad"></i>
        </div>
    `;

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.remove('translate-x-full'));

    document.getElementById(`btn-acc-${inviteId}`).onclick = () => acceptInvite(inviteId, data.roomId, toast);
    document.getElementById(`btn-dec-${inviteId}`).onclick = () => removeInvite(inviteId, toast);

    setTimeout(() => { if (toast.parentNode) removeInvite(inviteId, toast); }, 10000);
}

async function removeInvite(inviteId, toastElement) {
    if (toastElement) {
        toastElement.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => toastElement.remove(), 300);
    }
    try { await deleteDoc(doc(db, "users", auth.currentUser.uid, "invitations", inviteId)); } catch (e) { console.error(e); }
}

async function inviteRandomPlayers(roomId) {
    if (!auth.currentUser) return;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("lastActive", ">", fiveMinutesAgo), limit(20));
        const snapshot = await getDocs(q);
        
        let candidates = [];
        snapshot.forEach(doc => {
            if (doc.id !== auth.currentUser.uid) {
                candidates.push({ id: doc.id, ...doc.data() });
            }
        });

        if (candidates.length === 0) return; 

        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }

        const targets = candidates.slice(0, 3);
        const batch = writeBatch(db);

        targets.forEach(user => {
            const inviteRef = doc(collection(db, "users", user.id, "invitations"));
            batch.set(inviteRef, {
                roomId: roomId,
                hostName: currentUserData.displayName,
                hostAvatar: currentUserData.equipped?.avatar || '',
                hostFrame: currentUserData.equipped?.frame || '',
                timestamp: serverTimestamp()
            });
        });

        await batch.commit();
        console.log(`已發送邀請給 ${targets.length} 位玩家`);
    } catch (e) { console.error("邀請發送失敗", e); }
}

// [修正版] generateSharedQuiz：增加 AI 失敗後的備援機制，防止卡死
let isGenerating = false;

async function generateSharedQuiz(roomId) {
    if (isGenerating) return; 
    isGenerating = true; 
    
    try {
        const roomRef = doc(db, "rooms", roomId);
        const snap = await getDoc(roomRef);
        
        // 第一回合給予一點延遲，讓玩家先看到桌面
        if (snap.exists() && snap.data().round === 1) {
            console.log("🎲 第一回合，展示桌面中...");
            await new Promise(r => setTimeout(r, 1500));
        }

        let q = null;
        try {
            // 嘗試從 AI/題庫 取得題目
            q = await fetchOneQuestion(); 
        } catch (fetchError) {
            console.error("⚠️ 主要出題失敗，啟用備用題目系統:", fetchError);
            // 🔥 【關鍵修正】備用題目：防止 AI 掛掉時遊戲卡死
            q = {
                data: {
                    q: "通訊受到干擾 (AI連線忙碌)，請選擇正確選項以校正系統：",
                    opts: ["【點擊此處】修復連線並繼續戰鬥", "錯誤的雜訊 A", "錯誤的雜訊 B", "錯誤的雜訊 C"],
                    ans: 0, // 第一個選項是正確答案
                    exp: "由於 AI 服務暫時無法連線，系統自動派發了備用題目以維持戰鬥進行。"
                }
            };
        }

        // 寫入資料庫，讓雙方都能收到題目
        await updateDoc(roomRef, { 
            currentQuestion: { 
                q: q.data.q, 
                opts: q.data.opts, 
                ans: q.data.ans, 
                exp: q.data.exp 
            } 
        });
    } catch (e) { 
        console.error("Generate Critical Error", e); 
    } finally { 
        isGenerating = false; 
    }
}

window.leaveBattle = async () => {
    if (battleUnsub) { 
        battleUnsub(); 
        battleUnsub = null; 
    }

    if (currentBattleId) {
        const roomIdToRemove = currentBattleId;
        try {
            const snap = await getDoc(doc(db, "rooms", roomIdToRemove));
            if (snap.exists()) { 
                const data = snap.data(); 
                // 只有房主且在等待中才刪除
                if (data.status === "waiting" && data.host.uid === auth.currentUser.uid) { 
                    await deleteDoc(doc(db, "rooms", roomIdToRemove)); 
                } 
            }
        } catch (err) { console.error(err); }
    }
    
    isBattleActive = false; 
    currentBattleId = null; 
    isPlayingSequence = false; // [新增] 重置動畫旗標
    switchToPage('page-home');
};

// 🔥 新增：發現對手時的震撼動畫 (請將此函式加在 window.startBattleMatchmaking 之前)
window.showOpponentFoundAnimation = async (oppData) => {
    document.getElementById('battle-status-text').innerText = "OPPONENT FOUND!";
    document.getElementById('battle-status-text').classList.add('text-red-400', 'font-bold');
    
    const oppUI = document.getElementById('match-opp');
    const oppAvatar = oppData.equipped?.avatar || '';
    const oppRank = getRankName(oppData.rankLevel || 0);
    
    if (navigator.vibrate) navigator.vibrate([100, 50, 200]);

    oppUI.innerHTML = `
        <div class="w-20 h-20 md:w-24 md:h-24 rounded-full border-4 border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.8)] flex items-center justify-center overflow-hidden bg-slate-800 p-1 transform scale-0 animate-[tabPop_0.4s_ease-out_forwards]">
            <img src="${oppAvatar}" class="w-full h-full rounded-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='block'">
            <i class="fa-solid fa-user text-3xl text-red-500/50 hidden"></i>
        </div>
        <div class="mt-4 text-red-400 font-bold font-sci text-sm md:text-lg tracking-wider animate-[fadeInUpShort_0.5s_forwards] truncate w-24 text-center">${oppData.name}</div>
        <div class="text-[10px] md:text-xs text-red-500 font-mono animate-[fadeInUpShort_0.7s_forwards]">${oppRank}</div>
    `;

    // 停留 2 秒讓雙方看清對手
    await new Promise(r => setTimeout(r, 2000));
    document.getElementById('battle-status-text').classList.remove('text-red-400', 'font-bold');
};

// [修正] 接受邀請 (強制切換 UI 並啟動監聽)
async function acceptInvite(inviteId, roomId, toastElement) {
    // 1. 移除邀請通知
    if (toastElement) {
        toastElement.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => toastElement.remove(), 300);
    }
    try { await deleteDoc(doc(db, "users", auth.currentUser.uid, "invitations", inviteId)); } catch(e) {}

    // 2. 防呆檢查
    if (isBattleActive) { alert("你正在對戰中，無法加入！"); return; }

    // 3. 準備戰鬥資料
    const myBattleData = {
        uid: auth.currentUser.uid,
        name: currentUserData.displayName || "Player",
        equipped: currentUserData.equipped || { frame: '', avatar: '' },
        goldenCore: window.getEquippedGoldenCoreBattleSnapshot?.() || null,
        rankLevel: currentUserData.stats?.rankLevel || 0,
        done: false,
        answerCorrect: null,
        answerTime: null,
        isDead: false,
        hp: 100,
        maxHp: 100,
        atk: 20
    };

    // 4. 切換頁面並顯示「連線中」 (避免畫面卡住)
    switchToPage('page-battle');
    document.getElementById('battle-lobby').classList.remove('hidden'); // 先顯示 Lobby
    document.getElementById('battle-arena').classList.add('hidden');    // 先隱藏 Arena
    document.getElementById('battle-status-text').innerText = "正在加入房間..."; // 更新文字
    document.getElementById('battle-result').classList.add('hidden'); // 確保結算畫面隱藏

    // 5. 執行加入房間交易
    const roomRef = doc(db, "rooms", roomId);
    try {
        await runTransaction(db, async (transaction) => {
            const sfDoc = await transaction.get(roomRef);
            if (!sfDoc.exists()) throw "房間已失效 (對方可能已取消)";
            
            const data = sfDoc.data();
            // 檢查房間狀態
            if (data.status === "waiting" && !data.guest) {
                transaction.update(roomRef, { guest: myBattleData, status: "ready" });
            } else { 
                throw "房間已滿或遊戲已開始"; 
            }
        });

        // 6. 成功加入後，設定狀態並開始監聽
        isBattleActive = true;
        currentBattleId = roomId;
        isBattleResultProcessed = false;
        
        // 重要：啟動監聽，UI 的切換交給 listenToBattleRoom 處理，確保資料同步
        listenToBattleRoom(roomId);

    } catch (e) { 
        console.error(e); 
        alert("加入失敗：" + e); 
        switchToPage('page-home'); // 失敗則返回首頁
    }
}
// 全域變數 (記錄上一幀的血量)
let lastMyHp = -1;
let lastEnemyHp = -1;

window.startBattleMatchmaking = async () => {
    if (!auth.currentUser) { alert("請先登入！"); return; }

    console.log("🚀 開始配對中..."); 
    isBattleActive = true;
    window.hasSeenOpponent = false; 
    
    switchToPage('page-battle');
    document.getElementById('battle-lobby').classList.remove('hidden');
    document.getElementById('battle-arena').classList.add('hidden');
    document.getElementById('battle-result').classList.add('hidden');

    document.getElementById('battle-status-text').innerText = "SEARCHING FOR OPPONENTS...";
    document.getElementById('match-me-name').innerText = currentUserData.displayName || "Player";
    document.getElementById('match-me-rank').innerText = getRankName(currentUserData.stats?.rankLevel || 0);
    const myAvatar = document.getElementById('match-me-avatar');
    myAvatar.src = currentUserData.equipped?.avatar || '';
    myAvatar.style.display = myAvatar.src ? 'block' : 'none';

    document.getElementById('match-opp').innerHTML = `
        <div class="w-20 h-20 md:w-24 md:h-24 rounded-full border-4 border-red-500/30 border-dashed animate-[spin_3s_linear_infinite] flex items-center justify-center overflow-hidden bg-slate-900/50 p-1 relative">
            <i class="fa-solid fa-question text-3xl md:text-4xl text-red-500/50 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 mt-0"></i>
        </div>
        <div class="mt-4 text-red-400 font-bold font-sci text-sm md:text-lg animate-pulse tracking-wider">SEARCHING</div>
        <div class="text-[10px] md:text-xs text-red-500/50 font-mono">ESTIMATING...</div>
    `;

    const searchTimeRange = new Date(Date.now() - 1 * 60 * 1000);
    
    const myBattleData = {
        uid: auth.currentUser.uid,
        name: currentUserData.displayName || "Player",
        equipped: currentUserData.equipped || { frame: '', avatar: '' },
        rankLevel: currentUserData.stats?.rankLevel || 0,
        done: false,
        answerCorrect: null,
        answerTime: null,
        isDead: false,
        hp: 100,
        maxHp: 100,
        atk: 20
    };

    let joinedRoomId = null;

    try {
        const q = query(
            collection(db, "rooms"), 
            where("status", "==", "waiting"), 
            where("createdAt", ">", searchTimeRange), 
            orderBy("createdAt", "asc"),
            limit(10)
        );
        
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            let availableDocs = snapshot.docs.filter(d => { 
                const data = d.data(); 
                return data.host && data.host.uid !== auth.currentUser.uid; 
            });

            for (const targetDoc of availableDocs) {
                const roomRef = doc(db, "rooms", targetDoc.id);
                let targetData = null;
                
                try {
                    await runTransaction(db, async (transaction) => {
                        const sfDoc = await transaction.get(roomRef);
                        if (!sfDoc.exists()) throw "房間已不存在";
                        targetData = sfDoc.data();
                        
                        if (targetData.status === "waiting" && !targetData.guest) {
                            transaction.update(roomRef, { guest: myBattleData, status: "ready" });
                        } else { 
                            throw "房間已滿"; 
                        }
                    });

                    joinedRoomId = targetDoc.id;
                    await window.showOpponentFoundAnimation(targetData.host);
                    break; 
                } catch (e) { console.log(`加入房間失敗:`, e); }
            }
        }

        if (joinedRoomId) {
            console.log("✅ 成功加入房間:", joinedRoomId);
            currentBattleId = joinedRoomId;
            isBattleResultProcessed = false;
            listenToBattleRoom(currentBattleId);
        } else {
            console.log("⚠️ 無可用房間，建立新房間並預先生成題目...");
            document.getElementById('battle-status-text').innerText = "GENERATING INITIAL QUERY...";
            
            // 🔥 關鍵修復：房主建立房間時「直接預先出好第一題」，讓對手加入時秒開，絕不卡頓！
            let initQ = null;
            try {
                initQ = await fetchOneQuestion();
            } catch(e) {
                initQ = { data: { q: "通訊受到干擾 (連線忙碌)，請選擇正確選項以校正系統：", opts: ["【點擊此處】修復連線", "錯誤雜訊A", "錯誤雜訊B", "錯誤雜訊C"], ans: 0, exp: "系統自動派發備用題目。" }};
            }

            document.getElementById('battle-status-text').innerText = "WAITING FOR CHALLENGER SIGNAL...";
            const roomRef = await addDoc(collection(db, "rooms"), { 
                host: myBattleData, 
                guest: null, 
                status: "waiting", 
                round: 1, 
                currentQuestion: { q: initQ.data.q, opts: initQ.data.opts, ans: initQ.data.ans, exp: initQ.data.exp },
                createdAt: serverTimestamp() 
            });
            
            currentBattleId = roomRef.id;
            isBattleResultProcessed = false;
            inviteRandomPlayers(currentBattleId);
            listenToBattleRoom(currentBattleId);
        }
    } catch (e) {
        alert("配對失敗: " + e.message); 
        leaveBattle();
    }
};

// [終極修正版] 監聽對戰房間 (強制定義 display 狀態，避免 CSS 衝突)
function listenToBattleRoom(roomId) {
    if (battleUnsub) battleUnsub();
    
    lastProcessedLogId = null;
    isPlayingSequence = false;
    let lastQuestionText = ""; 

    battleUnsub = onSnapshot(doc(db, "rooms", roomId), async (docSnap) => {
        if (!docSnap.exists()) { leaveBattle(); return; }

        const room = docSnap.data();
        if (!auth.currentUser) return;

        const isHost = room.host.uid === auth.currentUser.uid;
        const myData = isHost ? room.host : room.guest;
        const oppData = isHost ? room.guest : room.host;

        // 1. 動畫處理
        if (room.battleLog && room.battleLogId !== lastProcessedLogId && !isPlayingSequence) {
            isPlayingSequence = true;
            lastProcessedLogId = room.battleLogId;
            
            // 強制隱藏 UI 讓出畫面給動畫
            document.getElementById('battle-quiz-overlay').style.display = 'none';
            
            await playBattleSequence(room.battleLog, isHost);
            isPlayingSequence = false;

            if (room.status === "finished") {
                showBattleResultUI(room, isHost);
            } else if (isHost) {
                // 回合結束後，房主清空 Log 並產生新題目
                await updateDoc(doc(db, "rooms", roomId), { currentQuestion: null, battleLog: null });
                generateSharedQuiz(roomId);
            }
            return; 
        }

        if (isPlayingSequence) return;

        // 2. 遊戲進行中
        if (room.status === "ready") {
            if (isHost && !window.hasSeenOpponent && room.guest) {
                window.hasSeenOpponent = true;
                isPlayingSequence = true; 
                await window.showOpponentFoundAnimation(room.guest);
                isPlayingSequence = false;
            }

            document.getElementById('battle-lobby').classList.add('hidden');
            document.getElementById('battle-arena').classList.remove('hidden');
            document.getElementById('battle-result').classList.add('hidden');
            document.getElementById('battle-round').innerText = room.round;

            updateBattleCardUI('my', myData);
            updateBattleCardUI('enemy', oppData);

            // 🔥 強制定義介面顯示邏輯，不用 Tailwind 的 hidden，避免衝突
            const overlay = document.getElementById('battle-quiz-overlay');
            const loadingBox = document.getElementById('battle-loading');
            const quizBox = document.getElementById('battle-quiz-box');
            
            if (room.currentQuestion) {
                 window.currentBattleExp = room.currentQuestion.exp;
                 
                 // 有題目 -> 顯示作答視窗
                 overlay.style.display = "flex";
                 loadingBox.style.display = "none";
                 quizBox.style.display = "flex";
                 
                 if (room.currentQuestion.q !== lastQuestionText) {
                    lastQuestionText = room.currentQuestion.q;

                    document.getElementById('battle-feedback').style.display = "none";
                    document.getElementById('battle-waiting-msg').style.display = "none";
                    
                    const btns = document.querySelectorAll('#battle-options button');
                    btns.forEach(b => {
                        b.disabled = false;
                        b.classList.remove('opacity-50', 'cursor-not-allowed', 'bg-green-600', 'bg-red-600', 'border-green-400', 'border-red-400');
                    });

                    document.getElementById('battle-q-text').innerHTML = parseMarkdownImages(room.currentQuestion.q);
                    const container = document.getElementById('battle-options');
                    container.innerHTML = '';
                    room.currentQuestion.opts.forEach((opt, idx) => {
                        const btn = document.createElement('button');
                        btn.className = "w-full text-left p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition border border-slate-600 active:scale-95 mb-2 flex items-center";
                        btn.innerHTML = `<span class="bg-slate-800 w-8 h-8 rounded-full inline-flex items-center justify-center text-sm font-bold text-blue-400 border border-slate-600 mr-3 shrink-0">${String.fromCharCode(65+idx)}</span><span class="text-white font-bold">${opt}</span>`;
                        btn.onclick = () => handleBattleAnswer(roomId, idx, room.currentQuestion.ans, isHost);
                        container.appendChild(btn);
                    });
                    
                    if (window.MathJax) {
                        window.MathJax.typesetPromise([
                            document.getElementById('battle-q-text'),
                            document.getElementById('battle-options')
                        ]).catch(e => console.log(e));
                    }
                 }
            } else {
                // 無題目 -> 顯示等待畫面
                overlay.style.display = "flex";
                quizBox.style.display = "none";
                loadingBox.style.display = "flex"; 
                document.getElementById('battle-loading-text').innerText = "正在生成下一回合題目..."; 
            }

            if (room.host?.done && room.guest?.done && isHost) {
                if (!window.isWaitingForResolve) {
                    window.isWaitingForResolve = true;
                    setTimeout(() => {
                        resolveRoundLogic(roomId, room);
                        window.isWaitingForResolve = false;
                    }, 1000); 
                }
            }
        }
        
        if (room.status === "finished") {
             showBattleResultUI(room, isHost);
        }
    });
}

// [新增] 獨立的結算 UI 顯示函式 (避免重複代碼)
function showBattleResultUI(room, isHost) {
     document.getElementById('battle-quiz-overlay').classList.add('hidden');
     document.getElementById('battle-arena').classList.add('hidden');
     document.getElementById('battle-result').classList.remove('hidden');
     
     // 停止重複處理
     if(!isBattleResultProcessed) {
         isBattleResultProcessed = true;
         const isWinner = room.winner === auth.currentUser.uid;
         const titleEl = document.getElementById('battle-result-title');
         const msgEl = document.getElementById('battle-result-msg');

         if(isWinner) {
             titleEl.innerText = t('battle_win');
             titleEl.className = "text-3xl font-bold mb-2 text-green-400 animate-bounce";
             // 只有贏家才呼叫加分函式
             processBattleWin(isHost ? room.guest : room.host, msgEl);
         } else if (!room.winner) {
             titleEl.innerText = t('battle_draw');
             titleEl.className = "text-3xl font-bold mb-2 text-yellow-400";
             msgEl.innerText = "勢均力敵！雙方各獲得 50 積分";
             // 平手加分邏輯可選
         } else {
             titleEl.innerText = t('battle_lose');
             titleEl.className = "text-3xl font-bold mb-2 text-red-400";
             msgEl.innerText = "再接再厲！獲得參加獎 20 積分";
         }
     }
}

// ==========================================
// 🎨 全新戰鬥視覺特效系統 (VFX System - Promise Based)
// ==========================================

async function playBattleSequence(logs, isHost) {
    if (!logs || logs.length === 0) return;

    for (const log of logs) {
        const isMeAttacking = (isHost && log.attacker === 'host') || (!isHost && log.attacker === 'guest');
        const role = isMeAttacking ? 'my' : 'enemy';
        const targetRole = isMeAttacking ? 'enemy' : 'my';

        // 戰鬥前奏的微小停頓
        await new Promise(r => setTimeout(r, 600)); 

        if (log.isHit) {
            // 命中：等待整個攻擊動畫與扣血邏輯執行完畢
            await triggerBattleAnimation(role, targetRole, log.dmg, log.skill, log.healed);
        } else {
            // 未命中：播放 Miss 動畫
            await triggerMissAnimation(role, targetRole);
        }
        
        // 每個動作完全結束後，給予玩家一點喘息時間
        await new Promise(r => setTimeout(r, 1000));
    }
}

// Generic battle participant UI (card-free).
function updateBattleCardUI(prefix, playerData) {
    if (!playerData) return;
    const idPrefix = prefix === 'my' ? 'my' : 'enemy';
    const container = document.getElementById(`${idPrefix}-card-container`);
    const miniVisualEl = document.getElementById(`${idPrefix}-card-visual`);
    const hpBarEl = document.getElementById(`${idPrefix}-hp-bar`);
    const hpTextEl = document.getElementById(`${idPrefix}-hp-text`);
    const subIndicatorEl = document.getElementById(`${idPrefix}-sub-card-indicator`);
    if (!container || !hpBarEl) return;

    const maxHp = Number(playerData.maxHp || 100);
    const currentHp = Math.max(0, Number(playerData.hp ?? maxHp));
    const hpPercent = Math.max(0, Math.min(100, (currentHp / maxHp) * 100));
    hpBarEl.style.width = `${hpPercent}%`;
    if (hpTextEl) hpTextEl.innerText = `${currentHp}/${maxHp}`;
    container.className = `relative w-32 h-48 bg-slate-800 rounded-lg border-2 ${prefix === 'my' ? 'border-cyan-500' : 'border-red-500'} transition-all duration-500 mb-6 overflow-hidden shadow-2xl`;
    container.innerHTML = `
        <div class="absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
            <div class="text-4xl mb-3">${prefix === 'my' ? '⚔️' : '👹'}</div>
            <div class="font-bold text-sm ${prefix === 'my' ? 'text-cyan-300' : 'text-red-300'}">${playerData.name || 'Player'}</div>
            <div class="text-xs text-green-400 font-mono mt-2">HP ${currentHp}</div>
            <div class="text-xs text-red-300 font-mono">ATK ${Number(playerData.atk || 20)}</div>
        </div>`;
    if (miniVisualEl) miniVisualEl.innerHTML = prefix === 'my' ? '⚔️' : '👹';
    if (subIndicatorEl) { subIndicatorEl.innerHTML = ''; subIndicatorEl.style.opacity = '0'; }
}
// 觸發打擊動畫 (回傳 Promise 以完美同步時間軸)
async function triggerBattleAnimation(attackerPrefix, targetPrefix, damage, skillName, isHeal = false) {
    return new Promise(resolve => {
        const attackerWrapper = document.getElementById(`${attackerPrefix}-card-container-wrapper`);
        const targetWrapper = document.getElementById(`${targetPrefix}-card-container-wrapper`);

        if (!attackerWrapper || !targetWrapper) return resolve();

        let castDelay = 0;

        // 1. 技能詠唱特效 (如果有技能)
        if (skillName && skillName !== "普通攻擊") {
            attackerWrapper.classList.add('anim-cast');
            createFloatingText(attackerWrapper, `⚡ ${skillName}!`, "text-yellow-300 font-black", -40);
            castDelay = 500; // 詠唱延長 0.5 秒
        }

        setTimeout(() => {
            if (skillName && skillName !== "普通攻擊") attackerWrapper.classList.remove('anim-cast');

            // 2. 執行物理衝刺 (Lunge)
            const lungeClass = attackerPrefix === 'my' ? 'anim-lunge-up' : 'anim-lunge-down';
            attackerWrapper.classList.add(lungeClass);

            // 3. 完美抓準衝刺到一半的時間點 (300ms) 觸發打擊！
            setTimeout(() => {
                if (navigator.vibrate) navigator.vibrate([50, 50, 100]);

                const arena = document.getElementById('battle-arena');
                const isCrit = damage >= 40; // 大於等於 40 視為爆擊

                // 爆擊加強畫面震動與閃爍
                if (isCrit) {
                    arena.classList.add('anim-screen-shake-hard');
                    createFlashEffect('bg-red-600/40'); // 全螢幕閃紅血光
                } else {
                    arena.classList.add('anim-screen-shake');
                }

                targetWrapper.classList.add('anim-shake'); 
                
                // 動畫復原
                setTimeout(() => {
                    arena.classList.remove('anim-screen-shake', 'anim-screen-shake-hard');
                    targetWrapper.classList.remove('anim-shake');
                }, 500);

                // 渲染刀光
                createSlashEffect(targetWrapper, isCrit);

                // 🔥 同步扣血與跳字 (原本提早扣血的問題在這裡修復)
                if (damage > 0) {
                    createDamageNumber(targetWrapper, damage, isCrit);
                    updateHpBarVisual(targetPrefix, -damage); 
                }

                // 🔥 同步回血與跳字
                if (isHeal) {
                    createDamageNumber(attackerWrapper, `+${isHeal}`, false, true);
                    updateHpBarVisual(attackerPrefix, isHeal); 
                    attackerWrapper.classList.add('shadow-[0_0_30px_rgba(74,222,128,0.8)]'); // 綠色回血光環
                    setTimeout(()=> attackerWrapper.classList.remove('shadow-[0_0_30px_rgba(74,222,128,0.8)]'), 600);
                }

            }, 300); // 這個 300ms 必須跟 CSS lunge 曲線對齊

            // 4. 退回原位並結束 Promise
            setTimeout(() => {
                attackerWrapper.classList.remove(lungeClass);
                resolve(); // 告知主迴圈這個攻擊完全結束了
            }, 600);

        }, castDelay);
    });
}

// 攻擊失敗動畫 (假動作)
async function triggerMissAnimation(attackerPrefix, targetPrefix) {
    return new Promise(resolve => {
        const attackerWrapper = document.getElementById(`${attackerPrefix}-card-container-wrapper`);
        const targetWrapper = document.getElementById(`${targetPrefix}-card-container-wrapper`);
        if (!attackerWrapper || !targetWrapper) return resolve();

        // 假動作前傾
        const offset = attackerPrefix === 'my' ? '-30px' : '30px';
        attackerWrapper.style.transform = `translateY(${offset})`;
        attackerWrapper.style.transition = "transform 0.2s ease-in-out";

        setTimeout(() => {
            // 收回並顯示 MISS
            attackerWrapper.style.transform = "translateY(0)";
            createFloatingText(targetWrapper, "MISS", "text-gray-400 font-mono italic", -20);
            
            setTimeout(() => resolve(), 600);
        }, 300);
    });
}

// 獨立抽出的血條視覺更新函式 (僅更改 DOM)
function updateHpBarVisual(prefix, deltaAmount) {
    const bar = document.getElementById(`${prefix}-hp-bar`);
    const txt = document.getElementById(`${prefix}-hp-text`);
    if (bar && txt) {
        const currentText = txt.innerText.split('/');
        if (currentText.length !== 2) return;
        
        let cur = parseInt(currentText[0]);
        const max = parseInt(currentText[1]);

        cur = Math.max(0, Math.min(max, cur + deltaAmount)); // 確保不小於0或超過上限
        bar.style.width = `${(cur/max)*100}%`;
        txt.innerText = `${cur}/${max}`;

        // 讓血條閃爍一下
        bar.classList.add('hp-flash');
        setTimeout(() => bar.classList.remove('hp-flash'), 150);
    }
}

// 產生刀光特效 DOM (支援爆擊特效)
function createSlashEffect(parentEl, isCrit) {
    if (!parentEl) return;
    const vfx = document.createElement('div');
    vfx.className = 'vfx-container';

    if (isCrit) {
        // 爆擊：血色三連爪擊
        vfx.innerHTML = `
            <div class="vfx-slash bg-red-400 shadow-[0_0_20px_#7f1d1d]" style="transform: rotate(20deg) translateY(-30px) scaleX(1.2);"></div>
            <div class="vfx-slash bg-white shadow-[0_0_20px_#ef4444]" style="animation-delay: 0.1s; transform: rotate(20deg) scaleX(1.5);"></div>
            <div class="vfx-slash bg-red-400 shadow-[0_0_20px_#7f1d1d]" style="animation-delay: 0.2s; transform: rotate(20deg) translateY(30px) scaleX(1.2);"></div>
        `;
    } else {
        // 普通：十字斬
        vfx.innerHTML = `<div class="vfx-slash"></div><div class="vfx-slash" style="animation-delay: 0.1s; transform: rotate(45deg);"></div>`;
    }
    parentEl.appendChild(vfx);
    setTimeout(() => vfx.remove(), 800);
}

// 全螢幕閃光特效 (用於爆擊)
function createFlashEffect(bgClass) {
    const overlay = document.createElement('div');
    overlay.className = `fixed inset-0 z-[100] ${bgClass} pointer-events-none opacity-0 transition-opacity duration-100 mix-blend-overlay`;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.classList.remove('opacity-0');
        overlay.classList.add('opacity-100');
        setTimeout(() => {
            overlay.classList.remove('opacity-100');
            overlay.classList.add('opacity-0');
            setTimeout(() => overlay.remove(), 100);
        }, 50);
    });
}

// 產生傷害飄字 DOM
function createDamageNumber(parentEl, value, isCrit, isHeal = false) {
    if (!parentEl) return;
    const el = document.createElement('div');
    el.innerText = isHeal ? value : `-${value}`;
    
    let classes = "dmg-number";
    if (isCrit) classes += " dmg-crit";
    if (isHeal) classes += " heal-number";
    
    el.className = classes;
    
    // 隨機一點點 X 軸偏移，避免數字重疊
    const randX = (Math.random() - 0.5) * 60;
    el.style.left = `calc(50% + ${randX}px)`;

    parentEl.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

// 通用浮動文字 (用於技能名稱或 Miss)
function createFloatingText(parentEl, text, colorClass = "text-white", topOffset = 0) {
    if (!parentEl) return;
    const el = document.createElement('div');
    el.className = `absolute left-1/2 -translate-x-1/2 text-2xl z-50 animate-[bounceIn_0.6s_ease-out] ${colorClass} whitespace-nowrap drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]`;
    el.style.top = topOffset !== 0 ? `${topOffset}px` : '50%';
    el.innerText = text;
    parentEl.appendChild(el);
    setTimeout(() => el.remove(), 1500);
}

// Card-free round resolution.
async function resolveRoundLogic(roomId, room) {
    const host = room.host;
    const guest = room.guest;
    const tHost = host.answerTime ? host.answerTime.toMillis() : Date.now() + 999999;
    const tGuest = guest.answerTime ? guest.answerTime.toMillis() : Date.now() + 999999;
    let turnOrder;
    if (host.answerCorrect && !guest.answerCorrect) turnOrder = ['host', 'guest'];
    else if (!host.answerCorrect && guest.answerCorrect) turnOrder = ['guest', 'host'];
    else turnOrder = tHost < tGuest ? ['host', 'guest'] : ['guest', 'host'];

    const roomRef = doc(db, "rooms", roomId);
    await runTransaction(db, async (transaction) => {
        const freshDoc = await transaction.get(roomRef);
        if (!freshDoc.exists()) return;
        const freshRoom = freshDoc.data();
        let h = { ...freshRoom.host };
        let g = { ...freshRoom.guest };
        h.maxHp = Number(h.maxHp || 100); h.hp = Number(h.hp ?? h.maxHp); h.atk = Number(h.atk || 20);
        g.maxHp = Number(g.maxHp || 100); g.hp = Number(g.hp ?? g.maxHp); g.atk = Number(g.atk || 20);
        const battleLog = [];

        for (const attackerRole of turnOrder) {
            const attacker = attackerRole === 'host' ? h : g;
            const defender = attackerRole === 'host' ? g : h;
            if (defender.hp <= 0 || attacker.hp <= 0) continue;
            if (attacker.answerCorrect) {
                const baseDamage = Math.max(1, attacker.atk);
                const attackEffect = window.resolveGoldenCoreBattleAttack?.({ attacker, defender, baseDamage }) || {};
                const extraDamage = Math.max(0, Number(attackEffect.extraDamage) || 0);
                const intendedDamage = baseDamage + extraDamage;
                const defenderHpBefore = Math.max(0, Number(defender.hp) || 0);
                const receivedDamage = Math.min(defenderHpBefore, intendedDamage);
                defender.hp = Math.max(0, defenderHpBefore - intendedDamage);
                if (defender.hp === 0) defender.isDead = true;
                battleLog.push({
                    attacker: attackerRole, isHit: true, dmg: intendedDamage,
                    skill: attackEffect.skill || '答題攻擊', healed: null
                });

                if (defender.hp > 0 && receivedDamage > 0) {
                    const counterEffect = window.resolveGoldenCoreBattleCounter?.({
                        defender, attacker, receivedDamage
                    }) || {};
                    const reflectDamage = Math.max(0, Number(counterEffect.reflectDamage) || 0);
                    if (reflectDamage > 0) {
                        const defenderRole = attackerRole === 'host' ? 'guest' : 'host';
                        attacker.hp = Math.max(0, Number(attacker.hp || 0) - reflectDamage);
                        if (attacker.hp === 0) attacker.isDead = true;
                        battleLog.push({
                            attacker: defenderRole, isHit: true, dmg: reflectDamage,
                            skill: counterEffect.skill || '萬劫雷霆丹・雷光反擊', healed: null
                        });
                    }
                }
            } else {
                battleLog.push({ attacker: attackerRole, isHit: false, dmg: 0, skill: 'MISS', healed: null });
            }
        }

        let status = 'ready';
        let winnerUid = null;
        if (h.isDead || g.isDead || freshRoom.round >= 10) {
            status = 'finished';
            if (h.hp > g.hp) winnerUid = h.uid;
            else if (g.hp > h.hp) winnerUid = g.uid;
        }

        transaction.update(roomRef, {
            host: h, guest: g,
            round: status === 'finished' ? freshRoom.round : freshRoom.round + 1,
            battleLog, battleLogId: Date.now().toString(), status, winner: winnerUid,
            'host.done': false, 'guest.done': false,
            'host.answerCorrect': null, 'guest.answerCorrect': null,
            'host.answerTime': null, 'guest.answerTime': null
        });
    });
}
// Battle victory reward
async function processBattleWin(loserData, msgEl) {
    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        currentUserData.stats.gold = (currentUserData.stats.gold || 0) + 500;
        currentUserData.stats.totalScore += 10; // 勝出獲得 10 點修為
        currentUserData.stats.totalCorrect += 5;
        
        const currentScore = currentUserData.stats.totalScore || 0;
        const newRank = calculateRankFromScore(currentScore);
        await updateDoc(userRef, {
            "stats.totalScore": currentUserData.stats.totalScore,
            "stats.gold": currentUserData.stats.gold,
            "stats.totalCorrect": currentUserData.stats.totalCorrect,
            "stats.rankLevel": newRank
        });
        currentUserData.stats.rankLevel = newRank;
        msgEl.innerHTML = `獲得獎勵：<br>💰 500 金幣<br>✨ 10 修為`;
        updateUIStats();
    } catch (e) {
        console.error("Reward failed", e);
        msgEl.innerText = "結算發生錯誤，請聯繫管理員";
    }
}
// [修改] 處理對戰答題 (標記 done)
async function handleBattleAnswer(roomId, userIdx, correctIdx, isHost) {
    const isCorrect = userIdx === correctIdx;
    if (navigator.vibrate) navigator.vibrate(isCorrect ? 50 : 200);

    const btns = document.querySelectorAll('#battle-options button');
    btns.forEach((btn, idx) => {
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        if (idx === correctIdx) btn.classList.add('bg-green-600', 'border-green-400', 'text-white');
        else if (idx === userIdx && !isCorrect) btn.classList.add('bg-red-600', 'border-red-400', 'text-white');
    });

    // 顯示解析
    const fbBox = document.getElementById('battle-feedback');
    const fbStatus = document.getElementById('battle-fb-status');
    const fbText = document.getElementById('battle-fb-text');
    const currentExp = window.currentBattleExp || "AI 未提供解析"; 

    fbBox.classList.remove('hidden');
    fbStatus.innerHTML = isCorrect 
        ? '<span class="text-green-400"><i class="fa-solid fa-check"></i> 回答正確！</span>' 
        : '<span class="text-red-400"><i class="fa-solid fa-xmark"></i> 回答錯誤...</span>';
    fbText.innerHTML = parseMarkdownImages(currentExp);

    document.getElementById('battle-waiting-msg').classList.remove('hidden');

    const roomRef = doc(db, "rooms", roomId);
    const meField = isHost ? "host" : "guest";
    try {
        await updateDoc(roomRef, {
            [`${meField}.done`]: true,
            [`${meField}.answerCorrect`]: isCorrect,
            [`${meField}.answerTime`]: serverTimestamp()
        });
    } catch (e) { console.error(e); }
}

let lastVisibleHistoryDoc = null; // 🔥 記錄最後一筆文件，用於分頁

window.loadUserHistory = async (isLoadMore = false) => {
    const ul = document.getElementById('history-list');
    const loadMoreBtn = document.getElementById('btn-load-more-history');
    if(!ul) return; 
    
    // 首次載入時：清空列表與重置指標
    if (!isLoadMore) {
        ul.innerHTML = `<li class="text-center py-10"><div class="loader"></div></li>`;
        lastVisibleHistoryDoc = null;
        if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
    } else {
        // 加載更多時：按鈕變成讀取中
        if (loadMoreBtn) {
            loadMoreBtn.innerText = "載入中...";
            loadMoreBtn.disabled = true;
        }
    }

    try {
        let q;
        const baseQueryArgs = [
            collection(db, "exam_logs"),
            where("uid", "==", auth.currentUser.uid),
            orderBy("timestamp", "desc")
        ];

        if (isLoadMore && lastVisibleHistoryDoc) {
            q = query(...baseQueryArgs, startAfter(lastVisibleHistoryDoc), limit(20));
        } else {
            q = query(...baseQueryArgs, limit(20));
        }

        const snap = await getDocs(q);
        
        if (!isLoadMore) ul.innerHTML = ''; // 首次載入成功後清空 loader

        if (snap.empty) { 
            if (!isLoadMore) ul.innerHTML = `<li class="text-center text-gray-500 py-4">目前還沒有答題紀錄</li>`;
            if (loadMoreBtn) loadMoreBtn.classList.add('hidden');
            return; 
        }

        // 記錄最後一筆供下次載入使用
        lastVisibleHistoryDoc = snap.docs[snap.docs.length - 1];

        snap.forEach(doc => {
            const log = doc.data();
            const time = log.timestamp ? new Date(log.timestamp.toDate()).toLocaleString() : '--';
            const li = document.createElement('li');
            
            // 加入 hover 效果與滑鼠游標樣式，提示可點擊
            li.className = `p-3 rounded-lg text-xs border-l-4 mb-2 bg-slate-700/50 hover:bg-slate-600/60 transition cursor-pointer ${log.isCorrect ? 'border-green-500' : 'border-red-500'}`;
            
            // 🔥 建立隱藏的詳細資料區塊 HTML
            let detailsHtml = '';
            if (log.options && log.options.length > 0) {
                // 渲染四個選項，並標示對錯顏色
                const optsHtml = log.options.map((opt, i) => {
                    let isUserAns = (i === log.userIdx);
                    let isCorrectAns = (i === log.correctIdx);
                    
                    let bgClass = "bg-slate-800/50";
                    let textClass = "text-gray-400";
                    let icon = "";
                    
                    if (isCorrectAns) {
                        bgClass = "bg-green-900/30 border border-green-500/50";
                        textClass = "text-green-400 font-bold";
                        icon = "<i class='fa-solid fa-check ml-1'></i>";
                    } else if (isUserAns) {
                        bgClass = "bg-red-900/30 border border-red-500/50";
                        textClass = "text-red-400";
                        icon = "<i class='fa-solid fa-xmark ml-1'></i>";
                    }

                    return `<div class="p-2 mb-1 rounded text-[11px] ${bgClass} ${textClass} flex items-start gap-2">
                        <span class="shrink-0 w-4">${String.fromCharCode(65+i)}.</span>
                        <span class="flex-1">${opt} ${icon}</span>
                    </div>`;
                }).join('');

                detailsHtml = `
                    <div class="hidden mt-3 pt-3 border-t border-white/10 details-panel transition-all">
                        <div class="space-y-1 mb-2">${optsHtml}</div>
                        <div class="bg-slate-900/80 p-3 rounded-lg text-gray-300 border border-white/5 text-[11px] leading-relaxed">
                            <span class="text-cyan-400 font-bold mb-1 block"><i class="fa-solid fa-magnifying-glass"></i> AI 解析：</span>
                            ${parseMarkdownImages(log.explanation) || "無解析"}
                        </div>
                    </div>
                `;
            } else {
                // 針對以前沒有存到詳細資料的舊紀錄
                detailsHtml = `
                    <div class="hidden mt-3 pt-3 border-t border-white/10 details-panel transition-all text-gray-500 text-center text-[10px]">
                        (此為早期紀錄，未保留選項與解析資料)
                    </div>
                `;
            }

            // 綁定點擊展開/收合事件
            li.onclick = function(e) {
                // 若玩家點擊的是解析文字本身 (為了反白複製等)，不要觸發收合
                if (e.target.closest('.details-panel')) return;
                const panel = this.querySelector('.details-panel');
                if (panel) panel.classList.toggle('hidden');
            };

            // ... 前面的 snap.forEach 迴圈 ...
            li.innerHTML = `
                <div class="flex justify-between mb-1">
                    <span class="text-gray-400 font-mono">${time}</span>
                    <span class="${log.isCorrect ? 'text-green-400' : 'text-red-400'} font-bold">${log.isCorrect ? 'Correct' : 'Wrong'}</span>
                </div>
                <div class="text-white mb-2 text-sm">${log.question}</div>
                <div class="flex justify-between items-center text-gray-500 mt-2">
                    <span class="text-[10px] text-cyan-500/70 opacity-80"><i class="fa-solid fa-chevron-down"></i> 點擊展開詳解</span>
                    <span class="text-right">${log.rankAtTime || '單人模式'}</span>
                </div>
                ${detailsHtml}
            `;
            ul.appendChild(li);
        }); // 迴圈結束在這裡

        // 🔥 新增這段：資料載入完畢後，要求 MathJax 重新掃描歷史清單
        if (window.MathJax) {
            window.MathJax.typesetPromise([ul]).catch((err) => console.log('MathJax Error:', err.message));
        }

        if (loadMoreBtn) {
            if (snap.docs.length === 20) {
                loadMoreBtn.classList.remove('hidden');
                loadMoreBtn.innerText = "加載更多...";
                loadMoreBtn.disabled = false;
            } else {
                loadMoreBtn.classList.add('hidden');
            }
        }

    } catch (e) { 
        console.error(e); 
        if (!isLoadMore) ul.innerHTML = '<li class="text-center text-red-400 py-4">載入失敗，請稍後再試</li>';
        if (loadMoreBtn) {
            loadMoreBtn.innerText = "加載更多...";
            loadMoreBtn.disabled = false;
        }
    }
};


// ==========================================
// 📊 全新能力分析圖譜演算法 (Radar Chart)
// ==========================================

let knowledgeChartInstance = null;

// 輔助函式：計算五大領域的綜合正確率
function calculateDomainScore(map, subjects) {
    let totalCorrect = 0;
    let totalQuestions = 0;
    subjects.forEach(subj => {
        if (map[subj]) {
            Object.values(map[subj]).forEach(subStats => {
                totalCorrect += (subStats.correct || 0);
                totalQuestions += (subStats.total || 0);
            });
        }
    });
    if (totalQuestions === 0) return 0; // 無數據時顯示 0
    return Math.round((totalCorrect / totalQuestions) * 100);
}

// ==========================================
// 📊 全服排名百分比 (Top X%) 計算系統
// ==========================================
let globalUsersStatsCache = null; // 快取全服資料，避免切換科目時重複發送請求

async function fetchAllUsersForPercentile() {
    if (globalUsersStatsCache) return globalUsersStatsCache;
    try {
        const snap = await getDocs(collection(db, "users"));
        const users = [];
        snap.forEach(doc => users.push(doc.data()));
        globalUsersStatsCache = users; // 暫存起來
        return users;
    } catch (e) {
        console.error("[Percentile Error] 無法取得全服資料:", e);
        return [];
    }
}

window.updatePercentileDisplay = async (targetSubject, myMap) => {
    const displayDiv = document.getElementById('percentile-display');
    const textEl = document.getElementById('percentile-text');
    if (!displayDiv || !textEl) return;

    displayDiv.classList.remove('hidden');
    textEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-cyan-400 text-xl"></i> <span class="text-gray-400 ml-2">雲端運算中...</span>';

    const allUsers = await fetchAllUsersForPercentile();
    if (!allUsers || allUsers.length <= 1) {
        textEl.innerHTML = '<span class="text-gray-400">數據收集中，目前暫無足夠的全服資料。</span>';
        return;
    }

    let myScore = 0;
    let othersScores = [];

    // 1. 決定計算模式 (綜合 vs 單科)
    if (targetSubject) {
        // 單科模式
        myScore = calculateDomainScore(myMap, [targetSubject]);
        allUsers.forEach(u => {
            const uMap = (u.stats && u.stats.knowledgeMap) ? u.stats.knowledgeMap : {};
            othersScores.push(calculateDomainScore(uMap, [targetSubject]));
        });
    } else {
        // 綜合模式 (五大領域平均)
        const domains = [ ["國文"], ["英文"], ["數學"], ["歷史", "地理", "公民"], ["物理", "化學", "生物"] ];
        const calcOverall = (userMap) => {
            let total = 0;
            domains.forEach(d => total += calculateDomainScore(userMap, d));
            return total / domains.length;
        };
        
        myScore = calcOverall(myMap);
        allUsers.forEach(u => {
            const uMap = (u.stats && u.stats.knowledgeMap) ? u.stats.knowledgeMap : {};
            othersScores.push(calcOverall(uMap));
        });
    }

    // 2. 計算贏過多少人
    let worseCount = 0;
    let equalCount = 0;
    othersScores.forEach(score => {
        if (score < myScore) worseCount++;
        else if (score === myScore) equalCount++;
    });

    // 3. 計算 PR 值與前幾 %
    // 同分者算贏過一半的人，較為平滑
    const percentile = (worseCount + Math.floor(equalCount / 2)) / allUsers.length;
    let topPercent = Math.round((1 - percentile) * 100);

    // 防呆處理 (極端值修飾)
    if (topPercent <= 0) topPercent = 1; 
    if (topPercent >= 100 && myScore > 0) topPercent = 99;
    if (myScore === 0) topPercent = 100; // 如果都沒作答過，就是 100% (墊底)

    const beatPercent = 100 - topPercent;
    const title = targetSubject ? targetSubject : '綜合能力';

    // 4. 渲染結果 (套用你的 Cyberpunk 樣式)
    textEl.innerHTML = `
        <span class="text-gray-300">你的 <span class="text-white font-black">${title}</span> 擊敗了全服</span> 
        <span class="text-2xl text-yellow-400 font-black font-sci tracking-wider mx-1 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]">${beatPercent}%</span> 
        <span class="text-gray-300">的玩家</span>
        <div class="mt-1.5 text-xs text-cyan-300 bg-cyan-900/30 inline-block px-3 py-1 rounded-full border border-cyan-500/30">
            <i class="fa-solid fa-ranking-star mr-1"></i> 位於全服前 <span class="font-bold text-white font-mono">${topPercent} %</span>
        </div>
    `;
};

// 主渲染函式
window.renderKnowledgeGraph = (targetSubject = null) => {
    const ctx = document.getElementById('knowledgeChart');
    if (!ctx) return;

    // 安全取得使用者知識圖譜數據 (如果尚未產生則給空物件)
    const map = (currentUserData && currentUserData.stats && currentUserData.stats.knowledgeMap) ? currentUserData.stats.knowledgeMap : {};

    // 🔥 呼叫我們剛剛寫的：更新全服前幾%顯示
    if (window.updatePercentileDisplay) {
        window.updatePercentileDisplay(targetSubject, map);
    }

    // 1. 生成與更新切換按鈕 (放置於專屬的 chart-controls 容器內)
    const controls = document.getElementById('chart-controls');
    if (controls) {
        // 如果還沒有按鈕，就初始化它們
        if (controls.children.length === 0) {
            const subjects = [
                { id: null, label: "總覽", color: "border-blue-500 text-blue-400" },
                { id: "國文", label: "國文", color: "border-slate-400 text-slate-300" },
                { id: "英文", label: "英文", color: "border-slate-400 text-slate-300" },
                { id: "數學", label: "數學", color: "border-slate-400 text-slate-300" },
                { id: "歷史", label: "歷史", color: "border-amber-500 text-amber-400" }, 
                { id: "地理", label: "地理", color: "border-amber-500 text-amber-400" },
                { id: "公民", label: "公民", color: "border-amber-500 text-amber-400" },
                { id: "物理", label: "物理", color: "border-emerald-500 text-emerald-400" }, 
                { id: "化學", label: "化學", color: "border-emerald-500 text-emerald-400" },
                { id: "生物", label: "生物", color: "border-emerald-500 text-emerald-400" },
            ];

            subjects.forEach(subj => {
                const btn = document.createElement('button');
                btn.innerText = subj.label;
                btn.className = `px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all shadow-md border ${subj.color} bg-slate-800 opacity-50 hover:opacity-100`;
                btn.onclick = () => window.renderKnowledgeGraph(subj.id);
                btn.dataset.subj = subj.id || 'all'; 
                controls.appendChild(btn);
            });
        }

        // 更新按鈕高亮狀態
        controls.querySelectorAll('button').forEach(btn => {
            const isActive = (btn.dataset.subj === (targetSubject || 'all'));
            if (isActive) {
                btn.classList.remove('opacity-50', 'bg-slate-800');
                btn.classList.add('opacity-100', 'bg-white/10', 'ring-1', 'ring-white', 'scale-105');
            } else {
                btn.classList.add('opacity-50', 'bg-slate-800');
                btn.classList.remove('opacity-100', 'bg-white/10', 'ring-1', 'ring-white', 'scale-105');
            }
        });
    }

    // 2. 準備圖表資料與賽博龐克配色
    let labels = [];
    let dataValues = [];
    let chartTitle = "";
    let chartColor = "rgba(34, 211, 238, 1)";     // 亮青色邊框
    let chartBgColor = "rgba(34, 211, 238, 0.2)"; // 青色半透明背景

    if (targetSubject) {
        // --- 單科細項模式 ---
        chartTitle = `[ ${targetSubject} ] 核心能力解析`;
        
        // 依照文組/理組套用不同主題色
        if(["歷史","地理","公民"].includes(targetSubject)) {
            chartColor = "rgba(245, 158, 11, 1)"; // 琥珀色
            chartBgColor = "rgba(245, 158, 11, 0.2)";
        } else if(["物理","化學","生物"].includes(targetSubject)) {
            chartColor = "rgba(16, 185, 129, 1)"; // 翡翠綠
            chartBgColor = "rgba(16, 185, 129, 0.2)";
        }

        // 從前端定義的 Schema 取得軸向 (確保雷達圖即使沒資料也不會變形)
        labels = window.SUBJECT_SCHEMA_FRONTEND?.[targetSubject] || (map[targetSubject] ? Object.keys(map[targetSubject]) : ["尚無資料"]);

        // 填入答題正確率
        dataValues = labels.map(topic => {
            const s = map[targetSubject]?.[topic];
            return (s && s.total > 0) ? Math.round((s.correct / s.total) * 100) : 0;
        });

    } else {
        // --- 全域總覽模式 ---
        chartTitle = "五大領域綜合分析 (Overall)";
        labels = ["國文", "英文", "數學", "社會", "自然"];
        dataValues = [
            calculateDomainScore(map, ["國文"]),
            calculateDomainScore(map, ["英文"]),
            calculateDomainScore(map, ["數學"]),
            calculateDomainScore(map, ["歷史", "地理", "公民"]),
            calculateDomainScore(map, ["物理", "化學", "生物"])
        ];
        chartColor = "rgba(59, 130, 246, 1)"; // 賽博藍
        chartBgColor = "rgba(59, 130, 246, 0.2)";
    }

    // 3. 繪製 Chart.js 雷達圖
    if (knowledgeChartInstance) knowledgeChartInstance.destroy();

    knowledgeChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: [{
                label: '掌握度 (%)',
                data: dataValues,
                backgroundColor: chartBgColor,
                borderColor: chartColor,
                pointBackgroundColor: chartColor,
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: chartColor,
                borderWidth: 2,
                pointRadius: 3,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: { 
                    display: true, 
                    text: chartTitle, 
                    color: '#e2e8f0', 
                    font: { size: 14, family: "'Orbitron', sans-serif" },
                    padding: { bottom: 15 }
                },
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: chartColor,
                    bodyColor: '#fff',
                    borderColor: chartColor,
                    borderWidth: 1,
                    padding: 10,
                    boxPadding: 4,
                    callbacks: {
                        label: function(context) { return ` 正確率: ${context.raw}%`; }
                    }
                }
            },
            scales: {
                r: {
                    angleLines: { color: 'rgba(255, 255, 255, 0.1)' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)', circular: true }, // 圓形網格更有科幻感
                    pointLabels: { 
                        color: '#94a3b8', 
                        font: { size: 10, family: "'Noto Sans TC', sans-serif" } 
                    },
                    suggestedMin: 0,
                    suggestedMax: 100,
                    ticks: { 
                        display: true, 
                        stepSize: 25, 
                        backdropColor: 'transparent',
                        color: 'rgba(255, 255, 255, 0.3)',
                        font: { size: 8 }
                    } 
                }
            }
        }
    });
};

window.loadAdminLogs = async () => {
    const ul = document.getElementById('admin-logs-list');
    if(!ul) return; 
    ul.innerHTML = `<li class="text-center py-10"><div class="loader"></div></li>`;
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
    } catch (e) { ul.innerHTML = '<li class="text-center text-red-400 py-4">Error (Permission Denied)</li>'; }
};

window.loadLeaderboard = async () => {
    const tbody = document.getElementById('leaderboard-body');
    tbody.innerHTML = `<tr><td colspan="3" class="p-8 text-center text-gray-500"><div class="loader"></div> ${t('loading')}</td></tr>`;
    try {
        const q = query(collection(db, "users"), orderBy("stats.rankLevel", "desc"), orderBy("stats.totalScore", "desc"), limit(10));
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
                        ${getRankName(d.stats.rankLevel)} <span class="text-xs text-gray-500 block">${d.stats.totalScore} pts</span>
                    </td>
                </tr>`;
            tbody.innerHTML += row; 
            i++;
        });
    } catch (e) { 
        console.error(e); 
        if(e.message.includes("index")) { tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-yellow-400 text-center text-xs">⚠️ Index Required (F12 Console)</td></tr>'; } 
        else { tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-red-400 text-center">Load Error</td></tr>'; }
    }
};

// ==========================================
//  Visual Helpers
// ==========================================

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
    if (!homeSection) return;

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

// ==========================================
// Admin & Store
// ==========================================
// ==========================================
// 📊 [新增] 實驗數據統計系統 (含動態折線圖與長條圖)
// ==========================================
let adminChartInstance = null;
let currentAdminChartType = 'accuracy'; // 預設顯示正確率
// 儲存從資料庫撈出並分群好的資料
let adminChartData = {
    registrations: {}, // { '2026-10-01': 5, ... }
    active: {},
    questions: {},
    accuracy: { labels: [], data: [] }
};

// 輔助函式：將 Firebase Timestamp 轉為 YYYY-MM-DD 格式 (避免時區問題)
function formatDateKey(timestamp) {
    if (!timestamp) return null;
    const d = timestamp.toDate();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

window.loadAdminStatistics = async () => {
    if (!currentUserData || !currentUserData.isAdmin) return;
    
    const btn = document.querySelector('button[onclick="loadAdminStatistics()"]');
    if(btn) { 
        btn.disabled = true; 
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 計算與繪圖中...'; 
    }

    try {
        // --- 1. 抓取所有使用者資料 (用於註冊、活躍、正確率) ---
        const usersRef = collection(db, "users");
        const snapshot = await getDocs(usersRef);
        
        let totalUsers = snapshot.size;
        let activeUsersCount = 0;
        let globalTotalAnswered = 0;
        let globalTotalCorrect = 0;
        
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));

        let regMap = {};
        let activeMap = {};
        let subjectStats = {};

        snapshot.forEach(doc => {
            const data = doc.data();
            
            // 處理活躍時間分群
            if (data.lastActive) {
                const activeDateObj = data.lastActive.toDate();
                if (activeDateObj > sevenDaysAgo) activeUsersCount++;
                
                const dateKey = formatDateKey(data.lastActive);
                activeMap[dateKey] = (activeMap[dateKey] || 0) + 1;
            }

            // 處理註冊時間分群 (若無 createdAt 則以 lastActive 或今天代替)
            const createTimestamp = data.createdAt || data.lastActive; 
            if (createTimestamp) {
                const dateKey = formatDateKey(createTimestamp);
                regMap[dateKey] = (regMap[dateKey] || 0) + 1;
            }

            // 處理正確率
            const stats = data.stats || {};
            globalTotalAnswered += (stats.totalAnswered || 0);
            globalTotalCorrect += (stats.totalCorrect || 0);

            if (stats.knowledgeMap) {
                for (const [subject, topics] of Object.entries(stats.knowledgeMap)) {
                    if (!subjectStats[subject]) subjectStats[subject] = { correct: 0, total: 0 };
                    for (const [topic, topicData] of Object.entries(topics)) {
                        subjectStats[subject].correct += (topicData.correct || 0);
                        subjectStats[subject].total += (topicData.total || 0);
                    }
                }
            }
        });

        // --- 2. 抓取作答紀錄 (用於作答時間數量折線圖) ---
        // 為了避免超量讀取，這裡抓取最近 2000 筆資料來呈現趨勢
        const logsRef = collection(db, "exam_logs");
        const qSnap = await getDocs(query(logsRef, orderBy("timestamp", "desc"), limit(2000)));
        let qMap = {};
        
        qSnap.forEach(doc => {
            const data = doc.data();
            if (data.timestamp) {
                const dateKey = formatDateKey(data.timestamp);
                qMap[dateKey] = (qMap[dateKey] || 0) + 1;
            }
        });

        // --- 3. 整理圖表結構並存入全域變數 ---
        adminChartData.registrations = regMap;
        adminChartData.active = activeMap;
        adminChartData.questions = qMap;

        const accLabels = [];
        const accData = [];
        for (const [subject, data] of Object.entries(subjectStats)) {
            if (data.total > 0) {
                accLabels.push(subject);
                accData.push(((data.correct / data.total) * 100).toFixed(1));
            }
        }
        adminChartData.accuracy = { labels: accLabels, data: accData };

        // --- 4. 更新上方四格數字 UI ---
        document.getElementById('admin-stat-total-users').innerText = totalUsers;
        document.getElementById('admin-stat-active-users').innerText = activeUsersCount;
        document.getElementById('admin-stat-total-q').innerText = globalTotalAnswered;
        const globalAcc = globalTotalAnswered > 0 ? ((globalTotalCorrect / globalTotalAnswered) * 100).toFixed(1) : "0.0";
        document.getElementById('admin-stat-accuracy').innerText = `${globalAcc}%`;

        // --- 5. 渲染圖表 ---
        switchAdminChart(currentAdminChartType);

    } catch (e) {
        console.error("載入數據統計失敗", e);
        alert("讀取統計數據失敗");
    } finally {
        if(btn) { 
            btn.disabled = false; 
            btn.innerHTML = '<i class="fa-solid fa-rotate"></i> 重新計算數據'; 
        }
    }
};

// ==========================================
// 切換圖表核心邏輯
// ==========================================
window.switchAdminChart = (type) => {
    currentAdminChartType = type;
    
    // 更新按鈕高亮狀態
    document.querySelectorAll('.admin-stat-card').forEach(card => {
        card.classList.remove('border-cyan-500/50', 'shadow-[0_0_15px_rgba(34,211,238,0.2)]');
        card.classList.add('border-white/5');
    });
    const activeCard = document.getElementById(`admin-card-${type}`);
    if (activeCard) {
        activeCard.classList.remove('border-white/5');
        activeCard.classList.add('border-cyan-500/50', 'shadow-[0_0_15px_rgba(34,211,238,0.2)]');
    }

    const ctx = document.getElementById('adminMainChart');
    if (!ctx) return;
    if (adminChartInstance) adminChartInstance.destroy();

    // 輔助：生成時間序列折線圖 Config
    const buildTimeSeriesConfig = (dataMap, labelTitle, lineColor, fillColor) => {
        // 將日期排序
        const sortedDates = Object.keys(dataMap).sort();
        const dataValues = sortedDates.map(date => dataMap[date]);
        
        return {
            type: 'line',
            data: {
                labels: sortedDates.length > 0 ? sortedDates : ['無資料'],
                datasets: [{
                    label: labelTitle,
                    data: dataValues.length > 0 ? dataValues : [0],
                    borderColor: lineColor,
                    backgroundColor: fillColor,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3, // 曲線平滑度
                    pointBackgroundColor: lineColor,
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: labelTitle, color: '#e2e8f0', font: { size: 14 } }
                },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: '#94a3b8', stepSize: 1 } },
                    x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
                }
            }
        };
    };

    let chartConfig = {};

    // 根據點擊類型生成不同圖表
    if (type === 'registrations') {
        chartConfig = buildTimeSeriesConfig(adminChartData.registrations, '每日註冊人數趨勢', '#f8fafc', 'rgba(248, 250, 252, 0.1)'); // 白色
    } 
    else if (type === 'active') {
        chartConfig = buildTimeSeriesConfig(adminChartData.active, '每日登入活躍人數', '#4ade80', 'rgba(74, 222, 128, 0.1)'); // 綠色
    } 
    else if (type === 'questions') {
        chartConfig = buildTimeSeriesConfig(adminChartData.questions, '每日作答總題數 (近2000筆估計)', '#facc15', 'rgba(250, 204, 21, 0.1)'); // 黃色
    } 
    else if (type === 'accuracy') {
        chartConfig = {
            type: 'bar',
            data: {
                labels: adminChartData.accuracy.labels.length > 0 ? adminChartData.accuracy.labels : ['尚無實驗數據'],
                datasets: [{
                    label: '各科平均正確率 (%)',
                    data: adminChartData.accuracy.data.length > 0 ? adminChartData.accuracy.data : [0],
                    backgroundColor: 'rgba(34, 211, 238, 0.6)',
                    borderColor: '#22d3ee',
                    borderWidth: 1,
                    borderRadius: 4,
                    hoverBackgroundColor: 'rgba(34, 211, 238, 0.9)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    title: { display: true, text: '實驗組各科正確率分佈', color: '#e2e8f0', font: { size: 14 } },
                    tooltip: { callbacks: { label: (ctx) => ` 正確率: ${ctx.raw}%` } }
                },
                scales: {
                    y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255, 255, 255, 0.1)' }, ticks: { color: '#94a3b8', callback: (v) => v + '%' } },
                    x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 12 } } }
                }
            }
        };
    }

    // 實例化圖表
    adminChartInstance = new Chart(ctx, chartConfig);
};

// (請確認保留原本的 loadAdminData 定義，以供網頁載入時呼叫)
window.loadAdminData = async () => {
    loadAdminLogs(); 
    loadAdminStatistics(); // 進入後台時自動抓取並顯示數據
    
    const listContainer = document.getElementById('admin-product-list');
    listContainer.innerHTML = `<div class="text-center text-gray-500">${t('loading')}</div>`;

    try {
        const q = query(collection(db, "products"), orderBy("createdAt", "desc"));
        const snap = await getDocs(q);
        
        listContainer.innerHTML = '';
        if(snap.empty) { listContainer.innerHTML = '<div class="text-center text-gray-500">No products</div>'; return; }

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
                <div class="text-blue-400 text-xs"><i class="fa-solid fa-pen"></i> Edit</div>
            `;
            listContainer.appendChild(div);
        });
    } catch (e) {
        console.error(e);
        listContainer.innerHTML = '<div class="text-red-400 text-center">Load Failed</div>';
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
    
    document.getElementById('admin-form-title').innerText = "✏️ Edit Product";
    const saveBtn = document.getElementById('admin-btn-save'); 
    saveBtn.innerText = "Update";
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
    
    document.getElementById('admin-form-title').innerText = t('admin_add_product');
    const saveBtn = document.getElementById('admin-btn-save');
    saveBtn.innerText = t('btn_save_product');
    saveBtn.classList.replace('bg-blue-600', 'bg-red-600');
    
    document.getElementById('admin-btn-del').classList.add('hidden'); 
    toggleAdminInputPlaceholder(); 
    openAdminForm();
};

window.saveProduct = async () => {
    if (!currentUserData || !currentUserData.isAdmin) return alert("Permission Denied (Admin only)");

    const docId = document.getElementById('admin-edit-id').value; 
    const name = document.getElementById('admin-p-name').value;
    const type = document.getElementById('admin-p-type').value;
    const value = document.getElementById('admin-p-value').value;
    const priceRaw = document.getElementById('admin-p-price').value;
    const price = parseInt(priceRaw);

    if (!name || !value || isNaN(price)) return alert("Please fill all fields");

    const productData = { name, type, value, price, updatedAt: serverTimestamp() };
    const btn = document.getElementById('admin-btn-save');
    btn.innerText = "Processing...";
    btn.disabled = true;

    try {
        if (docId) {
            await updateDoc(doc(db, "products", docId), productData);
            alert(`Product "${name}" updated!`);
        } else {
            productData.createdAt = serverTimestamp();
            await addDoc(collection(db, "products"), productData);
            alert(`Product "${name}" created!`);
        }
        resetAdminForm();
        loadAdminData(); 
    } catch (e) { console.error("Save Error:", e); alert("Operation failed"); } 
    finally {
        btn.disabled = false;
        if(!docId) btn.innerText = t('btn_save_product');
        else btn.innerText = "Update";
    }
};

window.deleteProduct = async () => {
    const docId = document.getElementById('admin-edit-id').value;
    if (!docId) return;
    if (!confirm("Are you sure you want to delete this product?")) return;

    try {
        await deleteDoc(doc(db, "products", docId));
        alert("Deleted successfully");
        resetAdminForm();
        loadAdminData();
    } catch (e) { console.error(e); alert("Delete failed"); }
};

window.toggleAdminInputPlaceholder = async () => {
    const type = document.getElementById('admin-p-type').value;
    const input = document.getElementById('admin-p-value');
    const hint = document.getElementById('admin-hint');
    const selectorDiv = document.getElementById('admin-asset-selector');

    selectorDiv.classList.remove('hidden');

    if (type === 'frame') {
        input.placeholder = "CSS Class (frame-gold) or Image Path";
        hint.innerText = "Supports CSS classes or image paths";
    } else {
        input.placeholder = "Image Path (e.g., assets/avatar1.png)";
        hint.innerText = "Manual input or select from unused images below";
    }
    await loadUnusedAssets();
};

async function loadUnusedAssets() {
    const select = document.getElementById('admin-asset-select');
    select.innerHTML = '<option value="">Scanning...</option>';
    try {
        const res = await fetch('/api/assets');
        const data = await res.json();
        const allImages = data.images || [];

        const q = query(collection(db, "products"));
        const snap = await getDocs(q);
        const usedImages = new Set();
        snap.forEach(doc => {
            const item = doc.data();
            if (item.value && (item.value.includes('.') || item.value.includes('/'))) { usedImages.add(item.value); }
        });

        const unusedImages = allImages.filter(img => !usedImages.has(img));
        select.innerHTML = `<option value="">${t('admin_select_img')}</option>`;
        if (unusedImages.length === 0) {
            const opt = document.createElement('option');
            opt.innerText = "(No new images found)";
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
    } catch (e) { console.error(e); select.innerHTML = '<option value="">Error</option>'; }
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
    container.innerHTML = `<div class="col-span-4 text-center text-gray-500 py-4"><div class="loader"></div></div>`;

    if (userInv.length === 0) {
        container.innerHTML = `<div class="col-span-4 text-center text-gray-500 py-4 text-xs">Inventory empty. Go to Store!</div>`;
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

    if (count === 0) container.innerHTML = `<div class="col-span-4 text-center text-gray-500 py-4 text-xs">No items found</div>`;
};

window.loadStoreItems = async () => {
    const grid = document.getElementById('store-grid');
    document.getElementById('store-user-points').innerText = currentUserData.stats.gold || 0;
    
    try {
        const q = query(collection(db, "products"), orderBy("price", "asc"));
        const snap = await getDocs(q);
        grid.innerHTML = '';
        
        if (snap.empty) { grid.innerHTML = '<div class="col-span-full text-center text-gray-500 py-10">Store is empty...</div>'; return; }

        snap.forEach(doc => {
            const item = doc.data();
            const pid = doc.id;
            const isOwned = currentUserData.inventory && currentUserData.inventory.includes(pid);
            const isEquipped = (currentUserData.equipped[item.type] === item.value);
            
            let visual = renderVisual(item.type, item.value, "w-14 h-14");
            let btnAction = '';
            if (isEquipped) {
                btnAction = `<button class="w-full mt-auto bg-green-600 text-white text-xs py-2 rounded cursor-default opacity-50 font-bold tracking-wider">${t('btn_equipped')}</button>`;
            } else if (isOwned) {
                btnAction = `<button onclick="equipItem('${item.type}', '${pid}', '${item.value}')" class="w-full mt-auto bg-slate-600 hover:bg-slate-500 text-white text-xs py-2 rounded font-bold tracking-wider">${t('btn_equip')}</button>`;
            } else {
                btnAction = `<button onclick="buyItem('${pid}', ${item.price})" class="w-full mt-auto bg-blue-600 hover:bg-blue-500 text-white text-xs py-2 rounded flex items-center justify-center gap-1 font-bold"><i class="fa-solid fa-coins text-yellow-300"></i> ${item.price}</button>`;
            }

            const card = document.createElement('div');
            // 加入 flex 排版讓商品卡片撐滿高度，且視覺置中，加上一點背景與邊框美化
            card.className = `store-card ${item.type}-item relative flex flex-col items-center text-center bg-slate-800/60 p-4 rounded-xl border border-slate-700 h-full`;
            card.innerHTML = `
                ${isOwned ? '<div class="absolute top-2 right-2 text-green-400 text-[10px] bg-green-900/40 w-5 h-5 flex items-center justify-center rounded-full border border-green-500/50"><i class="fa-solid fa-check"></i></div>' : ''}
                <div class="flex-1 flex flex-col items-center justify-center w-full mb-3">
                    ${visual}
                    <div class="text-sm font-bold text-white mt-3 truncate w-full px-1">${item.name}</div>
                    <div class="text-[10px] text-gray-400 mt-1 uppercase tracking-wider">${item.type === 'frame' ? 'Frame' : 'Avatar'}</div>
                </div>
                ${btnAction}
            `;
            grid.appendChild(card);
        });
    } catch (e) { console.error(e); }
};

window.buyItem = async (pid, price) => {
    if (!currentUserData || !currentUserData.stats) return alert(t('loading'));
    
    // 🔥 檢查與扣除皆改為 gold
    const currentGold = currentUserData.stats.gold || 0;
    if (currentGold < price) return alert(t('msg_no_funds'));
    const isConfirmed = await openConfirm(t('msg_buy_confirm', {price: price}));
    if (!isConfirmed) return;

    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        let newInventory = currentUserData.inventory || [];
        if(newInventory.includes(pid)) return alert("You already own this item");
        
        newInventory.push(pid);
        const newGold = currentGold - price;
        currentUserData.stats.gold = newGold;
        currentUserData.inventory = newInventory;

        await updateDoc(userRef, { "stats.gold": newGold, "inventory": newInventory });

        alert(t('msg_buy_success'));
        updateUIStats();
        loadStoreItems();
        if(document.getElementById('page-settings').classList.contains('active-page')) renderInventory();
    } catch(e) { console.error(e); alert("Purchase failed: " + e.message); }
};

window.equipItem = async (type, pid, value) => {
    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        if (type === 'frame') currentUserData.equipped.frame = value;
        if (type === 'avatar') currentUserData.equipped.avatar = value;

        await updateDoc(userRef, { "equipped": currentUserData.equipped });

        updateUserAvatarDisplay();
        loadStoreItems(); 
        if(document.getElementById('page-settings').classList.contains('active-page')) renderInventory();
    } catch (e) { console.error(e); alert("Equip failed"); }
};

window.filterStore = (type, btnElement) => {
    const items = document.querySelectorAll('.store-card');
    items.forEach(item => {
        if (type === 'all') { item.classList.remove('hidden'); } 
        else {
            if (item.classList.contains(`${type}-item`)) { item.classList.remove('hidden'); } 
            else { item.classList.add('hidden'); }
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
    // 🔥 啟動除錯器 (如果是管理員)
    if (isAdmin) {
        if (window.setupAdminDebug) window.setupAdminDebug();
    }

    const navGrid = document.getElementById('nav-grid');
    if (isAdmin && !document.getElementById('btn-admin-nav')) {
        navGrid.classList.remove('grid-cols-5'); 
        navGrid.classList.add('grid-cols-6');
        const btn = document.createElement('button');
        btn.id = "btn-admin-nav"; btn.dataset.target = "page-admin";
        btn.className = "flex flex-col items-center justify-center hover:bg-white/5 text-gray-400 hover:text-red-400 transition group";
        btn.onclick = () => { loadAdminLogs(); switchToPage('page-admin'); };
        btn.innerHTML = `<i class="fa-solid fa-user-shield mb-1 text-lg group-hover:text-red-400 transition-colors"></i><span class="text-[10px]">${t('nav_admin')}</span>`;
        navGrid.appendChild(btn);
    }
}

// 系統強制重整觸發函式 (Admin Only)
window.triggerGlobalReload = async () => {
    if (!currentUserData || !currentUserData.isAdmin) return alert("Permission Denied");
    
    if (!confirm("⚠️ 危險操作：確定要強制所有線上玩家重新整理網頁嗎？\n(這將會中斷所有正在進行的對戰)")) return;

    const btn = document.querySelector('button[onclick="triggerGlobalReload()"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<div class="loader w-4 h-4 border-2"></div> Sending...';
    btn.disabled = true;

    try {
        // 更新 timestamp，這會觸發所有客戶端的監聽器
        await setDoc(doc(db, "system", "commands"), {
            reloadToken: Date.now(),
            triggeredBy: currentUserData.displayName,
            triggeredAt: serverTimestamp()
        }, { merge: true });

        alert("已發送重整指令！所有在線玩家將在幾秒後重整。");

    } catch (e) {
        console.error(e);
        alert("指令發送失敗: " + e.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

window.recalculateAllUserRanks = async () => {
    if (!currentUserData || !currentUserData.isAdmin) return alert("Permission Denied");
    if (!confirm(t('msg_recalc_warn'))) return;

    const btn = document.querySelector('button[onclick="recalculateAllUserRanks()"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<div class="loader w-4 h-4 border-2"></div> Processing...';
    btn.disabled = true;

    try {
        const usersRef = collection(db, "users");
        const snapshot = await getDocs(usersRef);
        let count = 0;
        const updates = snapshot.docs.map(async (userDoc) => {
            const data = userDoc.data();
            const stats = data.stats || {};
            const correctRank = calculateRankFromScore(stats.totalScore || 0);
            
            if (stats.rankLevel !== correctRank) {
                count++;
                return updateDoc(doc(db, "users", userDoc.id), { "stats.rankLevel": correctRank });
            }
        });

        await Promise.all(updates);
        alert(`Recalculation Complete! Updated ${count} users.`);

    } catch (e) { console.error(e); alert("Recalculation Failed: " + e.message); } 
    finally { btn.innerHTML = originalText; btn.disabled = false; }
};


window.addEventListener('beforeunload', () => {
    if (isBattleActive && currentBattleId) {
        // 嘗試標記離開 (Best effort)
        // 注意：beforeunload 中能做的操作有限，通常建議用 Navigator.sendBeacon，
        // 但這裡簡單處理，確保至少本地狀態重置
        leaveBattle(); 
    }
});
// ==========================================
// 🛠️ 自定義 Alert 系統 (覆寫原生 alert)
// ==========================================
let customAlertCallback = null; // 用於儲存按下確定後的 callback

// 覆寫原生 alert
window.alert = (message, callback = null) => {
    const modal = document.getElementById('custom-alert-modal');
    const box = document.getElementById('custom-alert-box');
    const msgEl = document.getElementById('custom-alert-msg');
    
    if (!modal || !msgEl) {
        console.warn("Custom alert modal not found, using console.");
        console.log(message);
        if(callback) callback();
        return;
    }

    // 設定內容
    msgEl.innerText = message;
    customAlertCallback = callback;

    // 顯示動畫
    modal.classList.remove('hidden');
    // 強制重繪以觸發 transition
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        box.classList.remove('scale-95');
        box.classList.add('scale-100');
    });

    // 播放提示音效 (如果有的話)
    if (navigator.vibrate) navigator.vibrate(50);
};

// 關閉 Alert
window.closeCustomAlert = () => {
    const modal = document.getElementById('custom-alert-modal');
    const box = document.getElementById('custom-alert-box');

    // 隱藏動畫
    modal.classList.add('opacity-0');
    box.classList.remove('scale-100');
    box.classList.add('scale-95');

    setTimeout(() => {
        modal.classList.add('hidden');
        // 如果有 callback (例如重整頁面)，則執行
        if (customAlertCallback) {
            const cb = customAlertCallback;
            customAlertCallback = null;
            cb();
        }
    }, 300); // 等待動畫結束
};

// ==========================================
// 🛠️ 自定義 Confirm 系統 (Promise based)
// ==========================================
let confirmResolver = null; // 用於儲存 Promise 的 resolve 函式

window.openConfirm = (message) => {
    const modal = document.getElementById('custom-confirm-modal');
    const box = document.getElementById('custom-confirm-box');
    const msgEl = document.getElementById('custom-confirm-msg');
    
    // 如果找不到 modal，降級使用原生 confirm
    if (!modal || !msgEl) return Promise.resolve(confirm(message));

    msgEl.innerText = message;
    
    // 顯示動畫
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        box.classList.remove('scale-95');
        box.classList.add('scale-100');
    });

    // 回傳 Promise，暫停程式執行直到使用者點擊按鈕
    return new Promise((resolve) => {
        confirmResolver = resolve;
    });
};

window.resolveCustomConfirm = (result) => {
    const modal = document.getElementById('custom-confirm-modal');
    const box = document.getElementById('custom-confirm-box');

    // 隱藏動畫
    modal.classList.add('opacity-0');
    box.classList.remove('scale-100');
    box.classList.add('scale-95');

    setTimeout(() => {
        modal.classList.add('hidden');
        if (confirmResolver) {
            confirmResolver(result); // 解開 Promise，回傳 true 或 false
            confirmResolver = null;
        }
    }, 300);
};
