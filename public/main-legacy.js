import './cultivation/true-immortal.js';
import { createSoloQuestionCache } from './solo-question-cache.js';
import { ensureSecondaryFirebaseAuth } from './cultivation/firebase-projects.js';
// 🔥 修正：使用純 URL 引入 Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, 
    query, orderBy, limit, getDocs, serverTimestamp, where, onSnapshot, runTransaction, 
    arrayUnion, arrayRemove, writeBatch, startAfter 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { applyCultivationReward, showCultivationFeedback } from './cultivation-rules.js';
import { nascentSoulSpiritReward, normalizeSpirit } from './cultivation/nascent-soul-rules.js';

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
window.getRealmUserUid = () => auth.currentUser?.uid;
const db = getFirestore();
const provider = new GoogleAuthProvider();
// The optional cross-project bootstrap must finish before optional gameplay modules start.
window.__xiuxianMigrationApproved = false;

let currentUserData = null;
// 🔥 新增這行：將玩家資料開放給修仙模組讀取
window.getCurrentUserData = () => currentUserData;

function hasCompletedPlayerProfile(profile = currentUserData?.profile) {
    const value = (input) => String(input ?? '').trim();
    return Boolean(
        value(profile?.educationLevel) &&
        value(profile?.strongSubjects) &&
        value(profile?.weakSubjects)
    );
}
window.hasCompletedPlayerProfile = hasCompletedPlayerProfile;

function populateOnboardingInputs() {
    const profile = currentUserData?.profile || {};
    const level = document.getElementById('ob-level');
    const strong = document.getElementById('ob-strong');
    const weak = document.getElementById('ob-weak');
    if (level && profile.educationLevel) level.value = profile.educationLevel;
    if (strong) strong.value = String(profile.strongSubjects || '');
    if (weak) weak.value = String(profile.weakSubjects || '');
}

function ensureGameplayNavigationForReadyProfile() {
    if (!auth.currentUser || document.getElementById('game-startup-gate')) return;
    if (!hasCompletedPlayerProfile(currentUserData?.profile)) return;
    document.getElementById('bottom-nav')?.classList.remove('hidden');
}

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
const BUFFER_SIZE = 1;               // 只預取一題，減少切換範圍時浪費的 API 呼叫
let isFetchingBuffer = false;
let bufferFillPromise = null; 
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

// Persist unanswered solo questions for the current account/range only.
const soloQuestionCache = createSoloQuestionCache(window.localStorage);
let soloCacheIdentity = '';
let soloQuizOpenSerial = 0;

function soloQuestionScope() {
    const settings = currentUserData?.gameSettings || {};
    const profile = currentUserData?.profile || {};
    const mode = settings.sourceMode || 'random';
    const units = mode === 'focused' && Array.isArray(settings.focusedUnits)
        ? settings.focusedUnits.map((unit) => ({
            path: String(unit?.path || ''),
            detail: String(unit?.detail || ''),
            topics: Array.isArray(unit?.sub_topics) ? unit.sub_topics.map(String).sort() : []
        })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
        : [];
    return JSON.stringify({
        mode,
        source: mode === 'bank' ? String(settings.source || 'ai') : '',
        units,
        difficulty: String(settings.difficulty || 'auto'),
        level: String(profile.educationLevel || ''),
        weakSubjects: mode === 'focused' ? String(profile.weakSubjects || '') : '',
        language: currentLang
    });
}

function syncSoloQuestionCache() {
    const uid = auth.currentUser?.uid || '';
    if (!uid || !currentUserData) return '';
    const scope = soloQuestionScope();
    const identity = JSON.stringify([uid, scope]);
    if (soloCacheIdentity !== identity) {
        // Discard the previous account/range and any in-flight buffer when scope changes.
        soloQuestionCache.activate(uid, scope);
        soloCacheIdentity = identity;
        quizBuffer = soloQuestionCache.getQueue();
        window.currentActiveQuiz = soloQuestionCache.getActive();
        soloQuizOpenSerial += 1;
        if (!soloQuestionCache.isPersistent()) {
            console.warn('[Solo question cache] Browser storage unavailable; unanswered questions may not survive a reload.');
        }
    }
    return scope;
}


function recentSoloQuestionContext() {
    syncSoloQuestionCache();
    const history = soloQuestionCache.getHistory();
    const pending = [
        soloQuestionCache.getActive(),
        ...soloQuestionCache.getQueue()
    ].filter(Boolean).map(item => ({
        q: item?.data?.q || '',
        concept_id: item?.meta?.concept_id || '',
        template_id: item?.meta?.template_id || '',
        question_form: item?.meta?.question_form || '',
        cognitive_level: item?.meta?.cognitive_level || 1,
        reasoning_steps: item?.meta?.reasoning_steps || 1
    }));
    const combined = [...history, ...pending].slice(-80);
    return {
        avoidQuestions: combined.map(item => String(item?.q || '')).filter(Boolean),
        avoidQuestionMeta: combined
    };
}

function quizMetaFromRaw(rawData = {}) {
    return {
        concept_id: String(rawData.concept_id || '').slice(0, 100),
        template_id: String(rawData.template_id || '').slice(0, 120),
        question_form: String(rawData.question_form || '').slice(0, 60),
        cognitive_level: Math.max(1, Math.min(5, Number(rawData.cognitive_level) || 1)),
        reasoning_steps: Math.max(1, Math.min(6, Number(rawData.reasoning_steps) || 1))
    };
}

function pickBankQuestionWithoutReplacement(pool, drawKey) {
    if (!Array.isArray(pool) || pool.length === 0) return null;
    if (!currentBankData) return pool[Math.floor(Math.random() * pool.length)];
    if (!currentBankData.drawBags) currentBankData.drawBags = {};

    const key = String(drawKey || 'default');
    let state = currentBankData.drawBags[key];
    if (!state || !Array.isArray(state.order) || state.order.length === 0) {
        const order = Array.from({ length: pool.length }, (_, index) => index);
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        if (state?.lastIndex != null && order.length > 1 && order[0] === state.lastIndex) {
            [order[0], order[1]] = [order[1], order[0]];
        }
        state = { order, lastIndex: state?.lastIndex ?? null };
        currentBankData.drawBags[key] = state;
    }

    const index = state.order.shift();
    state.lastIndex = index;
    return pool[index] || pool[0];
}


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
        nav_home: "仙府",
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
    if (currentUserData) { syncSoloQuestionCache(); void fillBuffer(); }
};
// ==========================================
// 🛠️ 管理員 Debugger：啟動階段先記錄，確認管理員身分才顯示。
// 技術故障只送到 Debugger；一般遊戲操作提示保留在原有 UI。
// ==========================================
const xiuxianDebugBuffer = [];
const XIUXIAN_DEBUG_LIMIT = 200;
let xiuxianDebugWriter = null;
const xiuxianNativeError = console.error.bind(console);
const xiuxianNativeWarn = console.warn.bind(console);
const xiuxianNativeLog = console.log.bind(console);

function formatXiuxianDebugArg(arg) {
    if (arg instanceof Error) return arg.stack || arg.message || String(arg);
    if (typeof arg === 'object' && arg !== null) {
        try { return JSON.stringify(arg, null, 2); }
        catch (_) { return '[Object] (Circular)'; }
    }
    return String(arg);
}
function queueXiuxianDebug(type, ...args) {
    const entry = {
        type,
        text: args.map(formatXiuxianDebugArg).join(' '),
        timestamp: Date.now()
    };
    xiuxianDebugBuffer.push(entry);
    if (xiuxianDebugBuffer.length > XIUXIAN_DEBUG_LIMIT) xiuxianDebugBuffer.shift();
    if (currentUserData?.isAdmin === true) xiuxianDebugWriter?.(entry);
}

// 讓所有功能模組都能直接記錄故障，而不用自行製作錯誤視窗。
window.reportXiuxianBug = (source, error, context = '') => {
    queueXiuxianDebug('error', '[BUG]', source, error, context);
};
// 使用者可理解的「金幣不足／材料不足」仍可正常顯示；原始例外、API 回應及堆疊只進 Debugger。
window.xiuxianSafeActionError = (source, error, fallback = '本次操作未完成，請稍後再試。') => {
    window.reportXiuxianBug(source, error);
    const message = String(error?.message || error || '').trim();
    const actionable = /^(?:金幣不足|材料不足|素材不足|靈石不足|修為不足|目前已有|目前沒有|此材料|此法寶|已裝備|需要|需先|請先|尚未登入|不可直接購買|名稱未通過)/;
    return message.length <= 160 && !/[<>\\r\\n]/.test(message) && actionable.test(message)
        ? message
        : fallback;
};
console.error = function (...args) {
    xiuxianNativeError(...args);
    queueXiuxianDebug('error', ...args);
};
console.warn = function (...args) {
    xiuxianNativeWarn(...args);
    queueXiuxianDebug('warn', ...args);
};
// 不覆蓋其他功能模組的 onerror / onunhandledrejection。
window.addEventListener('error', (event) => {
    queueXiuxianDebug('error', event.message || 'Unhandled error',
        `Location: ${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}`,
        event.error?.stack || '');
});
window.addEventListener('unhandledrejection', (event) => {
    queueXiuxianDebug('error', 'Unhandled Promise:', event.reason);
});

window.setupAdminDebug = function () {
    // 連 Debugger 的顯示與日誌寫入都必須由當前登入者的管理員身分決定。
    if (currentUserData?.isAdmin !== true) return;
    if (window.isDebugInit) return;

    const consoleDiv = document.getElementById('admin-debug-console');
    const logContainer = document.getElementById('debug-logs');
    const debugCount = document.getElementById('debug-count');
    const showBtn = document.getElementById('btn-show-debug');
    if (!consoleDiv || !logContainer || !debugCount || !showBtn) return;
    window.isDebugInit = true;

    showBtn.style.setProperty('position', 'fixed', 'important');
    showBtn.style.setProperty('z-index', '2147483647', 'important');
    showBtn.style.setProperty('pointer-events', 'auto', 'important');
    showBtn.style.setProperty('isolation', 'isolate', 'important');
    consoleDiv.style.setProperty('position', 'fixed', 'important');
    consoleDiv.style.setProperty('z-index', '2147483646', 'important');
    consoleDiv.style.setProperty('pointer-events', 'auto', 'important');
    consoleDiv.style.setProperty('isolation', 'isolate', 'important');

    logContainer.replaceChildren();
    debugCount.textContent = '0';
    consoleDiv.classList.remove('hidden');
    consoleDiv.classList.add('translate-y-full');
    showBtn.classList.remove('hidden');

    xiuxianDebugWriter = (entry) => {
        if (currentUserData?.isAdmin !== true) return;
        const div = document.createElement('div');
        const now = new Date(entry.timestamp);
        const time = now.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
        const type = entry.type;
        div.className = 'break-words whitespace-pre-wrap text-[11px] font-mono border-b border-white/5 pb-1 ' +
            (type === 'error' ? 'text-red-400 font-bold bg-red-900/20 p-1 rounded border-l-2 border-red-500'
                : type === 'warn' ? 'text-yellow-400 bg-yellow-900/10' : 'text-gray-300');
        // 必須使用 textContent，避免遠端回應/錯誤字串注入管理員 Debugger。
        div.textContent = `${time} ${type === 'error' ? '❌' : type === 'warn' ? '⚠️' : '📋'} ${entry.text}`;
        logContainer.prepend(div);
        while (logContainer.children.length > XIUXIAN_DEBUG_LIMIT) logContainer.lastElementChild.remove();
        if (type === 'error') debugCount.textContent = String((Number(debugCount.textContent) || 0) + 1);
    };

    // 包含登入、腳本預載、Firestore 初始化等發生在身分確認前的故障。
    xiuxianDebugBuffer.forEach(xiuxianDebugWriter);
    if (!window.__xiuxianDebugLogHooked) {
        window.__xiuxianDebugLogHooked = true;
        console.log = function (...args) {
            xiuxianNativeLog(...args);
            const msg = args.map(formatXiuxianDebugArg).join(' ');
            if (['[Front-Image]', '[UI-Render]', 'Generate', '戰', 'API Error', 'Prompt'].some(k => msg.includes(k))) {
                queueXiuxianDebug('info', msg);
            }
        };
    }
};
// ==========================================
// 1. 定義修仙境界與升級門檻 (取代舊版段位)
// ==========================================
const REALMS = [
    { name: '凡人', sub: '初入仙途', need: 0 },
    { name: '煉氣', sub: '一層', need: 1 },
    { name: '煉氣', sub: '二層', need: 2 },
    { name: '煉氣', sub: '三層', need: 3 },
    { name: '煉氣', sub: '四層', need: 4 },
    { name: '煉氣', sub: '五層', need: 5 },
    { name: '煉氣', sub: '六層', need: 6 },
    { name: '煉氣', sub: '七層', need: 7 },
    { name: '煉氣', sub: '八層', need: 8 },
    { name: '煉氣', sub: '九層', need: 9 },
    { name: '築基', sub: '初期', need: 10 },
    { name: '築基', sub: '中期', need: 16 },
    { name: '築基', sub: '後期', need: 22 },
    { name: '金丹', sub: '丹成一品', need: 28 },
    { name: '元嬰', sub: '元嬰出竅', need: 68 },
    { name: '化神', sub: '神念通天', need: 188 },
    { name: '煉虛', sub: '虛空悟道', need: 428 },
    { name: '合體', sub: '天地合一', need: 788 },
    { name: '大乘', sub: '大道將成', need: 1268 },
    { name: '渡劫', sub: '雷劫問道', need: 1868 },
    { name: '半仙', sub: '仙門在望', need: 2588 },
    { name: '真仙', sub: '榜上仙位', need: 2588 }
];

function getRankName(level, uid = auth.currentUser?.uid, score = currentUserData?.stats?.totalScore) {
    const idx = window.limitImmortalRank(Math.min(level || 0, REALMS.length - 1), score, REALMS, uid);
    const r = REALMS[idx];
    return `${r.name} ${r.sub}`;
}

// 僅在 HTML 顯示場合附加向量紋章；AI 題目難度與資料欄位仍保留純文字境界。
function getRankMarkup(level, uid = auth.currentUser?.uid, score = currentUserData?.stats?.totalScore) {
    const idx = window.limitImmortalRank(Math.min(level || 0, REALMS.length - 1), score, REALMS, uid);
    const realm = REALMS[idx] || REALMS[0];
    return `${window.getRealmIconMarkup?.(realm.name) || ''} ${realm.name} ${realm.sub}`;
}

function calculateRankFromScore(totalScore, uid = auth.currentUser?.uid) {
    let rank = 0;
    for (let i = REALMS.length - 1; i >= 0; i--) {
        if (totalScore >= REALMS[i].need) {
            rank = i;
            break;
        }
    }
    return window.limitImmortalRank(rank, totalScore, REALMS, uid);
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
// 🚪 遊戲啟動閘門：登入後等所有功能腳本載入完成才進遊戲
// ==========================================
const GAME_STARTUP_TIPS = [
    '洞府可以調整出題範圍、難度與個人設定。',
    '洞天首次完整通關可獲得靈石，題數越多，獎勵也越高。',
    '修煉頁的背包可以查看持有法寶與煉器素材。',
    '築基之後會逐步開啟更多修煉與鬥法內容。',
    '遇見其他修士的洞天時，進入前可先查看主人、科目與題數。',
    '煉器任務開始後，即使離開煉器頁面，等待進度仍會保留。'
];

function ensureGameStartupGateStyle() {
    if (document.getElementById('game-startup-gate-style')) return;
    const style = document.createElement('style');
    style.id = 'game-startup-gate-style';
    style.textContent = `
        #game-startup-gate{
            position:fixed;inset:0;z-index:30000;width:100vw;height:100dvh;
            overflow:hidden;background:#050505;color:#f3e5bf;
            font-family:var(--xq-serif,'Noto Sans TC',sans-serif)
        }
        #game-startup-gate .game-startup-visual{
            position:absolute;inset:0;overflow:hidden;background:#070704
        }
        #game-startup-gate .game-startup-visual img{
            width:100%;height:100%;display:block;object-fit:cover;object-position:center 56%;
            filter:saturate(.82) contrast(1.08) brightness(.72);transform:scale(1.015)
        }
        #game-startup-gate .game-startup-veil{
            position:absolute;inset:0;
            background:
                linear-gradient(180deg,rgba(3,4,3,.24) 0%,rgba(3,4,3,.18) 28%,rgba(3,4,3,.58) 66%,rgba(3,4,3,.94) 100%),
                radial-gradient(circle at 50% 42%,rgba(222,184,94,.08),transparent 36%),
                linear-gradient(90deg,rgba(0,0,0,.46),transparent 34%,transparent 66%,rgba(0,0,0,.46))
        }
        #game-startup-gate .game-startup-content{
            position:relative;z-index:2;width:min(920px,calc(100vw - 36px));height:100%;
            margin:0 auto;padding:clamp(28px,6vh,72px) 0 clamp(30px,7vh,78px);
            box-sizing:border-box;display:flex;flex-direction:column;justify-content:flex-end
        }
        #game-startup-gate .game-startup-brand{
            margin-bottom:auto;display:flex;align-items:center;gap:9px;
            color:rgba(238,214,155,.82);font-size:10px;font-weight:900;letter-spacing:.24em;text-transform:uppercase
        }
        #game-startup-gate .game-startup-brand:before{
            content:'';width:30px;height:1px;background:linear-gradient(90deg,#d8b15d,transparent)
        }
        #game-startup-gate .game-startup-copy{width:100%;max-width:760px;margin-left:auto;margin-right:auto;text-shadow:0 4px 24px rgba(0,0,0,.82)}
        #game-startup-gate .game-startup-kicker{
            color:#d9b96d;font-size:9px;font-weight:900;letter-spacing:.32em
        }
        #game-startup-gate h1{
            margin:7px 0 5px;color:#f5e8c8;font:900 clamp(28px,5vw,54px)/1.06 var(--xq-serif,'Noto Sans TC',sans-serif);
            letter-spacing:.06em
        }
        #game-startup-gate-text{
            margin:0;color:#b7a783;font-size:clamp(10px,1.2vw,13px);line-height:1.75
        }
        #game-startup-gate .game-startup-progress-wrap{width:min(720px,100%);margin:clamp(20px,3.2vh,34px) auto 0}
        #game-startup-gate .game-startup-tip-row{
            min-height:22px;margin-bottom:8px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px
        }
        #game-startup-gate-tip{
            color:#d2c09a;font-size:clamp(9px,1.1vw,12px);line-height:1.55;
            transition:opacity .18s ease,transform .18s ease
        }
        #game-startup-gate-percent{
            flex:0 0 auto;color:#ecd48f;font-size:13px;font-weight:900;font-variant-numeric:tabular-nums
        }
        #game-startup-gate .game-startup-track{
            position:relative;height:9px;border:1px solid rgba(229,197,111,.22);border-radius:999px;
            overflow:hidden;background:rgba(4,4,3,.62);box-shadow:inset 0 0 18px rgba(0,0,0,.72),0 0 0 1px rgba(0,0,0,.18)
        }
        #game-startup-gate-progress{
            position:absolute;inset:0 auto 0 0;width:0%;
            background:linear-gradient(90deg,#70511d 0%,#d7ad50 54%,#f4df9a 100%);
            box-shadow:0 0 22px rgba(220,177,83,.44);transition:width .28s cubic-bezier(.2,.75,.28,1)
        }
        #game-startup-gate-progress:after{
            content:'';position:absolute;right:-16px;top:50%;width:34px;height:18px;transform:translateY(-50%);
            background:radial-gradient(circle,rgba(255,237,180,.78),rgba(235,192,91,.22) 42%,transparent 70%);
            filter:blur(2px)
        }
        #game-startup-gate .game-startup-meta{
            margin-top:8px;display:flex;justify-content:space-between;gap:14px;color:#7f755f;font-size:8px;letter-spacing:.08em
        }
        #game-startup-gate-error{display:none;margin-top:18px}
        #game-startup-gate-error button{
            min-height:40px;padding:0 18px;border:1px solid rgba(216,177,93,.38);border-radius:11px;
            background:rgba(16,12,5,.72);color:#f0d99a;font-size:9px;font-weight:900;backdrop-filter:blur(8px)
        }
        #game-startup-gate.is-error #game-startup-gate-text{color:#fecaca}
        #game-startup-gate.is-error #game-startup-gate-progress{
            background:linear-gradient(90deg,#7f1d1d,#ef4444,#fca5a5);box-shadow:0 0 22px rgba(239,68,68,.34)
        }
        @media(max-width:640px){
            #game-startup-gate .game-startup-content{width:calc(100vw - 28px);padding-top:24px;padding-bottom:34px}
            #game-startup-gate .game-startup-visual img{object-position:58% center}
            #game-startup-gate .game-startup-tip-row{align-items:flex-start}
            #game-startup-gate-tip{max-width:78%}
        }
        @media(prefers-reduced-motion:reduce){
            #game-startup-gate-progress,#game-startup-gate-tip{transition:none}
            #game-startup-gate .game-startup-visual img{transform:none}
        }
    `;
    document.head.appendChild(style);
}

function gameStartupTip(loaded = 0, total = 0) {
    if (!GAME_STARTUP_TIPS.length) return '';
    if (!total) return GAME_STARTUP_TIPS[0];
    const ratio = Math.max(0, Math.min(1, Number(loaded) / Math.max(1, Number(total))));
    const index = Math.min(GAME_STARTUP_TIPS.length - 1, Math.floor(ratio * GAME_STARTUP_TIPS.length));
    return GAME_STARTUP_TIPS[index];
}

function updateGameStartupProgress(loaded = 0, total = 0) {
    const gate = ensureGameStartupGate();
    const safeTotal = Math.max(0, Number(total) || 0);
    const safeLoaded = safeTotal ? Math.max(0, Math.min(Number(loaded) || 0, safeTotal)) : 0;
    const percent = safeTotal ? Math.round((safeLoaded / safeTotal) * 100) : 0;
    const fill = gate.querySelector('#game-startup-gate-progress');
    const percentText = gate.querySelector('#game-startup-gate-percent');
    const count = gate.querySelector('#game-startup-gate-count');
    const tip = gate.querySelector('#game-startup-gate-tip');
    if (fill) fill.style.width = `${percent}%`;
    if (percentText) percentText.textContent = `${percent}%`;
    if (count) count.textContent = safeTotal ? `${safeLoaded} / ${safeTotal} 個功能` : '準備載入';
    if (tip) tip.textContent = `修行小提示：${gameStartupTip(safeLoaded, safeTotal)}`;
    gate.dataset.loaded = String(safeLoaded);
    gate.dataset.total = String(safeTotal);
}

function ensureGameStartupGate() {
    let gate = document.getElementById('game-startup-gate');
    if (gate) return gate;
    ensureGameStartupGateStyle();
    gate = document.createElement('div');
    gate.id = 'game-startup-gate';
    gate.setAttribute('role', 'status');
    gate.setAttribute('aria-live', 'polite');
    gate.innerHTML = `
        <div class="game-startup-visual" aria-hidden="true">
            <img src="assets/xianxia-loading-scene.svg" alt="" decoding="async">
            <div class="game-startup-veil"></div>
        </div>
        <div class="game-startup-content">
            <div class="game-startup-brand">QINGYUN · CULTIVATION REALM</div>
            <div class="game-startup-copy">
                <div class="game-startup-kicker">一念入道 · 萬法將啟</div>
                <h1>仙府載入中</h1>
                <p id="game-startup-gate-text">正在準備玩家資料…</p>
                <div class="game-startup-progress-wrap">
                    <div class="game-startup-tip-row">
                        <span id="game-startup-gate-tip">修行小提示：${GAME_STARTUP_TIPS[0]}</span>
                        <span id="game-startup-gate-percent">0%</span>
                    </div>
                    <div class="game-startup-track" aria-label="載入進度">
                        <i id="game-startup-gate-progress"></i>
                    </div>
                    <div class="game-startup-meta">
                        <span id="game-startup-gate-count">準備載入</span>
                        <span>正在喚醒仙府諸般法門</span>
                    </div>
                </div>
                <div id="game-startup-gate-error">
                    <button type="button" onclick="location.reload()"><i class="fa-solid fa-rotate-right"></i> 重新整理</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(gate);
    updateGameStartupProgress(0, 0);
    return gate;
}

function showGameStartupGate(message = '正在載入全部功能腳本…') {
    const gate = ensureGameStartupGate();
    gate.style.display = 'block';
    gate.classList.remove('is-error');
    const text = gate.querySelector('#game-startup-gate-text');
    if (text) text.textContent = message;
    const error = gate.querySelector('#game-startup-gate-error');
    if (error) error.style.display = 'none';
    document.getElementById('login-screen')?.classList.add('hidden');
    document.getElementById('bottom-nav')?.classList.add('hidden');
}

function showGameStartupFailure(message) {
    window.reportXiuxianBug?.('Startup gate', message || '功能腳本載入失敗');
    const gate = ensureGameStartupGate();
    gate.classList.add('is-error');
    const text = gate.querySelector('#game-startup-gate-text');
    // 一般玩家僅得到安全的重試指引，不顯示失敗模組與例外細節。
    if (text) text.textContent = String(message || '遊戲尚未準備完成，請重新整理後再試。').slice(0, 160);
    const tip = gate.querySelector('#game-startup-gate-tip');
    if (tip) tip.textContent = '請確認網路連線，然後重新整理遊戲。';
    const error = gate.querySelector('#game-startup-gate-error');
    if (error) error.style.display = 'block';
}

function hideGameStartupGate() {
    document.getElementById('game-startup-gate')?.remove();
}

async function waitForVerifiedPlayerMigration(user) {
    // Server feature flag keeps the existing A-only game available until the
    // three server-side credentials, freeze, rules and migration are configured.
    const token = await user.getIdToken();
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
    for (;;) {
        if (auth.currentUser?.uid !== user.uid) throw new Error('登入帳號已更換，請重新進入遊戲。');
        const response = await fetch('/api/game-startup-migration', {
            method: 'POST', cache: 'no-store', headers, body: '{}'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || '無法確認洞天資料搬移狀態，請重新整理後重試。');
        if (payload.status === 'legacy' && payload.ready === true) return;
        if (payload.status === 'ready' && payload.ready === true) {
            showGameStartupGate('正在核對你的 BD、C 玩家資料…');
            const synced = await fetch('/api/game-startup-player', {
                method: 'POST', cache: 'no-store', headers, body: '{}'
            });
            const record = await synced.json().catch(() => ({}));
            if (!synced.ok || record.ready !== true || record.uid !== user.uid ||
                !record.profiles?.BD || !record.profiles?.C) {
                throw new Error(record.message || '跨專案玩家資料尚未建立完成。');
            }
            // Both profiles now exist. Exchange the A ID token for distinct
            // BD/C Firebase Auth sessions before gameplay modules can use rules.
            await Promise.all([
                ensureSecondaryFirebaseAuth('BD'),
                ensureSecondaryFirebaseAuth('C')
            ]);
            if (auth.currentUser?.uid !== user.uid) throw new Error('登入帳號已更換，請重新進入遊戲。');
            return;
        }
        if (payload.status !== 'running' && payload.status !== 'pending') {
            throw new Error(payload.message || '資料尚未準備完成，請聯絡管理員。');
        }
        showGameStartupGate(payload.message || '正在核對洞天資料…');
        // The backend owns a single migration lease; each visitor only polls.
        // Do not initiate another copy or repeatedly read every cave in browsers.
        await new Promise(resolve => setTimeout(resolve, 6000));
    }
}

async function waitForAllGameScripts() {
    const deadline = Date.now() + 15000;
    while (typeof window.waitForXiuxianFeatures !== 'function') {
        if (Date.now() > deadline) throw new Error('啟動器尚未就緒');
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return window.waitForXiuxianFeatures();
}

window.addEventListener('xiuxian:feature-load-progress', (event) => {
    const detail = event.detail || {};
    if (!detail.total) return;
    const loaded = Math.min(Number(detail.loaded) || 0, Number(detail.total) || 0);
    const text = document.getElementById('game-startup-gate-text');
    if (text) text.textContent = loaded >= detail.total
        ? '諸般法門已就緒，正在進入仙府…'
        : '正在載入修仙功能模組…';
    updateGameStartupProgress(loaded, detail.total);
});

// ==========================================
// 🔐 登入狀態監聽 (核心邏輯)
// ==========================================
let immortalBoardUnsub = null;
window.addEventListener('xiuxian:immortals-updated', () => {
    if (currentUserData) updateUIStats();
});
onAuthStateChanged(auth, async (user) => {
    immortalBoardUnsub?.();
    window.setTrueImmortalBoard([], false);
    if (user) immortalBoardUnsub = onSnapshot(collection(db, 'worldImmortals'), (snapshot) => {
        window.setTrueImmortalBoard(snapshot.docs.map(item => ({ ...item.data(), id: item.id })));
    }, (error) => {
        window.setTrueImmortalBoard([], false);
        console.warn('仙位資格讀取失敗', error);
    });
    // 先更新一次介面文字
    updateTexts();

    const userInfoEl = document.getElementById('user-info');

    if (user) {
        // 🔥【關鍵修正】登入後移除 data-i18n 屬性，防止 updateTexts() 把它覆蓋回 "未登入"
        if (userInfoEl) {
            userInfoEl.removeAttribute('data-i18n'); 
            userInfoEl.innerHTML = `<i class="fa-solid fa-user-astronaut"></i> ${user.displayName || '玩家'}`;
        }

        showGameStartupGate('正在載入玩家資料…');
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
                    // 法寶持有與四個裝配欄位一律放在玩家文件，而非瀏覽器。
                    artifactSystem: { inventory: {}, equipped: {}, buffs: {} },
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

            // Verify global cave migration first. On the first visit after cutover,
            // the trusted backend creates minimal BD/C playerProfiles by UID.
            window.__xiuxianMigrationApproved = false;
            showGameStartupGate('正在核對資料搬移狀態…');
            try {
                await waitForVerifiedPlayerMigration(user);
            } catch (error) {
                console.error('[Startup migration]', error);
                showGameStartupFailure(error.message || '資料準備未完成，請重新整理後再試。');
                return;
            }
            if (auth.currentUser?.uid !== user.uid) return;
            window.__xiuxianMigrationApproved = true;
            // 在載入可選功能前啟動管理員 Debugger，確保腳本載入失敗也有紀錄。
            checkAdminRole(currentUserData.isAdmin === true);
            // 玩家資料先就緒，通知主啟動器載入所有修仙功能模組。
            showGameStartupGate('正在載入全部功能腳本…');
            window.dispatchEvent(new CustomEvent('xiuxian:user-data-ready'));

            let featureGateResult;
            try {
                featureGateResult = await waitForAllGameScripts();
            } catch (error) {
                console.error('[Startup gate]', error);
                showGameStartupFailure('功能腳本啟動器沒有就緒，請重新整理後再試。');
                return;
            }
            if (!featureGateResult?.ok) {
                const count = featureGateResult?.failures?.length || 0;
                showGameStartupFailure(`有 ${count} 個功能腳本載入失敗。為避免半套功能開始遊戲，請重新整理後再試。`);
                return;
            }

            // 所有腳本都已成功載入，現在才正式啟動各項監聽與遊戲介面。
            startPresenceSystem();
            startInvitationListener(); 
            listenToSystemCommands();  
            
            updateUserAvatarDisplay();
            updateSettingsInputs();
            checkAdminRole(currentUserData.isAdmin);
            updateUIStats();
            // saved game identity wins over Google profile in every game session
            if (userInfoEl) {
                userInfoEl.removeAttribute('data-i18n');
                userInfoEl.innerHTML = `<i class="fa-solid fa-user-astronaut"></i> ${currentUserData.displayName || user.displayName || '玩家'}`;
            }

            // 根據資料完整度導向；到這裡才解除啟動遮罩並開始遊戲。
            hideGameStartupGate();
            if (!hasCompletedPlayerProfile(currentUserData.profile)) {
                populateOnboardingInputs();
                switchToPage('page-onboarding');
                document.getElementById('bottom-nav').classList.add('hidden');
            } else {
                // 個人資料完成後，不論凡人、煉氣或後續境界都保留底部導覽列。
                document.getElementById('bottom-nav').classList.remove('hidden');
                switchToPage('page-home');
                syncSoloQuestionCache();
                fillBuffer();
            }

        } catch (error) { 
            console.error("Login Data Error:", error); 
            alert("資料載入失敗，請檢查網路"); 
        }
    } else {
        // 👋 登出狀態
        window.__xiuxianMigrationApproved = false;
        checkAdminRole(false);
        currentUserData = null;
        soloCacheIdentity = '';
        soloQuizOpenSerial += 1;
        soloQuestionCache.activate('', '');
        quizBuffer = [];
        window.currentActiveQuiz = null;
        xiuxianDebugBuffer.length = 0;
        if (userInfoEl) {
            // 加回 data-i18n 屬性，讓它顯示翻譯的 "未登入"
            userInfoEl.setAttribute('data-i18n', 'not_logged_in');
            userInfoEl.innerText = t('not_logged_in');
        }

        hideGameStartupGate();
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('bottom-nav').classList.add('hidden');
        
        // 登出時取消監聽，節省資源
        if (inviteUnsub) inviteUnsub();
        if (systemUnsub) systemUnsub();
        if (chatUnsub) chatUnsub();
    }
});

window.addEventListener('xiuxian:stats-updated', ensureGameplayNavigationForReadyProfile);
window.addEventListener('xiuxian:story-chapter-completed', ensureGameplayNavigationForReadyProfile);

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
    const q = query(collection(db, "global_chat"), orderBy("timestamp", "desc"), limit(25));

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
    const rankName = getRankMarkup(msg.rankLevel || 0, msg.uid || null, msg.totalScore ?? 0);
    const time = msg.timestamp ? new Date(msg.timestamp.toMillis()).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...';

    const chatProfile = msg.uid ? ' data-xiuxian-profile="' + escapeHtml(msg.uid) + '"' : '';
    div.innerHTML = `
        <div class="flex-shrink-0 flex flex-col items-center">
            <button type="button" class="xpp-profile-trigger" ${chatProfile} aria-label="查看 ${escapeHtml(msg.displayName || '修士')} 的資料" ${msg.uid ? '' : 'disabled'}>${avatarHtml}</button>
        </div>
        <div class="flex flex-col ${isMe ? 'items-end' : 'items-start'} max-w-[75%]">
            <div class="flex items-baseline gap-2 mb-1">
                <span class="text-[10px] text-yellow-500 font-mono border border-yellow-500/30 px-1 rounded bg-black/20">${rankName}</span>
                <button type="button" class="xpp-profile-trigger text-xs text-gray-400 font-bold" ${chatProfile} ${msg.uid ? '' : 'disabled'}>${escapeHtml(msg.displayName || '修士')}</button>
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
        totalScore: currentUserData.stats?.totalScore || 0,
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
function normalizeQuizSymbols(text) {
    return String(text ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\r\n?/g, '\n')
        // 題庫偶爾直接回傳 HTML entity；先轉成真正符號，再由後續 escapeHtml 安全輸出。
        .replace(/&(?:lt|#60);/gi, '<')
        .replace(/&(?:gt|#62);/gi, '>')
        .replace(/&(?:amp|#38);/gi, '&')
        .replace(/&(?:le|leq);/gi, '≤')
        .replace(/&(?:ge|geq);/gi, '≥')
        .replace(/&(?:ne|neq);/gi, '≠')
        .replace(/&times;/gi, '×')
        .replace(/&divide;/gi, '÷')
        .replace(/&plusmn;/gi, '±')
        .replace(/&radic;/gi, '√')
        .replace(/&infin;/gi, '∞')
        // 常見全形／相似符號統一，避免題目、選項、解析顯示不一致。
        .replace(/﹤|＜/g, '<')
        .replace(/﹥|＞/g, '>')
        .replace(/＆/g, '&')
        .replace(/＝/g, '=')
        .replace(/＋/g, '+')
        .replace(/－/g, '−')
        .replace(/＊/g, '×')
        .replace(/／/g, '/');
}

function sanitizeQuizImageUrl(rawUrl) {
    const url = String(rawUrl || '').trim();
    if (!url) return '';
    // 題庫圖片允許站內相對路徑、http(s) 與 data:image；其餘協定一律拒絕。
    if (/^(?:https?:\/\/|\/|\.\/|\.\.\/|data:image\/)/i.test(url)) return url;
    return '';
}

function formatQuizRichText(text) {
    const source = normalizeQuizSymbols(text);
    if (!source) return '';

    const protectedParts = [];
    const protect = (html) => {
        const token = `@@QUIZ_PART_${protectedParts.length}@@`;
        protectedParts.push(html);
        return token;
    };

    // 先抽出 Markdown 圖片，避免 alt/url 裡的特殊字元被一般文字 escape 破壞。
    let working = source.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, rawUrl) => {
        const safeUrl = sanitizeQuizImageUrl(rawUrl);
        if (!safeUrl) return escapeHtml(_match);
        const safeAlt = escapeHtml(String(alt || ''));
        const safeSrc = escapeHtml(safeUrl);
        return protect(`<div class="my-3 rounded-lg overflow-hidden border border-white/10 shadow-lg bg-black/20"><img src="${safeSrc}" alt="${safeAlt}" class="w-full h-auto block" loading="lazy"></div>`);
    });

    // 抽出 MathJax 區段。支援 $$...$$、$...$、\\[...\\]、\\(...\\)。
    // 一般文字之後全部 escape，因此 x < 3、A&B 不會再被當 HTML。
    const mathPatterns = [
        /\$\$[\s\S]*?\$\$/g,
        /\\\[[\s\S]*?\\\]/g,
        /\\\([\s\S]*?\\\)/g,
        /\$(?!\$)(?:\\.|[^$\\])*?\$/g
    ];
    mathPatterns.forEach((pattern) => {
        working = working.replace(pattern, (math) => protect(math));
    });

    working = escapeHtml(working).replace(/\n/g, '<br>');

    protectedParts.forEach((html, index) => {
        const token = `@@QUIZ_PART_${index}@@`;
        working = working.split(token).join(html);
    });
    return working;
}

// 保留舊名稱給其他既有程式使用，但實際改由安全的共用格式化器處理。
function parseMarkdownImages(text) {
    return formatQuizRichText(text);
}

window.formatQuizRichText = formatQuizRichText;

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
        if (!auth.currentUser || document.visibilityState === 'hidden') return;
        try {
            await updateDoc(doc(db, "users", auth.currentUser.uid), { lastActive: serverTimestamp() });
        } catch (e) { console.error("Presence update failed", e); }
    };
    updatePresence();
    // Online detection uses a five-minute window; two-minute heartbeats are enough.
    presenceInterval = setInterval(updatePresence, 2 * 60 * 1000);
}

// 好友頁一分鐘內重開沿用快照；重新登入或好友名單改變則自動失效。
let friendListReadCache = { key: '', time: 0, docs: null };
let friendListPending = null;
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
        const currentUid = auth.currentUser?.uid || '';
        const friendsKey = currentUid + ':' + JSON.stringify(currentUserData.friends);
        if (!currentUid) return;
        let docs;
        if (friendListReadCache.key === friendsKey && Date.now() - friendListReadCache.time < 60000) {
            docs = friendListReadCache.docs;
        } else {
            if (!friendListPending || friendListPending.key !== friendsKey) {
                friendListPending = {
                    key: friendsKey,
                    promise: Promise.all(currentUserData.friends.map(uid => getDoc(doc(db, "users", uid))))
                };
            }
            const pending = friendListPending;
            try {
                docs = await pending.promise;
                if (auth.currentUser?.uid !== currentUid) return;
                friendListReadCache = { key: friendsKey, time: Date.now(), docs };
            } finally {
                if (friendListPending === pending) friendListPending = null;
            }
        }
        if (auth.currentUser?.uid !== currentUid || friendsKey !== currentUid + ':' + JSON.stringify(currentUserData.friends)) return;
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
                <button type="button" class="xpp-profile-trigger" data-xiuxian-profile="${escapeHtml(d.id)}" aria-label="查看 ${escapeHtml(fData.displayName || '修士')} 的資料">${getAvatarHtml(fData.equipped, "w-12 h-12")}</button>
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-center">
                        <button type="button" class="xpp-profile-trigger font-bold text-white" data-xiuxian-profile="${escapeHtml(d.id)}">${escapeHtml(fData.displayName || '修士')}</button>
                        <span class="text-xs text-yellow-500 font-mono">${getRankMarkup(calculateRankFromScore(fData.stats?.totalScore || 0, d.id), d.id, fData.stats?.totalScore)}</span>
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
    rankEl.innerHTML = getRankMarkup(stats.rankLevel); 
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
    const level = String(document.getElementById('ob-level')?.value || '').trim();
    const rawStrong = String(document.getElementById('ob-strong')?.value || '').trim();
    const rawWeak = String(document.getElementById('ob-weak')?.value || '').trim();
    if (!level || !rawStrong || !rawWeak) {
        alert('請先填完整年級、擅長科目與弱項科目，再開始仙途。');
        return;
    }

    const btn = document.querySelector('button[onclick="submitOnboarding()"]');
    const originalLabel = btn?.innerText || '開始旅程';
    if (btn) { btn.innerText = '資料確認中...'; btn.disabled = true; }

    try {
        const analyzedStrong = await getCleanSubjects(rawStrong);
        const analyzedWeak = await getCleanSubjects(rawWeak);
        const cleanStrong = String(analyzedStrong || rawStrong).trim();
        const cleanWeak = String(analyzedWeak || rawWeak).trim();
        if (!cleanStrong || !cleanWeak) throw new Error('強項或弱項整理後為空白，請重新填寫。');

        await updateDoc(doc(db, "users", auth.currentUser.uid), {
            "profile.educationLevel": level,
            "profile.strongSubjects": cleanStrong,
            "profile.weakSubjects": cleanWeak
        });

        currentUserData.profile.educationLevel = level;
        currentUserData.profile.strongSubjects = cleanStrong;
        currentUserData.profile.weakSubjects = cleanWeak;

        updateSettingsInputs();
        updateUIStats();
        document.getElementById('bottom-nav').classList.remove('hidden');
        switchToPage('page-home');
        localStorage.removeItem('currentQuiz');
        syncSoloQuestionCache();
        fillBuffer();

        // 劇情只能在這個事件之後開始：先完成年級、強項、弱項，再進主線。
        window.dispatchEvent(new CustomEvent('xiuxian:onboarding-completed', {
            detail: { educationLevel: level, strongSubjects: cleanStrong, weakSubjects: cleanWeak }
        }));
    } catch (error) {
        console.error('Onboarding save failed:', error);
        alert(error?.message || '資料儲存失敗，請稍後再試。');
    } finally {
        if (btn) { btn.innerText = originalLabel; btn.disabled = false; }
    }
};

window.saveProfile = async (triggerButton = null) => {
    const displayName = document.getElementById('set-display-name').value.trim();
    const level = document.getElementById('set-level').value;
    const rawStrong = document.getElementById('set-strong').value;
    const rawWeak = document.getElementById('set-weak').value;
    const sourceMode = document.getElementById('set-source-mode').value;
    const source = document.getElementById('set-source-final-value').value; 
    const difficulty = document.getElementById('set-difficulty').value;

    if (!displayName) { alert("名稱不能為空！"); return false; }
    if (sourceMode === 'bank' && (!source || source === 'ai')) { alert("請選擇題庫檔案！"); return false; }
    if (sourceMode === 'focused' && (!window.soloSelectedUnits || window.soloSelectedUnits.length === 0)) { alert("請至少加入一個單元！"); return false; }

    // The profile and scope cards have separate save buttons. Display progress
    // on the button the player actually pressed without changing persistence.
    const btn = triggerButton?.matches?.('button')
        ? triggerButton : document.querySelector('button[onclick="saveProfile()"]');
    if (btn) { btn.innerText = "儲存中…"; btn.disabled = true; }
    
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
    syncSoloQuestionCache();
    fillBuffer();
    
    if (btn) {
        const originalLabel = btn.id === 'dongfu-scope-save' ? '儲存出題範圍' : '更新設定';
        btn.innerText = "已儲存！";
        setTimeout(() => {
            if (!btn.isConnected) return;
            btn.textContent = originalLabel;
            btn.disabled = false;
        }, 2000);
    }
    return true;
};

async function switchToAI() {
    await updateDoc(doc(db, "users", auth.currentUser.uid), { "gameSettings.sourceMode": 'random' });
    currentUserData.gameSettings.sourceMode = 'random';
    const sm = document.getElementById('set-source-mode');
    if(sm) { sm.value = 'random'; toggleSourceMode(); }
    syncSoloQuestionCache();
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
    const scope = syncSoloQuestionCache();
    const uid = auth.currentUser?.uid || '';
    // When the player opens the quiz during prefetch, share that existing request.
    if (isFetchingBuffer) return bufferFillPromise;
    if (!scope || !uid || quizBuffer.length >= BUFFER_SIZE) return;
    isFetchingBuffer = true;
    bufferFillPromise = (async () => {
        try {
            while (quizBuffer.length < BUFFER_SIZE && soloQuestionCache.isCurrent(uid, scope) && auth.currentUser?.uid === uid) {
                const question = await fetchOneQuestion();
                // Reject an API response from a previous account or range.
                if (!soloQuestionCache.isCurrent(uid, scope) || auth.currentUser?.uid !== uid ||
                    soloQuestionScope() !== scope) break;
                if (!soloQuestionCache.append(question)) break;
                quizBuffer = soloQuestionCache.getQueue();
            }
        } catch (e) { console.warn("Background fetch failed", e); }
    })();
    try { await bufferFillPromise; }
    finally {
        isFetchingBuffer = false;
        bufferFillPromise = null;
        if (auth.currentUser?.uid && currentUserData && soloQuestionScope() !== scope) {
            syncSoloQuestionCache();
            void fillBuffer();
        }
    }
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
    const scope = syncSoloQuestionCache();
    const uid = auth.currentUser?.uid || '';
    const opening = ++soloQuizOpenSerial;
    if (!scope || !uid) return;

    if (extendedPracticeState.active) {
        document.getElementById('quiz-loading').classList.remove('hidden');
        document.getElementById('loading-text').innerText = `正在生成「${extendedPracticeState.knowledgePoint}」延伸練習…`;
        try {
            const q = await fetchExtendedPracticeQuestion();
            if (opening !== soloQuizOpenSerial || auth.currentUser?.uid !== uid) return;
            window.currentActiveQuiz = q;
            renderQuiz(q.data, q.rank, q.badge);
            return;
        } catch (error) {
            console.error('[Extended Practice]', error);
            extendedPracticeState.active = false;
            document.getElementById('btn-extended-practice-stop')?.classList.add('hidden');
            window.showToast?.('延伸練習出題失敗，已回到原本練習。');
        }
    }

    // Restore an unanswered active question before using the prefetched queue.
    let nextQ = soloQuestionCache.getActive() || soloQuestionCache.takeNext();
    if (!nextQ && isFetchingBuffer) {
        await fillBuffer();
        if (opening !== soloQuizOpenSerial || auth.currentUser?.uid !== uid ||
            soloQuestionScope() !== scope) return;
        nextQ = soloQuestionCache.getActive() || soloQuestionCache.takeNext();
    }
    quizBuffer = soloQuestionCache.getQueue();
    if (nextQ) {
        window.currentActiveQuiz = nextQ;
        renderQuiz(nextQ.data, nextQ.rank, nextQ.badge);
        void fillBuffer();
    } else {
        document.getElementById('quiz-loading').classList.remove('hidden');
        document.getElementById('loading-text').innerText = t('loading_text');
        try {
            const q = await fetchOneQuestion();
            if (opening !== soloQuizOpenSerial || auth.currentUser?.uid !== uid) return;
            if (soloQuestionScope() !== scope) {
                syncSoloQuestionCache();
                void window.startQuizFlow();
                return;
            }
            soloQuestionCache.setActive(q);
            window.currentActiveQuiz = q;
            renderQuiz(q.data, q.rank, q.badge);
            void fillBuffer();
        } catch (e) {
            if (opening !== soloQuizOpenSerial || auth.currentUser?.uid !== uid) return;
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
        // 專注練習的年級以選定單元為準，不應被玩家的個人程度覆蓋。
        const chosenGrade = String(parts[1] || '');
        const curriculumLevel = /^[七7](?:上|下|年級)/.test(chosenGrade) ? '國中一年級'
            : /^[八8](?:上|下|年級)/.test(chosenGrade) ? '國中二年級'
            : /^[九9](?:上|下|年級)/.test(chosenGrade) ? '國中三年級'
            : /^(國小|國中|高中)[一二三四五六]年級/.test(chosenGrade) ? chosenGrade
            : (currentUserData.profile.educationLevel || '國中一年級'); 
        
        let targetTopic = randomUnit.detail || randomUnit.path.replace('.json', '');
        if (randomUnit.sub_topics && randomUnit.sub_topics.length > 0) {
            targetTopic += ` (核心考點細項：${randomUnit.sub_topics.join('、')})`;
        }
        // 高中保留數學 A/B/甲/乙；國小保留國語、生活等學科與上下學期。
        // subject 欄位沿用既有 API 的主科目，指定主題明確註記真正選定的科目。
        if ((chosenGrade.startsWith('高中') || chosenGrade.startsWith('國小')) && parts.length >= 4) {
            const studyTrack = String(parts[3] || subject).slice(0, 16);
            const termName = String(parts[2] || '').slice(0, 20);
            targetTopic = `${chosenGrade}／${termName}／${studyTrack}：${targetTopic}`;
        }
        targetTopic = targetTopic.slice(0, 240);

        const weakSubjects = (currentUserData.profile.weakSubjects || "").split(',').map(s => s.trim());
        // 弱科不等於永遠做 easy；最多只把 hard 暫時降為 medium，保留真正練習深度。
        if (weakSubjects.includes(subject) && finalDifficulty === "hard") finalDifficulty = "medium";

        console.log(`[AI-專注出題] 學科: ${subject} | 範圍: ${targetTopic} | 難度: ${finalDifficulty}`);

        try {
            const response = await fetch("/api/generate-quiz", {
                method: "POST", 
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    subject: subject, 
                    specificTopic: targetTopic, 
                    level: curriculumLevel, 
                    rank: rankName, 
                    difficulty: finalDifficulty,
                    language: currentLang,
                    knowledgeMap: currentUserData.stats.knowledgeMap || {},
                    ...recentSoloQuestionContext()
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
                meta: quizMetaFromRaw(rawData),
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
                currentBankData = { sourcePath: targetSource, questions: mergedQuestions, drawBags: {} };
            } catch (e) { 
                console.error("[Fetch-Bank-Error] 題庫讀取失敗:", e); 
                return await switchToAI(); 
            }
        }

        const filteredQuestions = currentBankData.questions.filter(q => q.difficulty === finalDifficulty);
        const pool = filteredQuestions.length > 0 ? filteredQuestions : currentBankData.questions;
        const seenQuestions = new Set(
            recentSoloQuestionContext().avoidQuestions
                .map(value => String(value || '').toLowerCase().replace(/\s+/g, ''))
                .filter(Boolean)
        );
        const unseenPool = pool.filter(item =>
            !seenQuestions.has(String(item?.q || '').toLowerCase().replace(/\s+/g, ''))
        );
        // 題庫尚有沒做過的題時，只從未看過的題抽；全部做完才開啟新一輪。
        const drawPool = unseenPool.length > 0 ? unseenPool : pool;
        const rawData = pickBankQuestionWithoutReplacement(
            drawPool,
            `${targetSource || 'bank'}|${filteredQuestions.length > 0 ? finalDifficulty : 'all'}|${drawPool.length}`
        );
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
                    knowledgeMap: currentUserData.stats.knowledgeMap || {},
                    ...recentSoloQuestionContext()
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
                meta: quizMetaFromRaw(rawData),
                rank: rankName,
                badge: `🎯 ${rawData.subject} | ${rawData.sub_topic || '綜合'}`
            };
        } catch (e) {
            console.error("[Fetch-AI-Error] AI 一般模式生成失敗:", e);
            throw e;
        }
    }
}

// 閉關三題沿用玩家目前選擇的出題範圍，但獎勵另行結算。
window.fetchDailyMeditationQuestion = fetchOneQuestion;

/// 🔥 修改：在進入下一題前才清除舊題目，確保 startQuizFlow 能抓到新題目
window.nextQuestion = () => {
    // handleAnswer consumes the previous quiz before this action.
    window.currentActiveQuiz = null;
    void startQuizFlow();
};

async function handleAnswer(userIdx, correctIdx, questionText, explanation) {
    if (!currentUserData) return;
    const quiz = window.currentActiveQuiz;
    if (quiz) {
        if (answeredSoloQuizzes.has(quiz)) return;
        answeredSoloQuizzes.add(quiz);
        syncSoloQuestionCache();
        if (soloQuestionCache.getActive()?.data?.q === quiz.data?.q) {
            soloQuestionCache.consumeActive({ remember: true });
        } else {
            soloQuestionCache.remember?.(quiz);
        }
    }

    const timeTaken = (Date.now() - (window.quizStartTime || Date.now())) / 1000;
    const isCorrect = userIdx === correctIdx;
    quizHelperState.answered = true;
    quizHelperState.selectedIndex = Number.isInteger(userIdx) ? userIdx : null;
    quizHelperState.correctIndex = Number.isInteger(correctIdx) ? correctIdx : quizHelperState.correctIndex;
    quizHelperState.explanation = String(explanation || '');
    renderQuizHelperConversation();
    
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
    
    // 題目、選項及答案解析走同一個 queued MathJax pipeline。
    const explanationText = explanation || '未提供解析。';
    if (window.quizMathSet) void window.quizMathSet(fbText, explanationText);
    else {
        // Fallback for early boot and isolated legacy controllers without the local formatter in scope.
        const fallback = window.formatQuizRichText || window.quizMathRichText || (text => String(text ?? ''));
        fbText.innerHTML = fallback(explanationText);
        void window.MathJax?.typesetPromise?.([fbText]).catch(err => console.warn('[Quiz explanation MathJax]', err));
    }

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
    const scoreBeforeAnswer = Math.max(0, Number(stats.totalScore) || 0);
    const shieldBeforeAnswer = !!stats.goldenCoreShield;
    const cultivationReward = applyCultivationReward(stats, isCorrect);
    // 問道每答對一題 +1 神識；以本題作答前的境界判斷，不能越境提前獲取。
    const spiritAdded = nascentSoulSpiritReward({ source: 'solo', score: scoreBeforeAnswer, isCorrect });
    if (spiritAdded) stats.nascentSoulSpirit = normalizeSpirit(stats.nascentSoulSpirit) + spiritAdded;
    // 記下實際扣除的修為；道心擋住扣分或尚未達金丹時皆為 0。
    // 隨本次答題的 stats 一起存入，補償 API 不信任瀏覽器另外送來的扣分金額。
    if (quiz?.data?.q) {
        const scoreAfterAnswer = Math.max(0, Number(stats.totalScore) || 0);
        stats.lastQuizAnswer = {
            question: String(quiz.data.q).normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, 1500),
            isCorrect, scoreBefore: scoreBeforeAnswer, scoreAfter: scoreAfterAnswer,
            penalty: Math.max(0, scoreBeforeAnswer - scoreAfterAnswer),
            answeredAtMs: Date.now()
        };
    }

    stats.totalAnswered++;
    if (isCorrect) {
        stats.totalCorrect++; 
        stats.currentStreak++;
        if (stats.currentStreak > stats.bestStreak) stats.bestStreak = stats.currentStreak;
        
        scoreGain = 20; // 無限模式獎勵
        fbTitle.innerHTML += ` <span class="text-yellow-400 text-sm ml-2 border border-yellow-500 rounded px-1">+${scoreGain}💰 · +${cultivationReward.gain} 修為${spiritAdded ? ` · +${spiritAdded} 神識` : ''}</span>`;
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

    // Neutral answers (no reward, cultivation loss, or persistent shield change)
    // stay local until the next reward. A report explicitly saves its last answer
    // before the API can calculate a trusted refund.
    const shouldSaveAnswer = isCorrect || stats.totalScore !== scoreBeforeAnswer ||
        !!stats.goldenCoreShield !== shieldBeforeAnswer;
    try {
        const p1 = shouldSaveAnswer
            ? updateDoc(doc(db, "users", auth.currentUser.uid), { stats: stats })
                .then(() => showCultivationFeedback(cultivationReward, isCorrect))
            : null;
        if (!shouldSaveAnswer) showCultivationFeedback(cultivationReward, isCorrect);
        void addDoc(collection(db, "exam_logs"), { 
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
        }).catch(error => {
            // 答題歷史為非必要紀錄；寫入失敗不可阻止已保存的答題資料送審。
            console.warn('[Quiz exam log]', error?.code || error?.message || String(error));
        });
        // Only reward/loss writes must block the answer. A neutral answer can
        // still be saved on demand when the player reports that exact question.
        if (quiz) {
            quiz.answerPersistence = p1;
            quiz.answerPersistenceDeferred = !shouldSaveAnswer;
        }
        if (p1) await p1;
    } catch (e) { console.error("Firebase Error", e); }
    
    if (!extendedPracticeState.active) fillBuffer();
}

async function generateVisualAid(imagePrompt) {
    // 直接回傳 null，不再發送請求
    return null;
}

// 2. [修改] renderQuiz 函式 (移除圖片載入邏輯)
const extendedPracticeState = {
    active: false,
    subject: '',
    knowledgePoint: '',
    originQuestion: ''
};

window.isExtendedPracticeActive = () => extendedPracticeState.active;

const quizHelperState = {
    messages: [],
    question: '',
    options: [],
    explanation: '',
    subject: '',
    selectedIndex: null,
    correctIndex: null,
    answered: false,
    busy: false,
    initialized: false,
    manualOpen: null
};

function quizHelperElements() {
    return {
        shell: document.getElementById('quiz-helper-shell'),
        panel: document.getElementById('quiz-helper-panel'),
        launcher: document.getElementById('quiz-helper-launcher'),
        messages: document.getElementById('quiz-helper-messages'),
        input: document.getElementById('quiz-helper-input'),
        send: document.getElementById('quiz-helper-send'),
        status: document.getElementById('quiz-helper-status')
    };
}

function setQuizHelperOpen(open, { remember = true } = {}) {
    const { shell, input } = quizHelperElements();
    if (!shell) return;
    shell.classList.toggle('collapsed', !open);
    shell.classList.toggle('open', open);
    if (remember) quizHelperState.manualOpen = !!open;
    if (open) requestAnimationFrame(() => input?.focus({ preventScroll: true }));
}

window.toggleQuizHelper = (forceOpen) => {
    const { shell } = quizHelperElements();
    if (!shell) return;
    const open = typeof forceOpen === 'boolean' ? forceOpen : shell.classList.contains('collapsed');
    setQuizHelperOpen(open);
};

function quizHelperAppendMessage(role, text, { knowledgePoint = '' } = {}) {
    const { messages } = quizHelperElements();
    if (!messages) return;
    const row = document.createElement('div');
    row.className = 'quiz-helper-message ' + (role === 'assistant' ? 'assistant' : 'user');

    const stack = document.createElement('div');
    stack.className = 'quiz-helper-message-stack';
    const body = document.createElement('div');
    body.className = 'quiz-helper-message-body';
    stack.appendChild(body);
    row.appendChild(stack);
    messages.appendChild(row);

    if (role === 'assistant' && window.quizMathSet) void window.quizMathSet(body, text);
    else body.textContent = text;

    const point = String(knowledgePoint || '').trim().slice(0, 60);
    if (role === 'assistant' && point) {
        const practice = document.createElement('button');
        practice.type = 'button';
        practice.className = 'quiz-helper-practice-btn';
        practice.title = '針對這個知識點繼續練習';
        practice.innerHTML = '<i class="fa-solid fa-graduation-cap"></i><span>延伸練習</span><small></small><i class="fa-solid fa-chevron-right"></i>';
        practice.querySelector('small').textContent = point;
        practice.onclick = () => window.startQuizExtendedPractice(point);
        stack.appendChild(practice);
    }

    requestAnimationFrame(() => {
        messages.scrollTop = messages.scrollHeight;
    });
}

function renderQuizHelperConversation() {
    const { messages } = quizHelperElements();
    if (!messages) return;
    messages.replaceChildren();

    const intro = document.createElement('div');
    intro.className = 'quiz-helper-message assistant intro';
    const introBody = document.createElement('div');
    introBody.className = 'quiz-helper-message-body';
    introBody.textContent = quizHelperState.answered
        ? '你已經作答，可以問我完整解法、錯因或相關觀念。'
        : '卡住了嗎？可以直接問這題。我會先給提示，不會在作答前直接揭曉答案。';
    intro.appendChild(introBody);
    messages.appendChild(intro);

    for (const item of quizHelperState.messages) quizHelperAppendMessage(item.role, item.text, { knowledgePoint: item.knowledgePoint });
}

function initQuizHelper() {
    if (quizHelperState.initialized) return;
    quizHelperState.initialized = true;
    const { input } = quizHelperElements();
    input?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
        event.preventDefault();
        void sendQuizHelperMessage(input.value);
    });
    const media = window.matchMedia?.('(max-width: 1279px)');
    media?.addEventListener?.('change', (event) => {
        if (event.matches) setQuizHelperOpen(false, { remember: false });
        else if (quizHelperState.manualOpen == null) setQuizHelperOpen(true, { remember: false });
    });
}

function resetQuizHelper(data = {}, { topic = '' } = {}) {
    initQuizHelper();
    quizHelperState.messages = [];
    quizHelperState.question = String(data.q || '');
    const topicText = String(topic || '').replace(/[🎯📚]/g, '').trim();
    const topicSubject = topicText.split('|')[0].trim();
    quizHelperState.subject = String(window.currentActiveQuiz?.extendedPracticeSubject || topicSubject || '').slice(0, 40);
    quizHelperState.options = Array.isArray(data.opts) ? data.opts.map(String) : [];
    quizHelperState.explanation = String(data.exp || '');
    quizHelperState.selectedIndex = null;
    quizHelperState.correctIndex = Number.isInteger(data.ans) ? data.ans : null;
    quizHelperState.answered = false;
    quizHelperState.busy = false;
    quizHelperState.manualOpen = null;

    const { input, send, status } = quizHelperElements();
    if (input) input.value = '';
    if (send) send.disabled = false;
    if (status) status.textContent = '';
    renderQuizHelperConversation();

    const desktopOpen = window.matchMedia?.('(min-width: 1280px)')?.matches ?? true;
    setQuizHelperOpen(desktopOpen, { remember: false });
}

async function sendQuizHelperMessage(rawMessage) {
    const message = String(rawMessage || '').trim().slice(0, 600);
    const { input, send, status } = quizHelperElements();
    if (!message || quizHelperState.busy || !quizHelperState.question) return;

    const history = quizHelperState.messages.slice(-6).map(item => ({ role: item.role, text: item.text }));
    quizHelperState.messages.push({ role: 'user', text: message });
    quizHelperAppendMessage('user', message);
    if (input) input.value = '';

    quizHelperState.busy = true;
    if (send) send.disabled = true;
    if (status) status.textContent = '問道助手思索中…';

    try {
        const response = await fetch('/api/question-helper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: quizHelperState.question,
                options: quizHelperState.options,
                message,
                history,
                answered: quizHelperState.answered,
                ...(quizHelperState.answered ? {
                    explanation: quizHelperState.explanation,
                    selectedOption: quizHelperState.selectedIndex >= 0 ? quizHelperState.options[quizHelperState.selectedIndex] : '',
                    correctOption: quizHelperState.correctIndex >= 0 ? quizHelperState.options[quizHelperState.correctIndex] : ''
                } : {})
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        const answer = String(payload.answer || '').trim();
        if (!answer) throw new Error('問道助手沒有回傳內容');
        const knowledgePoint = String(payload.knowledgePoint || '').trim().slice(0, 60);
        quizHelperState.messages.push({ role: 'assistant', text: answer, knowledgePoint });
        quizHelperAppendMessage('assistant', answer, { knowledgePoint });
        if (status) status.textContent = '';
    } catch (error) {
        console.warn('[Quiz helper]', error);
        if (status) status.textContent = error?.message || '問道助手暫時無法回應。';
    } finally {
        quizHelperState.busy = false;
        if (send) send.disabled = false;
        input?.focus({ preventScroll: true });
    }
}

window.submitQuizHelper = (event) => {
    event?.preventDefault?.();
    const { input } = quizHelperElements();
    void sendQuizHelperMessage(input?.value || '');
};

window.askQuizHelperPreset = (message) => {
    setQuizHelperOpen(true);
    void sendQuizHelperMessage(message);
};

async function fetchExtendedPracticeQuestion() {
    const subject = String(extendedPracticeState.subject || quizHelperState.subject || '綜合').trim().slice(0, 40);
    const knowledgePoint = String(extendedPracticeState.knowledgePoint || '本題核心觀念').trim().slice(0, 60);
    const settings = currentUserData?.gameSettings || {};
    const rankName = getRankName(currentUserData?.stats?.rankLevel || 0);
    let difficulty = settings.difficulty;
    if (!difficulty || difficulty === 'auto') difficulty = getSmartDifficulty();

    const response = await fetch('/api/generate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            subject,
            specificTopic: knowledgePoint,
            level: currentUserData?.profile?.educationLevel || 'General',
            rank: rankName,
            difficulty,
            language: currentLang,
            knowledgeMap: currentUserData?.stats?.knowledgeMap || {},
            ...recentSoloQuestionContext()
        })
    });
    if (!response.ok) throw new Error(`Server Error: ${response.status}`);
    const payload = await response.json();
    let aiText = payload.text;
    const jsonMatch = String(aiText || '').match(/\{[\s\S]*\}/);
    if (jsonMatch) aiText = jsonMatch[0];
    const rawData = JSON.parse(aiText);
    const allOptions = shuffleArray([rawData.correct, ...rawData.wrong]);

    return {
        data: {
            q: rawData.q,
            opts: allOptions,
            ans: allOptions.indexOf(rawData.correct),
            exp: rawData.exp
        },
        meta: quizMetaFromRaw(rawData),
        rank: rankName,
        badge: `📚 延伸練習 | ${subject} · ${knowledgePoint}`,
        extendedPractice: true,
        extendedPracticeSubject: subject,
        extendedPracticeKnowledgePoint: knowledgePoint
    };
}

window.startQuizExtendedPractice = async (knowledgePoint) => {
    const point = String(knowledgePoint || '').trim().slice(0, 60);
    if (!point || !currentUserData) return;

    const currentQuiz = window.currentActiveQuiz;
    syncSoloQuestionCache();
    if (currentQuiz && !answeredSoloQuizzes.has(currentQuiz)) {
        if (soloQuestionCache.getActive()?.data?.q === currentQuiz.data?.q) {
            soloQuestionCache.consumeActive({ remember: true });
        } else {
            soloQuestionCache.remember?.(currentQuiz);
        }
    }

    extendedPracticeState.active = true;
    extendedPracticeState.subject = String(quizHelperState.subject || currentQuiz?.extendedPracticeSubject || '綜合').slice(0, 40);
    extendedPracticeState.knowledgePoint = point;
    extendedPracticeState.originQuestion = String(quizHelperState.question || currentQuiz?.data?.q || '').slice(0, 1000);
    window.currentActiveQuiz = null;
    setQuizHelperOpen(false, { remember: false });
    void window.startQuizFlow();
};

window.endQuizExtendedPractice = () => {
    if (!extendedPracticeState.active) return;
    extendedPracticeState.active = false;
    extendedPracticeState.subject = '';
    extendedPracticeState.knowledgePoint = '';
    extendedPracticeState.originQuestion = '';
    const stop = document.getElementById('btn-extended-practice-stop');
    stop?.classList.add('hidden');
    window.showToast?.('已結束延伸練習，下一題回到原本範圍。');
};

const quizWhiteboardState = {
    strokes: [],
    currentStroke: null,
    initialized: false,
    resizeFrame: 0
};

function quizWhiteboardElements() {
    return {
        panel: document.getElementById('quiz-whiteboard-panel'),
        stage: document.getElementById('quiz-whiteboard-stage'),
        canvas: document.getElementById('quiz-whiteboard-canvas'),
        question: document.getElementById('quiz-whiteboard-question'),
        toggle: document.getElementById('btn-quiz-whiteboard')
    };
}

function quizWhiteboardCssSize() {
    const { stage } = quizWhiteboardElements();
    if (!stage) return { width: 0, height: 0 };
    const width = Math.max(240, Math.floor(stage.clientWidth || 0));
    const height = Math.max(220, Math.floor(stage.clientHeight || 0));
    return { width, height };
}

function prepareQuizWhiteboardCanvas() {
    const { canvas } = quizWhiteboardElements();
    if (!canvas) return null;
    const { width, height } = quizWhiteboardCssSize();
    if (!width || !height) return null;

    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#1f2937';
    ctx.fillStyle = '#1f2937';
    return { canvas, ctx, width, height };
}

function redrawQuizWhiteboard() {
    const prepared = prepareQuizWhiteboardCanvas();
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    ctx.clearRect(0, 0, width, height);

    for (const stroke of quizWhiteboardState.strokes) {
        if (!Array.isArray(stroke) || stroke.length === 0) continue;
        if (stroke.length === 1) {
            const point = stroke[0];
            ctx.beginPath();
            ctx.arc(point.x * width, point.y * height, 1.25, 0, Math.PI * 2);
            ctx.fill();
            continue;
        }
        ctx.beginPath();
        stroke.forEach((point, index) => {
            const x = point.x * width;
            const y = point.y * height;
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }
}

function quizWhiteboardPoint(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    };
}

function initQuizWhiteboard() {
    if (quizWhiteboardState.initialized) return;
    const { canvas } = quizWhiteboardElements();
    if (!canvas) return;
    quizWhiteboardState.initialized = true;

    canvas.addEventListener('pointerdown', (event) => {
        if (event.button !== undefined && event.button !== 0 && event.pointerType === 'mouse') return;
        const point = quizWhiteboardPoint(event, canvas);
        if (!point) return;
        event.preventDefault();
        canvas.setPointerCapture?.(event.pointerId);
        const stroke = [point];
        quizWhiteboardState.strokes.push(stroke);
        quizWhiteboardState.currentStroke = stroke;
        redrawQuizWhiteboard();
    });

    canvas.addEventListener('pointermove', (event) => {
        const stroke = quizWhiteboardState.currentStroke;
        if (!stroke) return;
        const point = quizWhiteboardPoint(event, canvas);
        if (!point) return;
        event.preventDefault();
        const previous = stroke[stroke.length - 1];
        if (previous && Math.abs(previous.x - point.x) < 0.001 && Math.abs(previous.y - point.y) < 0.001) return;
        stroke.push(point);
        redrawQuizWhiteboard();
    });

    const finishStroke = (event) => {
        if (!quizWhiteboardState.currentStroke) return;
        event?.preventDefault?.();
        quizWhiteboardState.currentStroke = null;
        if (event?.pointerId != null && canvas.hasPointerCapture?.(event.pointerId)) {
            canvas.releasePointerCapture?.(event.pointerId);
        }
    };
    canvas.addEventListener('pointerup', finishStroke);
    canvas.addEventListener('pointercancel', finishStroke);
    canvas.addEventListener('lostpointercapture', () => {
        quizWhiteboardState.currentStroke = null;
    });

    window.addEventListener('resize', () => {
        const { panel } = quizWhiteboardElements();
        if (!panel || panel.classList.contains('hidden')) return;
        cancelAnimationFrame(quizWhiteboardState.resizeFrame);
        quizWhiteboardState.resizeFrame = requestAnimationFrame(redrawQuizWhiteboard);
    });

    document.addEventListener('keydown', (event) => {
        const { panel } = quizWhiteboardElements();
        if (event.key !== 'Escape' || !panel || panel.classList.contains('hidden')) return;
        window.toggleQuizWhiteboard(false);
    });
}

function resetQuizWhiteboard({ close = true } = {}) {
    quizWhiteboardState.strokes = [];
    quizWhiteboardState.currentStroke = null;
    const { panel, toggle } = quizWhiteboardElements();
    if (close && panel) panel.classList.add('hidden');
    if (close) document.body.classList.remove('quiz-whiteboard-open');
    if (toggle) {
        const isOpen = !close && !!panel && !panel.classList.contains('hidden');
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        toggle.classList.toggle('active', isOpen);
    }
    if (!close && panel && !panel.classList.contains('hidden')) redrawQuizWhiteboard();
}

window.clearQuizWhiteboard = () => {
    resetQuizWhiteboard({ close: false });
};

window.toggleQuizWhiteboard = (forceOpen) => {
    const { panel, toggle } = quizWhiteboardElements();
    if (!panel) return;
    initQuizWhiteboard();

    const shouldOpen = typeof forceOpen === 'boolean'
        ? forceOpen
        : panel.classList.contains('hidden');

    panel.classList.toggle('hidden', !shouldOpen);
    document.body.classList.toggle('quiz-whiteboard-open', shouldOpen);
    toggle?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    toggle?.classList.toggle('active', shouldOpen);

    if (shouldOpen) {
        const sourceQuestion = document.getElementById('question-text');
        const whiteboardQuestion = document.getElementById('quiz-whiteboard-question');
        if (sourceQuestion && whiteboardQuestion) whiteboardQuestion.innerHTML = sourceQuestion.innerHTML;
        requestAnimationFrame(() => {
            redrawQuizWhiteboard();
            panel.querySelector('.quiz-whiteboard-action:last-child')?.focus({ preventScroll: true });
        });
    }
};

function renderQuiz(data, rank, topic) {
    // 每一道新題使用全新的計算空間與問答脈絡，避免上一題殘留。
    resetQuizWhiteboard({ close: true });
    resetQuizHelper(data, { topic });
    const extendedStop = document.getElementById('btn-extended-practice-stop');
    extendedStop?.classList.toggle('hidden', !extendedPracticeState.active);
    document.getElementById('quiz-loading').classList.add('hidden');
    document.getElementById('quiz-container').classList.remove('hidden');
    document.getElementById('quiz-badge').innerText = `${topic} | ${rank}`;
    
    const questionTextEl = document.getElementById('question-text');
    // 更換題目時先清理舊公式，避免 MathJax 快取殘留。
    const container = document.getElementById('options-container');
    window.quizMathClear?.([questionTextEl, container]);
    const renderedQuestion = (window.quizMathRichText || formatQuizRichText)(data.q);
    questionTextEl.innerHTML = renderedQuestion;
    const whiteboardQuestionEl = document.getElementById('quiz-whiteboard-question');
    if (whiteboardQuestionEl) whiteboardQuestionEl.innerHTML = renderedQuestion;

    // 所有選項均採與題幹／解析完全相同的安全 LaTeX 格式化器。
    container.replaceChildren(); 
    data.opts.forEach((optText, idx) => {
        const btn = document.createElement('button');
        btn.id = `option-btn-${idx}`;
        // 🔥 這裡修復了斷裂的字串與 class 名稱
        btn.className = "w-full text-left p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition border border-slate-600 flex items-center gap-3 active:scale-95 mb-2";
        btn.innerHTML = `<span class="bg-slate-800 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-blue-400 border border-slate-600 shrink-0">${String.fromCharCode(65+idx)}</span><span class="flex-1 quiz-rich-option">${(window.quizMathRichText || formatQuizRichText)(optText)}</span>`;
        btn.onclick = () => handleAnswer(idx, data.ans, data.q, data.exp);
        container.appendChild(btn);
    });

    // 等 MathJax 初始化後依序排版，避免快速換題時併發渲染。
    const mathTargets = [questionTextEl, container, whiteboardQuestionEl].filter(Boolean);
    if (window.quizMathTypeset) void window.quizMathTypeset(mathTargets);
    else void window.MathJax?.typesetPromise?.(mathTargets).catch(err => console.warn('[Quiz Math]', err));
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

// 問道題目錯誤回報：審核與補償統一由後端核發；前端只顯示真正完成的交易結果。
let reportSubmitting = false;
let reportQuizSnapshot = null;
let reportCloseTimer = null;

function reportStatus(message = '', isError = false) {
    const status = document.getElementById('report-input-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('hidden', !message);
    status.classList.toggle('text-red-300', isError);
    status.classList.toggle('text-yellow-200', !isError);
}

function reportLoadingStatus(message) {
    const status = document.getElementById('report-loading-status');
    if (status) status.textContent = message;
}

async function waitForReportAnswerSaved(promise, deadlineMs = 12000) {
    let timer;
    try {
        await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('答題資料仍在同步，請稍後再按「送出審查」；目前尚未送審或發放補償。')), deadlineMs);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

function reportView(name) {
    for (const view of ['input', 'loading', 'result']) {
        const el = document.getElementById('report-' + view + '-view');
        if (!el) continue;
        el.classList.toggle('hidden', view !== name);
        el.style.display = view === name && view !== 'input' ? 'flex' : '';
    }
}

function renderReportOutcome({ kind, title, message, actionText = '關閉', onAction = window.closeReportModal, showClose = false }) {
    const colors = {
        approved: { icon: 'circle-check', className: 'text-green-400' },
        rejected: { icon: 'circle-xmark', className: 'text-red-400' },
        incomplete: { icon: 'circle-exclamation', className: 'text-yellow-400' }
    };
    const appearance = colors[kind] || colors.incomplete;
    document.getElementById('report-result-icon').innerHTML =
        '<i class="fa-solid fa-' + appearance.icon + ' ' + appearance.className + '"></i>';
    const heading = document.getElementById('report-result-title');
    heading.textContent = title;
    heading.className = 'text-lg font-bold mb-2 ' + appearance.className;
    document.getElementById('report-result-msg').textContent = message;

    const action = document.getElementById('report-result-action');
    action.textContent = actionText;
    action.onclick = onAction;
    const close = document.getElementById('report-result-close');
    if (close) close.classList.toggle('hidden', !showClose);
    reportView('result');
}

window.openReportModal = () => {
    if (reportSubmitting) {
        reportLoadingStatus('本次回報仍在處理，請勿重複送審。');
        return;
    }
    if (reportCloseTimer) { clearTimeout(reportCloseTimer); reportCloseTimer = null; }
    const quiz = window.currentActiveQuiz;
    if (!quiz?.data?.q || !Array.isArray(quiz.data.opts)) {
        alert('找不到目前題目，請重新開啟問道。');
        return;
    }
    reportQuizSnapshot = quiz;
    const modal = document.getElementById('report-modal');
    const box = document.getElementById('report-box');
    reportView('input');
    document.getElementById('report-reason').value = '';
    reportStatus();
    reportLoadingStatus('正在準備審核…');
    document.getElementById('report-result-icon').innerHTML = '';
    document.getElementById('report-result-title').textContent = '';
    document.getElementById('report-result-msg').textContent = '';
    const btn = document.getElementById('report-result-action');
    if (btn) {
        btn.onclick = () => closeReportModal();
        btn.textContent = '關閉';
    }
    document.getElementById('report-result-close')?.classList.add('hidden');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        box.classList.remove('scale-95');
        box.classList.add('scale-100');
    });
};

window.closeReportModal = () => {
    if (reportSubmitting) return;
    const modal = document.getElementById('report-modal');
    const box = document.getElementById('report-box');
    modal.classList.add('opacity-0');
    box.classList.remove('scale-100');
    box.classList.add('scale-95');
    reportQuizSnapshot = null;
    if (reportCloseTimer) clearTimeout(reportCloseTimer);
    reportCloseTimer = setTimeout(() => {
        if (modal.classList.contains('opacity-0')) modal.classList.add('hidden');
        reportCloseTimer = null;
    }, 300);
};

window.submitReport = async () => {
    if (reportSubmitting) return;
    const reason = document.getElementById('report-reason').value.trim();
    if (reason.length < 6) {
        reportStatus('請具體指出題目錯誤，至少輸入 6 個字元。', true);
        return;
    }
    const quiz = reportQuizSnapshot;
    if (!quiz?.data || quiz !== window.currentActiveQuiz) {
        reportStatus('題目已變更，請關閉視窗並在目前題目重新回報。', true);
        return;
    }
    const user = auth.currentUser;
    if (!user || user.uid !== currentUserData?.uid && currentUserData?.uid) {
        reportStatus('登入狀態已變更，請重新登入。', true);
        return;
    }
    reportSubmitting = true;
    reportStatus();
    reportView('loading');
    reportLoadingStatus('正在等待答題資料同步…');
    let reportStage = 'save-answer';
    try {
        if (quiz.answerPersistenceDeferred && !quiz.answerPersistence) {
            // Do not persist every neutral answer. Save this answer only if the
            // player opens an actual report; the server alone calculates rewards.
            quiz.answerPersistenceDeferred = false;
            quiz.answerPersistence = updateDoc(doc(db, "users", user.uid), {
                'stats.lastQuizAnswer': currentUserData.stats.lastQuizAnswer,
                'stats.totalAnswered': currentUserData.stats.totalAnswered,
                'stats.currentStreak': currentUserData.stats.currentStreak
            });
            void quiz.answerPersistence.catch(() => {
                quiz.answerPersistence = null;
                quiz.answerPersistenceDeferred = true;
            });
        }
        if (quiz.answerPersistence) await waitForReportAnswerSaved(quiz.answerPersistence);
        if (window.currentActiveQuiz !== quiz || auth.currentUser?.uid !== user.uid) {
            throw new Error('題目或登入身分已變更，請重新開啟回報。');
        }
        reportStage = 'get-token';
        reportLoadingStatus('正在確認登入狀態…');
        const token = await user.getIdToken();
        reportStage = 'request';
        reportLoadingStatus('已送交 AI 審核，正在核對題目與補償…');
        const res = await fetch('/api/verify-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({
                question: quiz.data.q,
                options: quiz.data.opts,
                correctIndex: quiz.data.ans,
                explanation: quiz.data.exp,
                userReason: reason
            })
        });
        reportStage = 'response';
        reportLoadingStatus('正在確認審核結果…');
        const result = await res.json().catch(() => ({}));
        if (!res.ok || ['unavailable', 'invalid', 'unauthorized'].includes(result.status)) {
            const error = new Error(result.reason || `題目回報暫時無法處理（HTTP ${res.status}），請稍後重試。`);
            error.httpStatus = res.status;
            error.phase = result.phase || reportStage;
            throw error;
        }

        const skipVerifiedQuestion = () => {
            closeReportModal();
            // A late review must not skip the player's newer question.
            if (window.currentActiveQuiz !== quiz) return;
            syncSoloQuestionCache();
            if (soloQuestionCache.getActive()?.data?.q === quiz.data?.q) {
                soloQuestionCache.consumeActive({ remember: true });
            } else {
                soloQuestionCache.remember?.(quiz);
            }
            window.currentActiveQuiz = null;
            void fillBuffer();
            setTimeout(() => startQuizFlow(), 300);
        };
        const retryReport = () => {
            // Keep the entered reason so a transient server failure is retryable.
            reportStatus();
            reportView('input');
        };

        if (result.status === 'confirmed' && result.compensated === true && result.goldAdded === 100 &&
            Number.isFinite(Number(result.newGold)) && Number.isFinite(Number(result.newTotalScore))) {
            const refunded = Math.max(0, Number(result.cultivationRefund) || 0);
            const extra = Math.max(0, Number(result.cultivationBonus) || 0);
            if (currentUserData?.stats && auth.currentUser?.uid === user.uid) {
                // Only a confirmed server transaction may update the client reward display.
                currentUserData.stats.gold = Number(result.newGold);
                currentUserData.stats.totalScore = Number(result.newTotalScore);
                updateUIStats();
            }
            renderReportOutcome({
                kind: 'approved',
                title: '審查通過 ✅',
                message: (result.reason || '題目確認有誤。') +
                    '\n返還修為 ' + refunded + '，額外獎勵 +' + extra +
                    ' 修為；共 +' + (refunded + extra) + ' 修為、100 靈石已入帳。',
                actionText: '跳過錯題',
                onAction: skipVerifiedQuestion
            });
        } else if (result.status === 'duplicate') {
            renderReportOutcome({
                kind: 'approved',
                title: '此題已通過審查 ✅',
                message: '先前已領取這道題目的補償，不會重複發放；可以直接跳過錯題。',
                actionText: '跳過錯題',
                onAction: skipVerifiedQuestion
            });
        } else if (result.status === 'rejected') {
            renderReportOutcome({
                kind: 'rejected',
                title: '審查未通過 ❌',
                message: (result.reason || '目前沒有足夠證據確認題目錯誤。') +
                    '\n本次不發放補償，可關閉視窗繼續作答。'
            });
        } else {
            // Limit, network errors, uncertain AI output and unsettled payments
            // are NOT an AI rejection; never present them as a paid success.
            const isLimit = result.status === 'limit';
            renderReportOutcome({
                kind: 'incomplete',
                title: isLimit ? '今日補償已達上限' : '本次審查未完成',
                message: (result.reason || '審核服務暫時無法處理，請重新送審。') +
                    '\n本次沒有確認補償入帳。',
                actionText: isLimit ? '關閉' : '重新送審',
                onAction: isLimit ? window.closeReportModal : retryReport,
                showClose: !isLimit
            });
        }
    } catch (error) {
        // 明確記錄階段及 HTTP 狀態，避免只看見 main-legacy.js 的統一警告行號。
        console.warn('[Question report]', {
            phase: error?.phase || reportStage,
            httpStatus: error?.httpStatus || null,
            code: error?.code || null,
            message: error?.message || String(error)
        });
        // A transport/AI/payment error is not a review rejection.
        // Keep the entered reason and offer a retry rather than silently resetting.
        renderReportOutcome({
            kind: 'incomplete',
            title: '本次審查未完成',
            message: (error?.message || '題目審核暫時無法完成，請稍後重試。') +
                '\n本次尚未確認補償入帳。',
            actionText: '重新送審',
            onAction: () => { reportStatus(); reportView('input'); },
            showClose: true
        });
    } finally {
        reportSubmitting = false;
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
    // An active Dongtian quiz must never be covered or interrupted by a duel invitation.
    const dongtianActive = () => {
        const overlay = document.getElementById('dongtian-overlay');
        return !!(overlay && overlay.getClientRects().length && getComputedStyle(overlay).visibility !== 'hidden');
    };
    if (dongtianActive()) {
        const born = data.timestamp?.toMillis?.() || Date.now();
        const retry = setInterval(() => {
            if (Date.now() - born > 2 * 60 * 1000 || !auth.currentUser) {
                clearInterval(retry);
                removeInvite(inviteId, null);
            } else if (!dongtianActive()) {
                clearInterval(retry);
                showInviteToast(inviteId, data);
            }
        }, 1200);
        return;
    }
    // The v2 room protocol cannot be joined through the retired legacy transaction.
    if (data.modeVersion && typeof window.joinBattleRoomV2 !== 'function') return;
    const container = document.getElementById('toast-container');
    if (!container || container.querySelector('[data-duel-invite="' + inviteId + '"]')) return;
    const toast = document.createElement('div');
    toast.dataset.duelInvite = inviteId;
    container.style.position = 'fixed';
    container.style.top = 'max(12px, env(safe-area-inset-top))';
    container.style.right = '12px';
    container.style.left = 'auto';
    container.style.zIndex = '99999';
    toast.style.maxWidth = 'min(360px, calc(100vw - 24px))';
    
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
                <span class="text-white font-bold">${escapeHtml(String(data.hostName || '修士'))}</span> 邀請你鬥法
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

    document.getElementById(`btn-acc-${inviteId}`).onclick = async () => {
        if (data.modeVersion) {
            if (dongtianActive()) return;
            const active = window.getBattleV2State?.();
            if (active?.roomId && active.status !== 'finished') {
                alert('你目前已有進行中的鬥法。');
                return;
            }
            const button = document.getElementById(`btn-acc-${inviteId}`);
            if (button) button.disabled = true;
            const joined = await window.joinBattleRoomV2(data.roomId);
            await removeInvite(inviteId, toast);
            if (!joined) alert('房間已失效、已有對手，或目前無法加入鬥法。');
        } else {
            acceptInvite(inviteId, data.roomId, toast);
        }
    };
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
    const oppRank = getRankMarkup(oppData.rankLevel || 0, oppData.uid || null, oppData.totalScore ?? 0);
    
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

function buildLocalBattlePlayer() {
    const combat = window.getCombatStats?.() || { attack: 20, hp: 100, maxHp: 100 };
    const maxHp = Math.max(1, Math.round(Number(combat.maxHp) || Number(combat.hp) || 100));
    const artifactBattle = window.getArtifactBattleSnapshot?.() || { version: 1, effects: [], openingShield: 0 };
    const openingShield = Math.max(
        0,
        Math.round(
            Number(window.getArtifactBattleOpeningShield?.(artifactBattle)) ||
            Number(artifactBattle.openingShield) ||
            0
        )
    );
    return {
        uid: auth.currentUser.uid,
        name: currentUserData.displayName || "Player",
        equipped: currentUserData.equipped || { frame: '', avatar: '' },
        goldenCore: window.getEquippedGoldenCoreBattleSnapshot?.() || null,
        artifactBattle,
        artifactShield: openingShield,
        artifactFirstHitUsed: false,
        artifactCheatDeathUsed: false,
        rankLevel: currentUserData.stats?.rankLevel || 0,
        totalScore: currentUserData.stats?.totalScore || 0,
        done: false,
        answerCorrect: null,
        answerTime: null,
        isDead: false,
        hp: maxHp,
        maxHp,
        atk: Math.max(1, Math.round(Number(combat.attack) || 20))
    };
}

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
    const myBattleData = buildLocalBattlePlayer();

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
    document.getElementById('match-me-rank').innerHTML = getRankMarkup(currentUserData.stats?.rankLevel || 0);
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
    
    const myBattleData = buildLocalBattlePlayer();

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

                    const questionNode = document.getElementById('battle-q-text');
                    const container = document.getElementById('battle-options');
                    window.quizMathClear?.([questionNode, container]);
                    questionNode.innerHTML = (window.quizMathRichText || parseMarkdownImages)(room.currentQuestion.q);
                    container.innerHTML = '';
                    room.currentQuestion.opts.forEach((opt, idx) => {
                        const btn = document.createElement('button');
                        btn.className = "w-full text-left p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition border border-slate-600 active:scale-95 mb-2 flex items-center";
                        btn.innerHTML = `<span class="bg-slate-800 w-8 h-8 rounded-full inline-flex items-center justify-center text-sm font-bold text-blue-400 border border-slate-600 mr-3 shrink-0">${String.fromCharCode(65+idx)}</span><span class="text-white font-bold quiz-rich-option">${(window.quizMathRichText || parseMarkdownImages)(opt)}</span>`;
                        btn.onclick = () => handleBattleAnswer(roomId, idx, room.currentQuestion.ans, isHost);
                        container.appendChild(btn);
                    });
                    
                    if (window.quizMathTypeset) void window.quizMathTypeset([questionNode, container]);
                    else window.MathJax?.typesetPromise?.([questionNode, container]).catch(e => console.warn('[Battle Math]', e));
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
        h.maxHp = Math.max(1, Number(h.maxHp || 100)); h.hp = Math.max(0, Number(h.hp ?? h.maxHp)); h.atk = Math.max(1, Number(h.atk || 20));
        g.maxHp = Math.max(1, Number(g.maxHp || 100)); g.hp = Math.max(0, Number(g.hp ?? g.maxHp)); g.atk = Math.max(1, Number(g.atk || 20));
        h.artifactShield = Math.max(0, Number(h.artifactShield) || 0);
        g.artifactShield = Math.max(0, Number(g.artifactShield) || 0);
        const battleLog = [];

        for (const attackerRole of turnOrder) {
            const attacker = attackerRole === 'host' ? h : g;
            const defender = attackerRole === 'host' ? g : h;
            if (defender.hp <= 0 || attacker.hp <= 0) continue;

            if (attacker.answerCorrect) {
                const baseDamage = Math.max(1, Number(attacker.atk) || 1);
                const coreAttack = window.resolveGoldenCoreBattleAttack?.({ attacker, defender, baseDamage }) || {};
                const coreExtraDamage = Math.max(0, Number(coreAttack.extraDamage) || 0);
                const artifactAttack = window.resolveArtifactBattleAttack?.({
                    attacker,
                    defender,
                    baseDamage: baseDamage + coreExtraDamage
                }) || {
                    normalDamage: baseDamage + coreExtraDamage,
                    trueDamage: 0,
                    lifestealPercent: 0,
                    shieldGain: 0,
                    skill: ''
                };

                const artifactDefense = window.resolveArtifactBattleDefense?.({
                    defender,
                    attacker,
                    normalDamage: Math.max(0, Number(artifactAttack.normalDamage) || 0),
                    trueDamage: Math.max(0, Number(artifactAttack.trueDamage) || 0)
                }) || {
                    hpDamage: Math.max(0, Number(artifactAttack.normalDamage) || 0) + Math.max(0, Number(artifactAttack.trueDamage) || 0),
                    reflectDamage: 0,
                    skill: ''
                };

                const defenderHpBefore = Math.max(0, Number(defender.hp) || 0);
                const intendedDamage = Math.max(0, Math.round(Number(artifactDefense.hpDamage) || 0));
                const receivedDamage = Math.min(defenderHpBefore, intendedDamage);
                defender.hp = Math.max(0, defenderHpBefore - intendedDamage);
                if (defender.hp === 0) defender.isDead = true;

                const shieldGain = Math.max(0, Math.round(Number(artifactAttack.shieldGain) || 0));
                if (shieldGain > 0) {
                    attacker.artifactShield = Math.max(0, Number(attacker.artifactShield) || 0) + shieldGain;
                }

                let healed = 0;
                const lifestealPercent = Math.max(0, Math.min(0.5, Number(artifactAttack.lifestealPercent) || 0));
                if (receivedDamage > 0 && lifestealPercent > 0 && attacker.hp > 0) {
                    const missingHp = Math.max(0, Number(attacker.maxHp) - Number(attacker.hp));
                    healed = Math.min(missingHp, Math.max(0, Math.round(receivedDamage * lifestealPercent)));
                    attacker.hp = Math.min(Number(attacker.maxHp), Number(attacker.hp) + healed);
                }

                const attackSkill = [
                    coreAttack.skill || '答題攻擊',
                    artifactAttack.skill || '',
                    artifactDefense.skill ? `敵方・${artifactDefense.skill}` : '',
                    shieldGain > 0 ? `聚盾+${shieldGain}` : ''
                ].filter(Boolean).join('・');

                battleLog.push({
                    attacker: attackerRole,
                    isHit: true,
                    dmg: intendedDamage,
                    skill: attackSkill,
                    healed: healed || null
                });

                if (defender.hp > 0 && receivedDamage > 0) {
                    const defenderRole = attackerRole === 'host' ? 'guest' : 'host';

                    const artifactReflectDamage = Math.max(0, Math.round(Number(artifactDefense.reflectDamage) || 0));
                    if (artifactReflectDamage > 0 && attacker.hp > 0) {
                        attacker.hp = Math.max(0, Number(attacker.hp || 0) - artifactReflectDamage);
                        if (attacker.hp === 0) attacker.isDead = true;
                        battleLog.push({
                            attacker: defenderRole,
                            isHit: true,
                            dmg: artifactReflectDamage,
                            skill: '法寶反震',
                            healed: null
                        });
                    }

                    if (attacker.hp > 0) {
                        const counterEffect = window.resolveGoldenCoreBattleCounter?.({
                            defender, attacker, receivedDamage
                        }) || {};
                        const coreReflectDamage = Math.max(0, Number(counterEffect.reflectDamage) || 0);
                        if (coreReflectDamage > 0) {
                            attacker.hp = Math.max(0, Number(attacker.hp || 0) - coreReflectDamage);
                            if (attacker.hp === 0) attacker.isDead = true;
                            battleLog.push({
                                attacker: defenderRole,
                                isHit: true,
                                dmg: coreReflectDamage,
                                skill: counterEffect.skill || '萬劫雷霆丹・雷光反擊',
                                healed: null
                            });
                        }
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
    if (window.quizMathSet) void window.quizMathSet(fbText, currentExp);
    else fbText.innerHTML = formatQuizRichText(currentExp);

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
            if (log.mode === 'dongtian' && typeof window.renderDongtianHistoryLog === 'function') {
                const groupedDongtianLog = window.renderDongtianHistoryLog(log, time);
                if (groupedDongtianLog) { ul.appendChild(groupedDongtianLog); return; }
            }
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
                        <span class="flex-1">${(window.quizMathRichText || parseMarkdownImages)(opt)} ${icon}</span>
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
                <div class="text-white mb-2 text-sm">${(window.quizMathRichText || parseMarkdownImages)(log.question)}</div>
                <div class="flex justify-between items-center text-gray-500 mt-2">
                    <span class="text-[10px] text-cyan-500/70 opacity-80"><i class="fa-solid fa-chevron-down"></i> 點擊展開詳解</span>
                    <span class="text-right">${log.rankAtTime || '單人模式'}</span>
                </div>
                ${detailsHtml}
            `;
            ul.appendChild(li);
        }); // 迴圈結束在這裡

        // 🔥 新增這段：資料載入完畢後，要求 MathJax 重新掃描歷史清單
        if (window.quizMathTypeset) void window.quizMathTypeset(ul);
        else window.MathJax?.typesetPromise?.([ul]).catch(err => console.warn('[History Math]', err));

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
let globalUsersStatsCache = null; // 只有玩家要求全服比較時才讀取
let globalUsersStatsLoad = null;
let globalUsersStatsOwner = '';
let percentileRequestedUid = '';
let percentileRenderSerial = 0;

async function fetchAllUsersForPercentile() {
    const id = auth.currentUser?.uid || '';
    if (!id) return [];
    if (globalUsersStatsOwner !== id) {
        globalUsersStatsOwner = id;
        globalUsersStatsCache = null;
        globalUsersStatsLoad = null;
    }
    if (globalUsersStatsCache) return globalUsersStatsCache;
    if (globalUsersStatsLoad) return globalUsersStatsLoad;
    // 共用同一個進行中的請求，避免快速切換科目時讀取整份 users 多次。
    const pending = (async () => {
        try {
            const snap = await getDocs(collection(db, "users"));
            const users = snap.docs.map(doc => doc.data());
            if (globalUsersStatsOwner === id) globalUsersStatsCache = users;
            return users;
        } catch (e) {
            console.error("[Percentile Error] 無法取得全服資料:", e);
            return [];
        }
    })();
    globalUsersStatsLoad = pending;
    try { return await pending; }
    finally { if (globalUsersStatsLoad === pending) globalUsersStatsLoad = null; }
}

window.updatePercentileDisplay = async (targetSubject, myMap) => {
    const displayDiv = document.getElementById('percentile-display');
    const textEl = document.getElementById('percentile-text');
    if (!displayDiv || !textEl) return;

    displayDiv.classList.remove('hidden');
    const id = auth.currentUser?.uid || '';
    const renderSerial = ++percentileRenderSerial;
    if (!id) { textEl.textContent = '請先登入以查看全服比較。'; return; }
    if (percentileRequestedUid !== id) {
        // 精確全服百分比需要讀取所有玩家，因此改為一次明確的使用者操作。
        textEl.innerHTML = '<button type="button" id="percentile-load-on-demand" class="px-3 py-2 rounded-lg border border-cyan-500/40 text-cyan-200 bg-cyan-950/30">查詢全服比較（會讀取全服資料）</button>';
        textEl.querySelector('#percentile-load-on-demand')?.addEventListener('click', () => {
            if (auth.currentUser?.uid !== id) return;
            percentileRequestedUid = id;
            void window.updatePercentileDisplay(targetSubject, myMap);
        });
        return;
    }
    textEl.textContent = '正在讀取全服比較資料…';

    const allUsers = await fetchAllUsersForPercentile();
    if (renderSerial !== percentileRenderSerial || auth.currentUser?.uid !== id) return;
    if (!allUsers || allUsers.length <= 1) {
        // 失敗時允許明確重試，但不自動再次讀整個集合。
        percentileRequestedUid = '';
        textEl.innerHTML = '<span class="text-gray-400">暫時無法取得全服比較資料。</span> <button type="button" id="percentile-load-on-demand">重新查詢</button>';
        textEl.querySelector('#percentile-load-on-demand')?.addEventListener('click', () => {
            if (auth.currentUser?.uid !== id) return;
            percentileRequestedUid = id;
            void window.updatePercentileDisplay(targetSubject, myMap);
        });
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

// 短時間重開排行榜不必再讀取相同的前十名。
let leaderboardCachedSnapshot = null;
let leaderboardCacheTime = 0;
let leaderboardPending = null;
window.loadLeaderboard = async () => {
    const tbody = document.getElementById('leaderboard-body');
    tbody.innerHTML = `<tr><td colspan="3" class="p-8 text-center text-gray-500"><div class="loader"></div> ${t('loading')}</td></tr>`;
    try {
        let snap = leaderboardCachedSnapshot;
        if (!snap || Date.now() - leaderboardCacheTime >= 120000) {
            if (!leaderboardPending) {
                const q = query(collection(db, "users"), orderBy("stats.rankLevel", "desc"), orderBy("stats.totalScore", "desc"), limit(10));
                leaderboardPending = getDocs(q);
            }
            const pending = leaderboardPending;
            try {
                snap = await pending;
                leaderboardCachedSnapshot = snap;
                leaderboardCacheTime = Date.now();
            } finally {
                if (leaderboardPending === pending) leaderboardPending = null;
            }
        }
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
                        <button type="button" class="xpp-profile-trigger" data-xiuxian-profile="${escapeHtml(doc.id)}" aria-label="查看 ${escapeHtml(d.displayName || '修士')} 的資料">${avatarHtml}</button>
                        <button type="button" class="xpp-profile-trigger ${isMe ? 'text-blue-300 font-bold' : ''}" data-xiuxian-profile="${escapeHtml(doc.id)}">${escapeHtml(d.displayName || '修士')}</button>
                    </td>
                    <td class="px-4 py-4 text-right font-mono text-blue-300">
                        ${getRankMarkup(calculateRankFromScore(d.stats.totalScore, doc.id), doc.id, d.stats.totalScore)} <span class="text-xs text-gray-500 block">${d.stats.totalScore} pts</span>
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

// Preserve the existing product fields and Firestore writes while presenting the form
// outside the collapsible admin section. A closed section cannot clip this editor.
let adminProductEditorOrigin = null;

window.closeAdminForm = () => {
    const editor = document.getElementById('admin-product-editor');
    if (!editor || !editor.classList.contains('admin-product-editor-fullscreen')) return;
    editor.classList.remove('admin-product-editor-fullscreen');
    document.body.classList.remove('admin-product-editing');
    document.getElementById('admin-form-body')?.classList.add('hidden');
    document.getElementById('admin-product-close')?.classList.add('hidden');
    const origin = adminProductEditorOrigin;
    if (origin?.parent?.isConnected) {
        origin.parent.insertBefore(editor, origin.next?.parentNode === origin.parent ? origin.next : null);
    }
    adminProductEditorOrigin = null;
};

window.toggleAdminForm = () => {
    if (document.getElementById('admin-product-editor')?.classList.contains('admin-product-editor-fullscreen')) {
        closeAdminForm();
    } else {
        resetAdminForm();
        openAdminForm();
    }
};

window.openAdminForm = () => {
    if (!currentUserData?.isAdmin) return;
    const editor = document.getElementById('admin-product-editor');
    if (!editor) return;
    if (!editor.classList.contains('admin-product-editor-fullscreen')) {
        adminProductEditorOrigin = { parent:editor.parentNode, next:editor.nextSibling };
        document.body.appendChild(editor);
    }
    editor.classList.add('admin-product-editor-fullscreen');
    document.body.classList.add('admin-product-editing');
    document.getElementById('admin-form-body')?.classList.remove('hidden');
    document.getElementById('admin-product-close')?.classList.remove('hidden');
    void toggleAdminInputPlaceholder();
    updateAdminProductPreview();
    editor.querySelector('#admin-p-name')?.focus({ preventScroll:true });
};

window.updateAdminProductPreview = () => {
    const value = document.getElementById('admin-p-value')?.value?.trim() || '';
    const preview = document.getElementById('admin-asset-preview');
    const empty = document.getElementById('admin-product-preview-empty');
    if (!preview || !empty) return;
    // CSS frame classes are not image URLs. Do not attempt to load them as paths.
    const isImage = /^(?:assets\/|https?:\/\/|\.\.?\/|\/)[^?#]+\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(value);
    preview.classList.toggle('hidden', !isImage);
    empty.classList.toggle('hidden', isImage);
    if (isImage) {
        if (preview.getAttribute('src') !== value) preview.src = value;
    } else {
        preview.removeAttribute('src');
        empty.textContent = value ? '目前使用相框樣式：' + value : '選擇圖片以預覽外觀';
    }
};

window.editProduct = (id, data) => {
    if (!currentUserData?.isAdmin) return;
    document.getElementById('admin-edit-id').value = id;
    document.getElementById('admin-p-name').value = data.name || '';
    document.getElementById('admin-p-type').value = data.type || 'frame';
    document.getElementById('admin-p-value').value = data.value || '';
    document.getElementById('admin-p-price').value = data.price ?? '';

    document.getElementById('admin-form-title').innerText = '編輯商品';
    const saveBtn = document.getElementById('admin-btn-save');
    saveBtn.innerText = '儲存變更';
    document.getElementById('admin-btn-del').classList.remove('hidden');
    openAdminForm();
};

window.resetAdminForm = () => {
    closeAdminForm();
    document.getElementById('admin-edit-id').value = '';
    document.getElementById('admin-p-name').value = '';
    document.getElementById('admin-p-type').value = 'frame';
    document.getElementById('admin-p-value').value = '';
    document.getElementById('admin-p-price').value = '';

    document.getElementById('admin-form-title').innerText = '新增商品';
    document.getElementById('admin-btn-save').innerText = '建立商品';
    document.getElementById('admin-btn-del').classList.add('hidden');
    updateAdminProductPreview();
};

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.getElementById('admin-product-editor')?.classList.contains('admin-product-editor-fullscreen')) {
        event.preventDefault();
        closeAdminForm();
    }
});

window.saveProduct = async () => {
    if (!currentUserData || !currentUserData.isAdmin) return alert("Permission Denied (Admin only)");

    const docId = document.getElementById('admin-edit-id').value; 
    const name = document.getElementById('admin-p-name').value;
    const type = document.getElementById('admin-p-type').value;
    const value = document.getElementById('admin-p-value').value;
    const priceRaw = document.getElementById('admin-p-price').value;
    const price = Number(priceRaw);

    if (!name.trim() || !value.trim() || !priceRaw.trim() || !Number.isSafeInteger(price) || price < 0) {
        return alert("請輸入商品名稱、圖片路徑及有效的非負整數價格");
    }

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
        btn.innerText = document.getElementById('admin-edit-id').value ? '儲存變更' : '建立商品';
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
    updateAdminProductPreview();
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
    if (isAdmin === true && currentUserData?.isAdmin === true) {
        window.setupAdminDebug?.();
    } else {
        xiuxianDebugWriter = null;
        window.isDebugInit = false;
        document.getElementById('admin-debug-console')?.classList.add('hidden');
        document.getElementById('btn-show-debug')?.classList.add('hidden');
        // 角色切換時不保留上一個管理員的 UI 日誌。
        document.getElementById('debug-logs')?.replaceChildren();
        const count = document.getElementById('debug-count');
        if (count) count.textContent = '0';
    }

    const navGrid = document.getElementById('nav-grid');
    if (isAdmin && !document.getElementById('btn-admin-nav')) {
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
    if (!window.trueImmortalBoardReady) { alert("五仙榜尚未讀取完成，請稍後再重算境界。"); return; }
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
            const correctRank = calculateRankFromScore(stats.totalScore || 0, userDoc.id);
            
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

    // 舊功能若直接 alert 技術錯誤，完整訊息改進管理員 Debugger。
    // 一般玩家只能看到不含 API／堆疊內容的通用操作提示。
    if (typeof message === 'string' &&
        /^(?:Error(?::|\\b)|Failed(?:\\b|:)|Load Error|Index Required|Exception|資料載入失敗|結算發生錯誤|Purchase failed|Equip failed)/i.test(message.trim())) {
        message = window.xiuxianSafeActionError?.('Legacy alert', new Error(message), '本次操作未完成，請稍後再試。') || '本次操作未完成，請稍後再試。';
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
