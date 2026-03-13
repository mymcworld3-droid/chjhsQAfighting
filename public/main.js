// 🔥 修正：使用純 URL 引入 Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, 
    query, orderBy, limit, getDocs, serverTimestamp, where, onSnapshot, runTransaction, 
    arrayUnion, arrayRemove, writeBatch 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
// 0. 卡牌資料庫與稀有度設定
// ==========================================

const RARITY_CONFIG = {
    gray:   { name: "普通", color: "text-gray-400", border: "border-gray-500", prob: 0.60 },    // 60% (原 50%)
    blue:   { name: "稀有", color: "text-blue-400", border: "border-blue-500", prob: 0.30 },    // 30% (維持)
    purple: { name: "罕見", color: "text-purple-400", border: "border-purple-500", prob: 0.08 }, // 8%  (原 15%)
    red:    { name: "史詩", color: "text-red-500", border: "border-red-500", prob: 0.015 },     // 1.5% (原 4%)
    gold:   { name: "神話", color: "text-yellow-400", border: "border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.6)]", prob: 0.004 }, // 0.4% (原 0.8%)
    rainbow:{ name: "傳奇", color: "text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-green-500 to-blue-500 animate-pulse", border: "border-white shadow-[0_0_20px_rgba(255,255,255,0.8)]", prob: 0.001 } // 0.1% (原 0.2%)
};

// main.js - 請放在檔案最上方附近

// 這是前端用的題型架構 (需與後端一致)
// 即使還沒答題，雷達圖也能依據此架構顯示正確的軸向
const SUBJECT_SCHEMA_FRONTEND = {
    "國文": ["字形字音字義", "詞語與成語", "修辭與句法", "國學與文化常識", "白話文閱讀", "文言文閱讀", "跨文本比較", "圖表與情境閱讀"],
    "英文": ["詞彙與字彙", "綜合測驗(Cloze)", "文意選填(Matching)", "篇章結構", "閱讀測驗"],
    "數學": ["基礎計算", "應用素養", "幾何圖形", "代數與函數", "證明題", "統計與機率"],
    "公民": ["法律應用", "經濟圖表", "政治體制", "時事解析"],
    "歷史": ["史料解析", "時空定位", "因果推導", "多重敘事"],
    "地理": ["地形判讀", "區域分析", "GIS應用", "環境議題"],
    "物理": ["運動與力學", "定性分析", "生活應用"],
    "化學": ["混合單元", "數據判讀", "實務能源"],
    "生物": ["實驗探究", "情境閱讀", "微觀與宏觀"]
};

// ==========================================
// 0. 卡牌資料庫 (數值平衡調整版)
// ==========================================
// 特性說明：
// [堅韌]: 受到傷害減少 15 點 (全隊生效)
// [英勇]: 己方造成傷害增加 10 點 (全隊生效)
// [共生]: 攻擊成功後，回復己方全體 20 點生命 (全隊生效)

const CARD_DATABASE = {
    // --- 普通 (Gray) ---
    "c001": { name: "史萊姆", hp: 60, atk: 15, rarity: "gray", trait: "黏液", skill: "撞擊", skillDmg: 5 },
    "c002": { name: "哥布林", hp: 70, atk: 20, rarity: "gray", trait: "貪婪", skill: "偷襲", skillDmg: 8 },
    
    // --- 稀有 (Blue) ---
    "c011": { name: "冰霜狼", hp: 90, atk: 30, rarity: "blue", trait: "迅捷", skill: "冰咬", skillDmg: 15 },
    "c012": { name: "鐵甲衛兵", hp: 130, atk: 20, rarity: "blue", trait: "堅韌", skill: "盾防", skillDmg: 5 }, // 提早獲得防禦特性

    // --- 罕見 (Purple) ---
    "c021": { name: "暗影刺客", hp: 110, atk: 60, rarity: "purple", trait: "隱匿", skill: "背刺", skillDmg: 35 },
    "c022": { name: "元素法師", hp: 120, atk: 55, rarity: "purple", trait: "魔力", skill: "火球", skillDmg: 30 },

    // --- 史詩 (Red) [平衡調整] ---
    "c031": { name: "火焰幼龍", hp: 160, atk: 60, rarity: "red", trait: "英勇", skill: "龍息", skillDmg: 50 },
    "c032": { name: "吸血鬼伯爵", hp: 180, atk: 50, rarity: "red", trait: "共生", skill: "血爆", skillDmg: 45 },

    // --- 神話 (Gold) [平衡調整] ---
    "c041": { name: "光之守護者", hp: 220, atk: 65, rarity: "gold", trait: "堅韌", skill: "審判", skillDmg: 30 },

    // --- 傳奇 (Rainbow) [大幅平衡] ---
    // 修正：原本 HP 500 / Skill 999 太過破壞平衡，調整為強大但可被擊敗的數值
    "c051": { name: "虛空魔神", hp: 250, atk: 70, rarity: "rainbow", trait: "英勇", skill: "黑洞", skillDmg: 55 }
};

// ... 在 CARD_DATABASE 定義之後 ...

const TRAIT_DESCRIPTIONS = {
    "堅韌": "全隊減傷15",
    "英勇": "全隊增傷10",
    "共生": "命中全隊回20",
    "黏液": "暫無效果",
    "貪婪": "暫無效果",
    "迅捷": "暫無效果",
    "隱匿": "暫無效果",
    "魔力": "暫無效果",
    "龍息": "暫無效果"
};

const getBattleCardData = (cid) => {
    if (!cid || !CARD_DATABASE[cid]) return null;
    const base = CARD_DATABASE[cid];
    const lvl = (currentUserData.cardLevels && currentUserData.cardLevels[cid]) || 0;
    return {
        ...base,
        id: cid,
        atk: base.atk + (lvl * 5), // 🔥 這裡加入強化數值
        currentHp: base.hp // HP 目前沒設強化，若有需要可改 base.hp + (lvl * 10)
    };
};

// ==========================================
// 🎨 卡片圖片管理系統
// ==========================================
// 請確保 public/card_picture 資料夾下有對應圖片
const getCardImageUrl = (cardId) => {
    // 定義所有卡片的圖片檔名映射
    const imageMap = {
        // --- 普通 (Gray) ---
        "c001": "slime.jpeg",           // 源生軟泥
        "c002": "goblin.jpeg",          // 荒原掠奪者
        
        // --- 稀有 (Blue) ---
        "c011": "frost_wolf.jpeg",      // 霜寒恐狼
        "c012": "iron_guard.jpeg",      // 符文重甲兵

        // --- 罕見 (Purple) ---
        "c021": "shadow_assassin.jpeg", // 幽影之刃
        "c022": "fire_mage.jpeg",       // 爆裂術士

        // --- 史詩 (Red) ---
        "c031": "flame_dragon.jpeg",    // 熾炎翼龍
        "c032": "vampire.jpeg",         // 血色親王

        // --- 神話 (Gold) ---
        "c041": "guardian.jpeg",        // 輝耀熾天使

        // --- 傳奇 (Rainbow) ---
        "c051": "void.jpeg"             // 虛空魔神
    };

    if (imageMap[cardId]) {
        // 加入時間戳記 v=2 (更新版本號) 避免瀏覽器快取舊圖
        return `/card_picture/${imageMap[cardId]}?v=2`;
    }
    return null; // 沒有圖片則回傳 null (顯示 Emoji)
};
// 通用的圖片/Emoji 顯示 HTML 生成器
const getCardVisualHtml = (cardId, rarity, sizeClass = "text-3xl") => {
    const imgUrl = getCardImageUrl(cardId);
    const defaultEmoji = (rarity === 'rainbow' || rarity === 'gold') ? '🐲' : (rarity === 'red' ? '👹' : '⚔️');
    
    if (imgUrl) {
        return `
            <img src="${imgUrl}" class="absolute inset-0 w-full h-full object-cover z-0" 
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
            <div class="${sizeClass} hidden w-full h-full items-center justify-center z-0">
                ${defaultEmoji}
            </div>
        `;
    } else {
        return `
            <div class="${sizeClass} w-full h-full flex items-center justify-center z-0">
                ${defaultEmoji}
            </div>
        `;
    }
};
// ==========================================
// 🌍 國際化 (i18n) 設定
// ==========================================
let currentLang = localStorage.getItem('app_lang') || 'zh-TW';

const translations = {
    'zh-TW': {
        app_title: "AI 每日升階答題戰",
        app_name: "升階答題戰",
        not_logged_in: "未登入",
        welcome_title: "歡迎挑戰",
        welcome_desc: "AI 出題 x 真人對戰 x 段位系統",
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
        tab_cards: "卡牌", // 導航欄用到

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
        btn_draw: "召喚 (500分)",
        msg_no_cards: "你還沒有卡牌，快去召喚！",

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
        app_title: "Rank-Up Quiz Battle",
        app_name: "Quiz Battle",
        not_logged_in: "Guest",
        welcome_title: "Welcome Challenger",
        welcome_desc: "AI Quizzes x PvP Battles x Ranking System",
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
        tab_cards: "Cards",
        btn_draw: "Summon (500pts)",
        msg_no_cards: "No cards yet. Summon now!",

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
// 1. 定義新段位與升級門檻 (使用翻譯 Key)
// ==========================================
const RANKS_KEYS = ["rank_bronze", "rank_silver", "rank_gold", "rank_diamond", "rank_star", "rank_master", "rank_grandmaster", "rank_king"];

function getRankName(level) {
    const idx = Math.min(level || 0, RANKS_KEYS.length - 1);
    return t(RANKS_KEYS[idx]);
}

const RANK_THRESHOLDS = [0, 20, 50, 90, 140, 200, 270, 360];

function getNetScore(stats) {
    if (!stats) return 0;
    const totalCorrect = stats.totalCorrect || 0;
    const totalAnswered = stats.totalAnswered || 0;
    const totalWrong = totalAnswered - totalCorrect;
    return Math.max(0, totalCorrect - totalWrong);
}

function calculateRankFromScore(netScore) {
    let rank = 0;
    for (let i = RANK_THRESHOLDS.length - 1; i >= 0; i--) {
        if (netScore >= RANK_THRESHOLDS[i]) {
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
                if (!currentUserData.cards || currentUserData.cards.length === 0) {
                    currentUserData.cards = ["c001", "c002"];
                    currentUserData.deck = { main: "c001", sub: "c002" };
                    updateDoc(userRef, { 
                        cards: ["c001", "c002"],
                        deck: { main: "c001", sub: "c002" }
                    });
                }
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
                    cards: ["c001", "c002"], 
                    deck: { main: "c001", sub: "c002" },
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

            // 啟動各項監聽服務
            startPresenceSystem();
            startInvitationListener(); 
            listenToSystemCommands();  
            
            updateUserAvatarDisplay();
            updateSettingsInputs();
            checkAdminRole(currentUserData.isAdmin);
            updateUIStats();
            updateDeckDisplay();
            updateHomeBestCard();

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

window.loadMyCards = () => {
    const list = document.getElementById('my-card-list');
    if(!list) return;
    list.innerHTML = "";
    
    if(!currentUserData.cards || currentUserData.cards.length === 0) {
        list.innerHTML = `<div class="col-span-3 md:col-span-4 text-center text-gray-500 py-4">${t('msg_no_cards')}</div>`;
        return;
    }

    const levels = currentUserData.cardLevels || {};
    const uniqueCards = [...new Set(currentUserData.cards)];

    uniqueCards.sort((a, b) => {
        const cardA = CARD_DATABASE[a];
        const cardB = CARD_DATABASE[b];
        const rarityOrder = ["rainbow", "gold", "red", "purple", "blue", "gray"];
        const rDiff = rarityOrder.indexOf(cardA.rarity) - rarityOrder.indexOf(cardB.rarity);
        if (rDiff !== 0) return rDiff;
        return (levels[b] || 0) - (levels[a] || 0);
    });

    uniqueCards.forEach(cardId => {
        const card = CARD_DATABASE[cardId];
        if(!card) return;
        
        const lvl = levels[cardId] || 0;
        const finalAtk = card.atk + (lvl * 5);
        const rConfig = RARITY_CONFIG[card.rarity];
        const traitDesc = TRAIT_DESCRIPTIONS[card.trait] || "";

        const isMain = currentUserData.deck && currentUserData.deck.main === cardId;
        const isSub = currentUserData.deck && currentUserData.deck.sub === cardId;
        let badge = "";
        if(isMain) badge = `<div class="absolute top-0 right-0 bg-yellow-600 text-[8px] px-1 text-white rounded-bl">Main</div>`;
        else if(isSub) badge = `<div class="absolute top-0 right-0 bg-gray-600 text-[8px] px-1 text-white rounded-bl">Sub</div>`;

        let stars = "";
        for(let i=0; i<lvl; i++) stars += "★";

        const div = document.createElement('div');
        div.className = `bg-slate-800 p-1.5 rounded-lg border-2 ${rConfig.border} relative overflow-hidden group hover:scale-[1.02] transition-transform aspect-[2/3] flex flex-col justify-between shadow-md cursor-pointer`;
        div.onclick = () => selectCardForSlot(currentSelectSlot || 'main');

        // [修正] 移除多餘的巢狀 div，確保圖片容器能撐開高度
        div.innerHTML = `
            <div class="flex justify-between items-start z-10">
                <span class="font-bold ${rConfig.color} text-[10px] truncate pr-1 drop-shadow-md">${card.name}</span>
                <span class="text-[9px] text-yellow-500 font-mono tracking-tighter bg-black/30 px-1 rounded">${stars}</span>
            </div>
            
            <div class="flex-1 w-full relative overflow-hidden rounded my-1 bg-black/20">
                 ${getCardVisualHtml(cardId, card.rarity, "text-4xl")}
                 <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none z-0"></div>
            </div>

            <div class="z-10 bg-black/20 p-1.5 rounded backdrop-blur-sm">
                <div class="flex justify-between items-end mb-0.5">
                    <div class="text-[9px] text-gray-400">HP ${card.hp}</div>
                    <div class="text-sm font-bold text-red-400 font-mono leading-none">⚔️${finalAtk}</div>
                </div>
                <div class="pt-0.5 border-t border-white/10 text-[8px] ${rConfig.color} truncate">
                    ⚡ ${card.skill}
                </div>
                <div class="text-[8px] text-gray-300 truncate opacity-80">
                    ✨ ${card.trait}: ${traitDesc}
                </div>
            </div>
            ${badge}
        `;
        list.appendChild(div);
    });
};

// [新增] 開啟選擇卡牌 Modal
window.selectCardForSlot = (slot) => {
    currentSelectSlot = slot;
    document.getElementById('card-selector-modal').classList.remove('hidden');
    renderModalCards();
};

// [修改] 渲染 Modal 中的卡牌列表 (顯示特性)
function renderModalCards() {
    const list = document.getElementById('modal-card-list'); // 確保 HTML ID 正確
    if(!list) return;
    list.innerHTML = "";
    
    const myCards = [...new Set(currentUserData.cards || [])]; 
    const levels = currentUserData.cardLevels || {};

    myCards.sort((a, b) => {
        const cA = CARD_DATABASE[a];
        const cB = CARD_DATABASE[b];
        const rarityOrder = ["rainbow", "gold", "red", "purple", "blue", "gray"];
        return rarityOrder.indexOf(cA.rarity) - rarityOrder.indexOf(cB.rarity);
    });

    myCards.forEach(cardId => {
        const card = CARD_DATABASE[cardId];
        if(!card) return;
        
        const lvl = levels[cardId] || 0;
        const finalAtk = card.atk + (lvl * 5);
        const rConfig = RARITY_CONFIG[card.rarity];
        const traitDesc = TRAIT_DESCRIPTIONS[card.trait] || "";

        const div = document.createElement('div');
        div.className = `cursor-pointer aspect-[2/3] bg-slate-800 p-2 rounded-lg border-2 ${rConfig.border} hover:scale-105 transition-transform flex flex-col justify-between relative overflow-hidden`;
        
        let equipLabel = "";
        if(currentUserData.deck.main === cardId) equipLabel = "<span class='absolute top-0 right-0 bg-yellow-600 text-[9px] px-1 text-white'>Main</span>";
        else if(currentUserData.deck.sub === cardId) equipLabel = "<span class='absolute top-0 right-0 bg-gray-600 text-[9px] px-1 text-white'>Sub</span>";

        div.innerHTML = `
            ${equipLabel}
            <div class="font-bold ${rConfig.color} text-xs truncate">${card.name}</div>
            <div class="flex-1 flex items-center justify-center relative overflow-hidden my-1 rounded">
                 ${getCardVisualHtml(cardId, card.rarity, "text-3xl")}
            </div>
            <div class="bg-black/30 rounded p-1">
                <div class="flex justify-between text-[9px] text-gray-300">
                    <span>HP:${card.hp}</span>
                    <span class="text-red-300 font-bold">ATK:${finalAtk}</span>
                </div>
                <div class="text-[8px] text-gray-400 mt-0.5 truncate border-t border-white/10 pt-0.5">
                    ✨ ${card.trait}: ${traitDesc}
                </div>
            </div>
        `;
        div.onclick = () => setDeckCard(cardId);
        list.appendChild(div);
    });
}

// [新增] 設定牌組 (寫入資料庫)
async function setDeckCard(cardId) {
    if (!currentSelectSlot) return;
    
    if (!currentUserData.deck) currentUserData.deck = { main: "", sub: "" };
    
    // 防呆：主副卡若設為同一張，則互換或清空
    if (currentSelectSlot === 'main' && currentUserData.deck.sub === cardId) currentUserData.deck.sub = "";
    if (currentSelectSlot === 'sub' && currentUserData.deck.main === cardId) currentUserData.deck.main = "";

    currentUserData.deck[currentSelectSlot] = cardId;
    
    try {
        await updateDoc(doc(db, "users", auth.currentUser.uid), { "deck": currentUserData.deck });
        document.getElementById('card-selector-modal').classList.add('hidden');
        updateDeckDisplay();
        loadMyCards(); // 刷新列表標記
    } catch(e) {
        console.error(e);
        alert("設定失敗");
    }
}

// ==========================================
// 核心：抽卡與合成系統
// ==========================================

// 根據權重隨機抽取一張卡
function pickRandomCardId(minRarity = null) {
    const rand = Math.random();
    let cumulative = 0;
    let targetRarity = "gray"; // 預設

    // 定義稀有度順序 (低到高)
    const order = ["gray", "blue", "purple", "red", "gold", "rainbow"];
    const minIndex = minRarity ? order.indexOf(minRarity) : 0;

    // 計算符合保底條件的總機率 (Normalization)
    let validPoolProb = 0;
    if (minRarity) {
        for (let i = minIndex; i < order.length; i++) {
            validPoolProb += RARITY_CONFIG[order[i]].prob;
        }
    }

    // 擲骰子
    for (let i = 0; i < order.length; i++) {
        const r = order[i];
        // 如果有保底要求，跳過低階卡
        if (minRarity && i < minIndex) continue;

        let prob = RARITY_CONFIG[r].prob;
        
        // 如果有保底，需重新分配機率 (讓剩下高等級的機率加總為 1)
        if (minRarity) prob = prob / validPoolProb;

        cumulative += prob;
        if (rand <= cumulative) {
            targetRarity = r;
            break;
        }
    }

    // 從該稀有度中隨機選一張
    const pool = Object.keys(CARD_DATABASE).filter(id => CARD_DATABASE[id].rarity === targetRarity);
    if (pool.length === 0) return "c001"; // Fallback
    return pool[Math.floor(Math.random() * pool.length)];
}

// 處理卡牌獲取 (合成/返還邏輯)
async function processCardAcquisition(userRef, cardId, currentScore) {
    // 確保 cardLevels 存在
    if (!currentUserData.cardLevels) currentUserData.cardLevels = {};
    const currentLevel = currentUserData.cardLevels[cardId] || 0;
    const cardName = CARD_DATABASE[cardId].name;
    const rarity = CARD_DATABASE[cardId].rarity;
    let msg = "";
    let refund = 0;

    // 情況 A: 尚未擁有 -> 獲得新卡
    if (!currentUserData.cards.includes(cardId)) {
        await updateDoc(userRef, { 
            "cards": arrayUnion(cardId),
            [`cardLevels.${cardId}`]: 0 // 初始等級 0
        });
        currentUserData.cards.push(cardId);
        currentUserData.cardLevels[cardId] = 0;
        msg = `✨ 獲得新卡：${cardName}`;
    } 
    // 情況 B: 已擁有且等級 < 5 -> 自動合成 (+5 ATK)
    else if (currentLevel < 5) {
        await updateDoc(userRef, { 
            [`cardLevels.${cardId}`]: currentLevel + 1 
        });
        currentUserData.cardLevels[cardId] = currentLevel + 1;
        msg = `⬆️ ${cardName} 強化至 +${currentLevel + 1} (ATK+5)`;
    } 
    // 情況 C: 已滿等 -> 返還積分
    else {
        // [修正] 依照稀有度設定不同返還值
        const refundMap = {
            "gray": 20,     // 普通
            "blue": 50,     // 稀有
            "purple": 80,   // 罕見 (補間值)
            "red": 100,     // 史詩
            "rainbow": 200, // 傳奇
            "gold": 500     // 神話
        };
        
        refund = refundMap[rarity] || 20;
        
        // 分數不扣反增 (因為外層已經扣了，這裡補回)
        msg = `💰 ${cardName} 已滿等，返還 ${refund} 積分`;
    }

    return { msg, refund, rarity, name: cardName, id: cardId };
}

// [新增] 更新主畫面上的牌組顯示區塊
function updateDeckDisplay() {
    const mainId = currentUserData.deck?.main;
    const subId = currentUserData.deck?.sub;
    
    const mainEl = document.getElementById('deck-main-display');
    const subEl = document.getElementById('deck-sub-display');
    
    if (mainId && CARD_DATABASE[mainId]) {
        const c = CARD_DATABASE[mainId];
        mainEl.innerHTML = `<div class="text-yellow-400 font-bold">${c.name}</div><div class="text-xs text-white">HP:${c.hp}</div><div class="text-[10px] text-red-300">${c.skill}</div>`;
    } else {
        mainEl.innerHTML = "點擊選擇";
    }

    if (subId && CARD_DATABASE[subId]) {
        const c = CARD_DATABASE[subId];
        subEl.innerHTML = `<div class="text-gray-300 font-bold">${c.name}</div><div class="text-xs text-white">HP:${c.hp}</div>`;
    } else {
        subEl.innerHTML = "點擊選擇";
    }
}
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
        loadUserHistory(); 
        renderKnowledgeGraph(); // 🔥 新增這一行：切換到設定頁時渲染雷達圖
    }
    // ----------------
    
    if (pageId === 'page-admin') loadAdminData();
    if (pageId === 'page-social') {
        switchSocialTab('friends');
    }
    if (pageId === 'page-cards') {
        loadMyCards();
        updateDeckDisplay();
    }
    
    updateTexts();
};

function updateUIStats() {
    if(!currentUserData) return;
    const stats = currentUserData.stats;
    const currentNetScore = getNetScore(stats);
    const realRankLevel = calculateRankFromScore(currentNetScore);
    
    if (stats.rankLevel !== realRankLevel) { stats.rankLevel = realRankLevel; }
    
    if(typeof stats.currentStreak === 'undefined') stats.currentStreak = 0;
    if(typeof stats.bestStreak === 'undefined') stats.bestStreak = 0;
    if(typeof stats.totalCorrect === 'undefined') stats.totalCorrect = 0;
    if(typeof stats.totalAnswered === 'undefined') stats.totalAnswered = 0;

    const rankColors = [
        "text-orange-600", "text-gray-300", "text-yellow-400", "text-blue-600",
        "text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-500 to-red-500",
        "text-purple-400 drop-shadow-[0_0_10px_rgba(168,85,247,0.8)]",
        "text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.8)] animate-pulse",
        "text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-yellow-500 to-yellow-200 drop-shadow-[0_0_20px_rgba(234,179,8,0.8)]"
    ];

    const rankIndex = Math.min(stats.rankLevel, RANKS_KEYS.length - 1);
    const rankEl = document.getElementById('display-rank');
    rankEl.innerText = t(RANKS_KEYS[rankIndex]); 
    rankEl.className = `text-5xl font-black mb-2 ${rankColors[rankIndex] || "text-white"}`;

    let progressPercent = 100;
    let currentStarsDisplay = 10;
    let maxStarsDisplay = 10;

    if (rankIndex < RANK_THRESHOLDS.length - 1) {
        const currentBase = RANK_THRESHOLDS[rankIndex];
        const nextBase = RANK_THRESHOLDS[rankIndex + 1];
        const required = nextBase - currentBase;
        const earned = currentNetScore - currentBase;
        progressPercent = Math.max(0, Math.min((earned / required) * 100, 100));
        currentStarsDisplay = Math.max(0, earned);
        maxStarsDisplay = required;
    } else {
        currentStarsDisplay = currentNetScore - RANK_THRESHOLDS[RANK_THRESHOLDS.length - 1];
        maxStarsDisplay = "∞";
        progressPercent = 100;
    }

    const starValEl = document.getElementById('display-stars');
    if (starValEl) {
        // 更新數值
        starValEl.innerText = currentStarsDisplay;
        
        // 更新分母 (如果結構允許，或者直接操作父層但避免遞迴)
        // 這裡我們用一個安全的方式：找到包含 "/ 10" 的那個兄弟元素或父元素文字
        const parentSpan = starValEl.parentElement;
        if (parentSpan) {
            
            parentSpan.innerHTML = `<span id="display-stars" class="text-yellow-400 font-bold text-sm">${currentStarsDisplay}</span> <span class="text-xs opacity-50">/ ${maxStarsDisplay}</span>`;
            
        }
    }
    document.getElementById('display-score').innerText = stats.totalScore;

    const cardPts = document.getElementById('cards-user-points');
    if(cardPts) cardPts.innerText = stats.totalScore;
    document.getElementById('display-streak').innerText = stats.currentStreak;
    document.getElementById('display-best-streak').innerText = stats.bestStreak;
    
    const accuracy = stats.totalAnswered > 0 ? ((stats.totalCorrect / stats.totalAnswered) * 100).toFixed(1) : "0.0";
    document.getElementById('display-accuracy').innerText = accuracy + "%";
    
    setTimeout(() => { document.getElementById('progress-bar').style.width = `${progressPercent}%`; }, 100);
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
                hint.innerText = "Mode: AI";
                hint.className = "text-xs text-green-400 mt-1";
            } else {
                hint.innerText = `Selected: ${settings.source.replace('.json', '')}`;
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
            } catch (e) { console.error("Error loading banks", e); container.innerHTML = '<div class="text-red-400 text-xs">Load Failed</div>'; }
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
    const level = document.getElementById('set-level').value;
    const rawStrong = document.getElementById('set-strong').value;
    const rawWeak = document.getElementById('set-weak').value;
    const source = document.getElementById('set-source-final-value').value; 
    const difficulty = document.getElementById('set-difficulty').value;
    if (!source) { alert("Please select source"); return; }
    const btn = document.querySelector('button[onclick="saveProfile()"]');
    btn.innerText = "Saving..."; btn.disabled = true;
    const cleanStrong = await getCleanSubjects(rawStrong);
    const cleanWeak = await getCleanSubjects(rawWeak);
    document.getElementById('set-strong').value = cleanStrong;
    document.getElementById('set-weak').value = cleanWeak;
    await updateDoc(doc(db, "users", auth.currentUser.uid), { "profile.educationLevel": level, "profile.strongSubjects": cleanStrong, "profile.weakSubjects": cleanWeak, "gameSettings": { source, difficulty } });
    currentUserData.profile.educationLevel = level; currentUserData.profile.strongSubjects = cleanStrong; currentUserData.profile.weakSubjects = cleanWeak; currentUserData.gameSettings = { source, difficulty };
    currentBankData = null; localStorage.removeItem('currentQuiz'); quizBuffer = []; fillBuffer();
    btn.innerText = "Saved!"; setTimeout(() => { btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Update`; btn.disabled = false; }, 2000);
};

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

async function switchToAI() {
    await updateDoc(doc(db, "users", auth.currentUser.uid), { "gameSettings.source": 'ai' });
    currentUserData.gameSettings.source = 'ai';
    return fetchOneQuestion(); 
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
    // 如果不是透過 startSoloMode 進來的，且目前沒有 active session，預設為無限模式 (或跳出選擇)
    if (!soloSession.active && !isNewSession) {
        // 如果直接呼叫 startQuizFlow 而沒有 Session，強制呼叫選擇器
        window.openSoloModeSelector();
        return;
    }

    switchToPage('page-quiz');
    
    // UI 重置
    document.getElementById('quiz-container').classList.add('hidden');
    document.getElementById('feedback-section').classList.add('hidden');
    document.getElementById('btn-giveup').classList.remove('hidden');

    // 根據模式顯示 UI
    const progressPanel = document.getElementById('solo-progress-panel');
    if (soloSession.mode === 'challenge') {
        if(progressPanel) {
            progressPanel.classList.remove('hidden');
            document.getElementById('solo-current-step').innerText = soloSession.currentStep;
            document.getElementById('solo-correct-count').innerText = soloSession.correctCount;
            document.getElementById('solo-wrong-count').innerText = soloSession.wrongCount;
            
            // 更新總題數顯示 (因為錯題會增加總數)
            const maxEl = document.getElementById('solo-max-steps');
            if(maxEl) maxEl.innerText = soloSession.maxSteps;
        }
    } else {
        // 無限模式隱藏挑戰進度面板，改顯示簡單的連勝資訊 (原 UI 已有)
        if(progressPanel) progressPanel.classList.add('hidden');
    }

    window.quizStartTime = Date.now(); 

    // --- 出題邏輯 (保持不變) ---
    const savedQuiz = localStorage.getItem('currentQuiz');
    if (savedQuiz) { 
        const q = JSON.parse(savedQuiz); 
        renderQuiz(q.data, q.rank, q.badge); 
        fillBuffer(); 
        return; 
    }
    
    if (quizBuffer.length > 0) { 
        const nextQ = quizBuffer.shift(); 
        localStorage.setItem('currentQuiz', JSON.stringify(nextQ)); 
        renderQuiz(nextQ.data, nextQ.rank, nextQ.badge); 
        fillBuffer(); 
    } else {
        document.getElementById('quiz-loading').classList.remove('hidden');
        document.getElementById('loading-text').innerText = t('loading_text');
        try { 
            const q = await fetchOneQuestion(); 
            localStorage.setItem('currentQuiz', JSON.stringify(q)); 
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

//🔥 全域變數新增
let soloSelectedUnitPath = ""; 

//🔥 修改：單人模式選擇器，加入單元選單與遞迴邏輯
window.openSoloModeSelector = async () => {
    const modalId = 'solo-mode-selector';
    let modal = document.getElementById(modalId);
    
    if (!modal) {
        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm hidden";
        modal.innerHTML = `
            <div class="bg-slate-800 p-6 rounded-2xl border-2 border-slate-600 shadow-2xl max-w-2xl w-full mx-4 relative overflow-hidden">
                <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 to-purple-500"></div>
                <h3 class="text-xl font-bold text-white mb-6 text-center">⚔️ 準備挑戰</h3>
                
                <div class="flex flex-col md:flex-row gap-6">
                    <div class="flex-1 space-y-3">
                        <div class="text-xs text-gray-400 font-bold mb-2 uppercase tracking-widest">1. 選擇模式</div>
                        <button onclick="startSoloMode('infinite')" class="w-full p-4 rounded-xl bg-gradient-to-r from-blue-600/20 to-cyan-600/20 hover:from-blue-600/40 hover:to-cyan-600/40 border border-cyan-400/30 group transition-all text-left">
                            <div class="font-bold text-white"><i class="fa-solid fa-infinity"></i> 無限模式</div>
                            <div class="text-[10px] text-cyan-200 mt-1">每題 +20 積分，無盡練功</div>
                        </button>

                        <button onclick="startSoloMode('challenge')" class="w-full p-4 rounded-xl bg-gradient-to-r from-purple-600/20 to-pink-600/20 hover:from-purple-500/40 hover:to-pink-500/40 border border-pink-400/30 group transition-all text-left">
                            <div class="font-bold text-white"><i class="fa-solid fa-trophy"></i> 挑戰模式</div>
                            <div class="text-[10px] text-pink-200 mt-1">10題挑戰，錯題追加！獎勵 200 分</div>
                        </button>
                    </div>

                    <div class="flex-1 border-l border-white/10 pl-0 md:pl-6">
                        <div class="text-xs text-yellow-500 font-bold mb-2 uppercase tracking-widest">2. 指定出題單元</div>
                        <div id="solo-unit-selectors-container" class="space-y-2">
                            <div class="text-center py-4 text-gray-500 text-xs">載入單元資料中...</div>
                        </div>
                        <p id="solo-unit-hint" class="text-[10px] text-gray-500 mt-2 font-mono italic">請選擇學科與進度</p>
                    </div>
                </div>

                <div class="mt-6 pt-4 border-t border-white/5 flex justify-end">
                    <button onclick="document.getElementById('${modalId}').classList.add('hidden')" class="px-6 py-2 text-gray-400 hover:text-white text-sm transition">取消</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    modal.classList.remove('hidden');

    try {
        const res = await fetch('/api/units');
        const data = await res.json();
        if (data.files && Array.isArray(data.files)) {
            const tree = buildPathTree(data.files);
            renderSoloUnitSelectors(tree, "");
        }
    } catch (e) {
        console.error("Failed to load units", e);
        document.getElementById('solo-unit-selectors-container').innerHTML = '<div class="text-red-400 text-xs">無法讀取單元資料</div>';
    }
};

// 🔥 main.js 修正：支援讀取 JSON 內容的遞迴選單
let soloSelectedUnitDetail = ""; // 儲存具體的單元名稱 (如：自我與生命價值)

//🔥 修正：遞迴選單，支援讀取 JSON 內的單元並記錄其知識點 (sub_topics)
window.renderSoloUnitSelectors = async (tree, currentPath) => {
    const container = document.getElementById('solo-unit-selectors-container');
    const hint = document.getElementById('solo-unit-hint');
    if (!container) return;
    
    container.innerHTML = ''; 
    let selectedParts = currentPath ? currentPath.split('/') : [];

    const createSelect = async (level, currentNode) => {
        const select = document.createElement('select');
        select.className = "w-full bg-slate-900/50 border border-slate-600 text-white rounded-lg p-2 text-xs outline-none focus:border-cyan-500 mb-2";
        
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
            soloSelectedUnitPath = newParts.join('/');
            window.soloSelectedUnitDetail = ""; // 切換檔案時重置單元
            window.soloSelectedUnitSubTopics = []; // 重置知識點
            renderSoloUnitSelectors(tree, soloSelectedUnitPath);
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

    // 渲染 JSON 檔案內部的具體單元
    async function renderInnerUnitSelect(filePath) {
        try {
            const res = await fetch(`/middle_school_unit_name/${filePath}`);
            if (!res.ok) throw new Error("File not found");
            const units = await res.json();

            const select = document.createElement('select');
            select.className = "w-full bg-slate-900/50 border border-cyan-500/50 text-cyan-200 rounded-lg p-2 text-xs outline-none mb-2 animate-pulse";
            const defaultOpt = document.createElement('option');
            defaultOpt.value = "";
            defaultOpt.innerText = "-- 選擇具體單元 --";
            defaultOpt.selected = !window.soloSelectedUnitDetail;
            select.appendChild(defaultOpt);

            units.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.name;
                opt.innerText = u.name;
                if (window.soloSelectedUnitDetail === u.name) {
                    opt.selected = true;
                    window.soloSelectedUnitSubTopics = u.sub_topics || []; // 恢復知識點
                }
                select.appendChild(opt);
            });

            select.onchange = (e) => {
                window.soloSelectedUnitDetail = e.target.value;
                const selectedUnit = units.find(u => u.name === window.soloSelectedUnitDetail);
                window.soloSelectedUnitSubTopics = selectedUnit ? (selectedUnit.sub_topics || []) : []; // 🔥 記錄該單元的知識點
                
                hint.innerText = `✅ 已選取：${window.soloSelectedUnitDetail}`;
                hint.className = "text-[10px] text-green-400 mt-2 font-mono";
            };
            container.appendChild(select);
        } catch (e) {
            console.error("[JSON-Error] 讀取單元內容失敗:", e);
        }
    }
    await createSelect(0, tree);
};

//🔥 修改：startSoloMode，確保有選擇單元路徑
window.startSoloMode = (mode) => {
    if (!soloSelectedUnitPath) {
        alert("請先在右側選擇要挑戰的單元！");
        return;
    }

    const modal = document.getElementById('solo-mode-selector');
    if(modal) modal.classList.add('hidden');

    soloSession = {
        active: true,
        mode: mode,
        currentStep: 1,
        maxSteps: mode === 'challenge' ? 10 : 9999,
        correctCount: 0,
        wrongCount: 0,
        history: [],
        unitPath: soloSelectedUnitPath // 🔥 存入選定的單元路徑
    };

    const progressPanel = document.getElementById('solo-progress-panel');
    if (progressPanel) {
        if (mode === 'challenge') {
            progressPanel.classList.remove('hidden');
            document.getElementById('solo-current-step').innerText = 1;
            const maxEl = document.getElementById('solo-max-steps'); 
            if(maxEl) maxEl.innerText = 10; 
        } else {
            progressPanel.classList.add('hidden'); 
        }
    }

    window.startQuizFlow(true);
};

//🔥 完整的 fetchOneQuestion 函式
async function fetchOneQuestion() {
    const settings = currentUserData.gameSettings || { source: 'ai', difficulty: 'medium' };
    const rankName = getRankName(currentUserData.stats.rankLevel || 0);

    // ==========================================
    // 🧠 模式 A: 單人挑戰模式 (選定單元 + 弱點難度邏輯)
    // ==========================================
    if (soloSession.active && soloSession.unitPath) {
        // 1. 決定科目與具體單元
        const parts = soloSession.unitPath.split('/');
        const subject = parts[0]; 
        const targetTopic = window.soloSelectedUnitDetail || soloSession.unitPath;

        // 2. 弱點邏輯：如果是弱點科目考 easy (基礎)，否則考 hard (難)
        const weakSubjects = (currentUserData.profile.weakSubjects || "").split(',').map(s => s.trim());
        const isWeak = weakSubjects.includes(subject);
        let finalDifficulty = isWeak ? "easy" : "hard";

        // 在 Debugger 輸出狀態，方便除錯
        console.log(`[Solo-Gen] 模式: ${soloSession.mode}, 科目: ${subject}, 單元: ${targetTopic}, 難度: ${finalDifficulty}`);

        try {
            const BACKEND_URL = "/api/generate-quiz";
            const response = await fetch(BACKEND_URL, {
                method: "POST", 
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    subject: subject, 
                    specificTopic: targetTopic, 
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

            let allOptions = [rawData.correct, ...rawData.wrong];
            allOptions = shuffleArray(allOptions);
            const correctIndex = allOptions.indexOf(rawData.correct);

            // 存儲目前題目資訊供回報問題使用
            localStorage.setItem('currentQuizData', JSON.stringify({
                subject: rawData.subject || subject,
                sub_topic: rawData.sub_topic || targetTopic
            }));

            return {
                data: { q: rawData.q, opts: allOptions, ans: correctIndex, exp: rawData.exp },
                rank: rankName,
                // Badge 根據難度邏輯動態顯示
                badge: `🎯 ${subject} | ${finalDifficulty === 'easy' ? '基礎強化' : '進階挑戰'}`
            };
        } catch (e) {
            console.error("[Fetch-Solo-Error] 單人模式生成失敗:", e);
            throw e;
        }
    }

    // ==========================================
    // 模式 B: 一般模式 (AI 或 題庫)
    // ==========================================
    let finalDifficulty = settings.difficulty;
    if (!finalDifficulty || finalDifficulty === 'auto') {
        finalDifficulty = getSmartDifficulty();
    }

    if (settings.source === 'ai') {
        const BACKEND_URL = "/api/generate-quiz";
        const allSubjects = ["國文", "英文", "數學", "公民", "歷史", "地理", "物理", "化學", "生物"];
        let targetSubject = allSubjects[Math.floor(Math.random() * allSubjects.length)];
        
        try {
            const response = await fetch(BACKEND_URL, {
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
            const correctIndex = allOptions.indexOf(rawData.correct);

            localStorage.setItem('currentQuizData', JSON.stringify({
                subject: rawData.subject || targetSubject,
                sub_topic: rawData.sub_topic || "綜合"
            }));

            return {
                data: { q: rawData.q, opts: allOptions, ans: correctIndex, exp: rawData.exp },
                rank: rankName,
                badge: `🎯 ${rawData.subject} | ${rawData.sub_topic || '綜合'}`
            };
        } catch (e) {
            console.error("[Fetch-AI-Error] AI 一般模式生成失敗:", e);
            throw e;
        }
    } else {
        // 題庫模式
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
                if (filesToFetch.length === 0) return switchToAI();
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
                return switchToAI(); 
            }
        }

        const filteredQuestions = currentBankData.questions.filter(q => q.difficulty === finalDifficulty);
        const pool = filteredQuestions.length > 0 ? filteredQuestions : currentBankData.questions;
        const rawData = pool[Math.floor(Math.random() * pool.length)];
        let allOptions = shuffleArray([rawData.correct, ...rawData.wrong]);
        const correctIndex = allOptions.indexOf(rawData.correct);
        let displaySubject = rawData.subject || settings.source.split('/').pop().replace('.json', '');
        
        return { 
            data: { q: rawData.q, opts: allOptions, ans: correctIndex, exp: rawData.exp }, 
            rank: rankName, 
            badge: `🎯 ${displaySubject} | ${finalDifficulty.toUpperCase()}` 
        };
    }
}

/// 🔥 修改：在進入下一題前才清除舊題目，確保 startQuizFlow 能抓到新題目
window.nextQuestion = () => { 
    localStorage.removeItem('currentQuiz'); 
    startQuizFlow(); 
};

async function handleAnswer(userIdx, correctIdx, questionText, explanation) {
    if (!currentUserData) return;

    const timeTaken = (Date.now() - (window.quizStartTime || Date.now())) / 1000;
    const isCorrect = userIdx === correctIdx;
    
    // UI: 禁用按鈕與顯示正誤
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
    
    // 🔥 修改：註解掉此行！保留題目資料，讓「回報問題」功能讀取得到
    // localStorage.removeItem('currentQuiz'); 
    
    fbText.innerHTML = parseMarkdownImages(explanation) || "AI did not provide explanation.";

    // ==========================================
    // 🧠 模式邏輯分流
    // ==========================================
    const isInfinite = soloSession.mode === 'infinite';
    const isChallenge = soloSession.mode === 'challenge';

    if (soloSession.active) {
        if (isCorrect) soloSession.correctCount++;
        else soloSession.wrongCount++;
        
        soloSession.history.push({ q: questionText, isCorrect: isCorrect, exp: explanation });

        // 🟥 挑戰模式特殊邏輯：答錯追加題目
        if (isChallenge && !isCorrect) {
            soloSession.maxSteps++; // 總題數 +1
            fbTitle.innerHTML += `<div class="text-xs text-yellow-300 mt-1 animate-pulse">⚠️ 答錯懲罰：追加一題同類題目！</div>`;
            // 更新 UI 上的總題數
            const maxEl = document.getElementById('solo-max-steps');
            if(maxEl) maxEl.innerText = soloSession.maxSteps;
        }

        // 更新計數面板
        const elCorrect = document.getElementById('solo-correct-count');
        const elWrong = document.getElementById('solo-wrong-count');
        if (elCorrect) elCorrect.innerText = soloSession.correctCount;
        if (elWrong) elWrong.innerText = soloSession.wrongCount;

        // 🟩 設定按鈕行為
        const nextBtn = document.getElementById('btn-next-step');
        if (nextBtn) {
            // 挑戰模式且達到最大題數 -> 結算
            if (isChallenge && soloSession.currentStep >= soloSession.maxSteps) {
                nextBtn.innerHTML = '<i class="fa-solid fa-flag-checkered"></i> 完成挑戰 (領取獎勵)';
                nextBtn.className = "btn-cyber-accent flex-1 py-3 rounded-lg text-xs font-bold animate-pulse bg-yellow-600 text-white shadow-lg";
                nextBtn.onclick = window.finishSoloSession; 
            } else {
                // 無限模式 或 挑戰模式未結束 -> 下一題
                soloSession.currentStep++; // 預備下一題序號
                nextBtn.innerText = isInfinite ? `下一題 (目前連對: ${currentUserData.stats.currentStreak + (isCorrect?1:0)})` : t('btn_next_q');
                nextBtn.className = "btn-cyber-primary flex-1 py-3 rounded-lg text-xs bg-cyan-600 text-white";
                nextBtn.onclick = window.nextQuestion; 
            }
        }
    }

    // ==========================================
    // 💰 全域統計與獎勵更新
    // ==========================================
    let stats = currentUserData.stats;
    let scoreGain = 0;

    // 1. 無限模式：即時更新全域狀態與金幣
    if (isInfinite) {
        stats.totalAnswered++;
        if (isCorrect) {
            stats.totalCorrect++; 
            stats.currentStreak++;
            if (stats.currentStreak > stats.bestStreak) stats.bestStreak = stats.currentStreak;
            
            // 💰 無限模式獎勵：每題固定 20 (可加上連勝加成)
            scoreGain = 20;
            // 顯示獲得金幣提示
            fbTitle.innerHTML += ` <span class="text-yellow-400 text-sm ml-2 border border-yellow-500 rounded px-1">+${scoreGain}💰</span>`;
        } else {
            stats.currentStreak = 0; // 答錯斷連勝
        }
        stats.totalScore += scoreGain;
    }
    // 2. 挑戰模式：僅記錄答題數，不即時給分 (保留到 finishSoloSession)
    else if (isChallenge) {
        stats.totalAnswered++;
        if (isCorrect) stats.totalCorrect++;
        // 不更新 currentStreak 以免挑戰模式影響首頁連勝紀錄
    }

    // 更新段位
    const netScore = getNetScore(stats);
    const newRank = calculateRankFromScore(netScore);
    if (newRank > stats.rankLevel) stats.rankLevel = newRank;

    // 寫入資料庫
    try {
        const p1 = updateDoc(doc(db, "users", auth.currentUser.uid), { stats: stats });
        const p2 = addDoc(collection(db, "exam_logs"), { 
            uid: auth.currentUser.uid, 
            email: auth.currentUser.email, 
            question: questionText, 
            isCorrect: isCorrect, 
            timeTaken: timeTaken,
            topic: "Solo", 
            mode: soloSession.mode, // 記錄模式
            timestamp: serverTimestamp() 
        });
        await Promise.all([p1, p2]);
    } catch (e) { console.error("Firebase Error", e); }
    
    updateUIStats(); 
    fillBuffer();
}

window.finishSoloSession = async () => {
    // 1. 切換到結算頁面
    window.switchToPage('page-solo-result');

    // 2. 顯示數據
    const max = soloSession.maxSteps;
    const correct = soloSession.correctCount;
    const acc = Math.round((correct / max) * 100);
    
    const accEl = document.getElementById('solo-result-acc');
    if (accEl) {
        accEl.innerText = `${acc}%`;
        accEl.className = `text-3xl font-bold font-sci ${acc >= 80 ? 'text-green-400' : (acc >= 60 ? 'text-yellow-400' : 'text-red-400')}`;
    }

    // 渲染歷史紀錄
    const list = document.getElementById('solo-history-list');
    if (list) {
        list.innerHTML = '';
        (soloSession.history || []).forEach((log, idx) => {
            const div = document.createElement('div');
            div.className = `p-3 rounded-xl border border-white/5 bg-slate-900/60 flex flex-col gap-1 ${log.isCorrect ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-red-500'}`;
            div.innerHTML = `
                <div class="flex justify-between items-start">
                    <span class="text-[10px] text-gray-500 font-mono">Q${idx + 1}</span>
                    ${log.isCorrect 
                        ? '<span class="text-green-400 text-[10px] font-bold">CORRECT</span>' 
                        : '<span class="text-red-400 text-[10px] font-bold">WRONG</span>'}
                </div>
                <div class="text-xs text-white font-bold mb-1">${parseMarkdownImages(log.q)}</div>
                <div class="text-[10px] text-gray-400 line-clamp-2 mt-1 bg-black/20 p-1 rounded">
                    ${log.exp || 'No explanation'}
                </div>
            `;
            list.appendChild(div);
        });
    }

    // 3. 💰 發放挑戰獎勵 (僅限挑戰模式)
    if (soloSession.mode === 'challenge') {
        const bonus = 200;
        if (currentUserData && currentUserData.stats) {
            currentUserData.stats.totalScore += bonus;
            
            // 顯示獎勵動畫或文字
            const titleEl = document.querySelector('#page-solo-result h2');
            if(titleEl) titleEl.innerHTML = `挑戰完成！ <span class="text-yellow-400">+${bonus}💰</span>`;

            try {
                await updateDoc(doc(db, "users", auth.currentUser.uid), {
                    "stats.totalScore": currentUserData.stats.totalScore
                });
                updateUIStats();
                if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
            } catch (e) { console.error("Bonus Error:", e); }
        }
    }

    // 4. 重置 Session
    soloSession.active = false;
    soloSession.history = [];
    const progressPanel = document.getElementById('solo-progress-panel');
    if (progressPanel) progressPanel.classList.add('hidden');
};

// --- 新增：關閉結算頁面 (回到大廳) ---
window.closeSoloResult = () => {
    document.getElementById('page-solo-result').classList.add('hidden');
    switchToPage('page-home');
};

// [修改] public/main.js

// [修改] 圖片生成功能已移除 (節省費用)
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
    
    // 🔥 [已移除] AI 動態配圖邏輯 (原本的 B. 區塊已刪除)
    // 因為後端不再回傳 image_prompt，且 generate-image API 已關閉。

    // C. 渲染選項 (保持不變)
    const container = document.getElementById('options-container');
    container.innerHTML = ''; 
    data.opts.forEach((optText, idx) => {
        const btn = document.createElement('button');
        btn.id = `option-btn-${idx}`;
        btn.className = "w-full text-left p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition border border-slate-600 flex items-center gap-3 active:scale-95 mb-2";
        btn.innerHTML = `<span class="bg-slate-800 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-blue-400 border border-slate-600 shrink-0">${String.fromCharCode(65+idx)}</span><span class="flex-1">${optText}</span>`;
        btn.onclick = () => handleAnswer(idx, data.ans, data.q, data.exp);
        container.appendChild(btn);
    });
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

    // 取得當前題目資訊
    const currentQData = JSON.parse(localStorage.getItem('currentQuiz') || '{}');
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

            // 發放獎勵
            if (currentUserData && currentUserData.stats) {
                currentUserData.stats.totalScore += 20;
                await updateDoc(doc(db, "users", auth.currentUser.uid), { "stats.totalScore": currentUserData.stats.totalScore });
                updateUIStats();
            }

            // 設定按鈕行為：跳下一題
            btn.onclick = () => {
                closeReportModal();
                
                // 🔥 關鍵修正：必須先清除當前題目緩存，否則 startQuizFlow 會重新載入同一題
                localStorage.removeItem('currentQuiz'); 
                
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

window.startBattleMatchmaking = async () => {
    if (!auth.currentUser) { alert("請先登入！"); return; }
    if (!currentUserData.deck?.main) { alert("請先到卡牌中心設定「主卡」！"); switchToPage('page-cards'); return; }

    console.log("🚀 開始配對中..."); 
    isBattleActive = true;
    switchToPage('page-battle');
    document.getElementById('battle-lobby').classList.remove('hidden');
    document.getElementById('battle-arena').classList.add('hidden');
    document.getElementById('battle-status-text').innerText = t('battle_searching');
    document.getElementById('battle-result').classList.add('hidden');

    // 🔥 修正 1: 縮短搜尋時間至 3 分鐘 (避免配對到 30 分鐘前早已關閉視窗的殭屍房間)
    const searchTimeRange = new Date(Date.now() - 3 * 60 * 1000);
    
    const myBattleData = { 
        uid: auth.currentUser.uid, 
        name: currentUserData.displayName || "Player", 
        equipped: currentUserData.equipped || { frame: '', avatar: '' },
        done: false,
        activeCard: "main",
        isDead: false,
        cards: {
            main: getBattleCardData(currentUserData.deck.main),
            sub: getBattleCardData(currentUserData.deck.sub)
        }
    };

    let joinedRoomId = null;

    try {
        // 搜尋等待中的房間
        const q = query(
            collection(db, "rooms"), 
            where("status", "==", "waiting"), 
            where("createdAt", ">", searchTimeRange), 
            limit(20)
        );
        
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
            // 過濾掉自己開的房間
            let availableDocs = snapshot.docs.filter(d => { 
                const data = d.data(); 
                return data.host && data.host.uid !== auth.currentUser.uid; 
            });

            // 🔥 修正 2: 洗牌 (Shuffle) 房間列表，避免大家都搶同一個
            for (let i = availableDocs.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [availableDocs[i], availableDocs[j]] = [availableDocs[j], availableDocs[i]];
            }

            // 🔥 修正 3: 嘗試「每一個」可用房間，而不是試一個失敗就放棄
            for (const targetDoc of availableDocs) {
                console.log(`嘗試加入房間: ${targetDoc.id}`);
                const roomRef = doc(db, "rooms", targetDoc.id);
                
                try {
                    await runTransaction(db, async (transaction) => {
                        const sfDoc = await transaction.get(roomRef);
                        if (!sfDoc.exists()) throw "房間已不存在";
                        const data = sfDoc.data();
                        
                        // 再次確認狀態
                        if (data.status === "waiting" && !data.guest) {
                            transaction.update(roomRef, { guest: myBattleData, status: "ready" });
                        } else { 
                            throw "房間已滿"; 
                        }
                    });

                    // 如果交易成功沒報錯，代表加入成功
                    joinedRoomId = targetDoc.id;
                    break; // 成功加入，跳出迴圈

                } catch (e) { 
                    console.log(`加入房間 ${targetDoc.id} 失敗:`, e); 
                    // 繼續嘗試下一個房間
                }
            }
        }

        if (joinedRoomId) {
            // --- 加入成功 ---
            console.log("✅ 成功加入房間:", joinedRoomId);
            currentBattleId = joinedRoomId;
            isBattleResultProcessed = false;
            document.getElementById('battle-status-text').innerText = t('battle_connecting');
            listenToBattleRoom(currentBattleId);
        } else {
            // --- 無房間可加，自己建立 ---
            console.log("⚠️ 無可用房間 (或嘗試失敗)，建立新房間等待挑戰者...");
            document.getElementById('battle-status-text').innerText = "正在等待挑戰者加入...";
            
            const roomRef = await addDoc(collection(db, "rooms"), { 
                host: myBattleData, 
                guest: null, 
                status: "waiting", 
                round: 1, 
                createdAt: serverTimestamp() 
            });
            currentBattleId = roomRef.id;
            isBattleResultProcessed = false;
            
            // 隨機邀請線上玩家 (選擇性)
            inviteRandomPlayers(currentBattleId);
            
            listenToBattleRoom(currentBattleId);
        }
    } catch (e) {
        console.error("配對過程發生錯誤:", e);
        if (e.message && e.message.includes("index")) {
            alert("系統錯誤：Firebase 需要建立複合索引 (status + createdAt)。請查看 Console 連結。");
        } else {
            alert("配對失敗: " + e.message); 
        }
        leaveBattle();
    }
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
    if (!currentUserData.deck?.main) { alert("請先設定主卡！"); return; }

    // 3. 準備戰鬥資料
    const myBattleData = { 
        uid: auth.currentUser.uid, 
        name: currentUserData.displayName, 
        equipped: currentUserData.equipped,
        done: false,
        activeCard: "main",
        isDead: false,
        cards: {
            main: getBattleCardData(currentUserData.deck.main),
            sub: getBattleCardData(currentUserData.deck.sub)
        }
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

// [修正版] 監聽對戰房間
function listenToBattleRoom(roomId) {
    if (battleUnsub) battleUnsub();
    
    lastProcessedLogId = null;
    isPlayingSequence = false;
    let lastQuestionText = ""; 

    console.log("📡 開始監聽對戰房間:", roomId);

    battleUnsub = onSnapshot(doc(db, "rooms", roomId), async (docSnap) => {
        if (!docSnap.exists()) { leaveBattle(); return; }

        const room = docSnap.data();
        if (!auth.currentUser) return;

        const isHost = room.host.uid === auth.currentUser.uid;
        const myData = isHost ? room.host : room.guest;
        const oppData = isHost ? room.guest : room.host;

        // ==========================================
        // 1. 優先處理戰鬥動畫 (無論狀態為何，只要有新 Log 都播放)
        // ==========================================
        if (room.battleLog && room.battleLogId !== lastProcessedLogId && !isPlayingSequence) {
            console.log("🎬 播放戰鬥動畫...");
            isPlayingSequence = true;
            lastProcessedLogId = room.battleLogId;
            
            // 隱藏題目與遮罩，確保動畫清楚可見
            const overlay = document.getElementById('battle-quiz-overlay');
            if(overlay) {
                overlay.classList.add('hidden'); 
                overlay.style.display = 'none'; // 強制隱藏 inline style
            }
            
            // 播放動畫
            await playBattleSequence(room.battleLog, isHost);
            isPlayingSequence = false;

            // 動畫結束後的狀態分流
            if (room.status === "finished") {
                // 如果已經結束，直接呼叫結算
                showBattleResultUI(room, isHost);
            } 
            // 如果還沒結束且是房主，清空 Log 並出下一題
            else if (isHost) {
                await updateDoc(doc(db, "rooms", roomId), { 
                    currentQuestion: null, 
                    battleLog: null 
                });
                generateSharedQuiz(roomId);
            }
            return; // 動畫處理完畢，本次更新結束 (等待下一次 Snapshot)
        }

        // ==========================================
        // 2. 如果正在播放動畫，暫停 UI 更新
        // ==========================================
        if (isPlayingSequence) return;

        // ==========================================
        // 3. 一般狀態: 遊戲進行中
        // ==========================================
        if (room.status === "ready") {
            document.getElementById('battle-lobby').classList.add('hidden');
            document.getElementById('battle-arena').classList.remove('hidden');
            document.getElementById('battle-result').classList.add('hidden');
            document.getElementById('battle-round').innerText = room.round;

            // 更新血條 (僅在非動畫時)
            updateBattleCardUI('my', myData);
            updateBattleCardUI('enemy', oppData);

            // 處理題目顯示 logic
            const overlay = document.getElementById('battle-quiz-overlay');
            
            if (room.currentQuestion) {
                 // A. 有題目 -> 顯示題目 UI
                 window.currentBattleExp = room.currentQuestion.exp;
                 
                 if (room.currentQuestion.q !== lastQuestionText) {
                    lastQuestionText = room.currentQuestion.q;
                    overlay.classList.remove('hidden');
                    overlay.style.display = "flex";

                    // 重置為答題狀態
                    document.getElementById('battle-loading').classList.add('hidden');
                    document.getElementById('battle-quiz-box').classList.remove('hidden');
                    document.getElementById('battle-feedback').classList.add('hidden');
                    document.getElementById('battle-waiting-msg').classList.add('hidden');
                    
                    // 啟用按鈕
                    const btns = document.querySelectorAll('#battle-options button');
                    btns.forEach(b => {
                        b.disabled = false;
                        b.classList.remove('opacity-50', 'cursor-not-allowed', 'bg-green-600', 'bg-red-600', 'border-green-400', 'border-red-400');
                    });

                    // 渲染文字
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
                 }
            } else {
                // B. 無題目 -> 顯示等待畫面 (等待房主出題)
                overlay.classList.remove('hidden');
                overlay.style.display = "flex";
                document.getElementById('battle-quiz-box').classList.add('hidden');
                document.getElementById('battle-loading').classList.remove('hidden'); 
                document.getElementById('battle-loading-text').innerText = "正在生成下一回合題目..."; 

                // 如果是第一回合，房主觸發生成
                if (isHost && room.round === 1 && !isGenerating) {
                    generateSharedQuiz(roomId);
                }
            }

            // 4. 觸發結算 (Host Only)
            if (room.host?.done && room.guest?.done && isHost) {
                if (!window.isWaitingForResolve) {
                    window.isWaitingForResolve = true;
                    // 延遲 1 秒讓雙方都能看到最後一人的答題結果 (O/X)
                    setTimeout(() => {
                        resolveRoundLogic(roomId, room);
                        window.isWaitingForResolve = false;
                    }, 1000); 
                }
            }
        }
        
        // ==========================================
        // 4. 狀態: 遊戲結束 (非動畫觸發的進入點)
        // ==========================================
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

async function playBattleSequence(logs, isHost) {
    if (!logs || logs.length === 0) return;

    for (const log of logs) {
        // 判斷這一條 log 是誰發動攻擊
        const isMeAttacking = (isHost && log.attacker === 'host') || (!isHost && log.attacker === 'guest');
        const role = isMeAttacking ? 'my' : 'enemy';
        const targetRole = isMeAttacking ? 'enemy' : 'my';
        
        // 可選：顯示回合提示 (如「我方攻擊！」)
        // ...

        await new Promise(r => setTimeout(r, 500)); // 蓄力時間

        if (log.isHit) {
            // 命中：播放攻擊特效與扣血
            triggerBattleAnimation(role, log.dmg, log.skill, log.healed);
            
            // 手動更新一次血條 UI (僅視覺)，配合動畫效果
            const bar = document.getElementById(`${targetRole}-hp-bar`);
            const txt = document.getElementById(`${targetRole}-hp-text`);
            if(bar && txt) {
                const currentText = txt.innerText.split('/');
                let cur = parseInt(currentText[0]);
                const max = parseInt(currentText[1]);
                cur = Math.max(0, cur - log.dmg);
                bar.style.width = `${(cur/max)*100}%`;
                txt.innerText = `${cur}/${max}`;
            }
        } else {
            // [新增] 未命中 (MISS)：顯示攻擊失敗
            triggerMissAnimation(targetRole);
        }
        
        // 每個動作之間等待 1.5 秒
        await new Promise(r => setTimeout(r, 1500));
    }
}// ==========================================
// 🎨 戰鬥視覺特效系統 (VFX System)
// ==========================================

// [改寫] 觸發戰鬥動畫 (支援衝刺、特效、傷害飄字)
async function triggerBattleAnimation(attackerSide, damage, skillName, isHeal = false) {
    // attackerSide: 'my' (我方攻擊) 或 'enemy' (敵方攻擊)
    const attackerPrefix = attackerSide === 'my' ? 'my' : 'enemy';
    const targetPrefix = attackerSide === 'my' ? 'enemy' : 'my';
    
    const attackerContainer = document.getElementById(`${attackerPrefix}-card-container`);
    const targetContainer = document.getElementById(`${targetPrefix}-card-container`);
    const targetVisual = document.getElementById(`${targetPrefix}-card-visual`);

    if (!attackerContainer || !targetContainer) return;

    // 1. 技能詠唱特效 (如果是技能攻擊)
    if (skillName && skillName !== "普通攻擊") {
        attackerContainer.classList.add('anim-cast');
        createFloatingText(attackerContainer, `⚡ ${skillName}!`, "text-yellow-300", -80);
        await new Promise(r => setTimeout(r, 400)); // 等待詠唱
        attackerContainer.classList.remove('anim-cast');
    }

    // 2. 執行物理衝刺 (Lunge)
    const lungeClass = attackerSide === 'my' ? 'anim-lunge-up' : 'anim-lunge-down';
    attackerContainer.classList.add(lungeClass);

    // 3. 在衝刺動作的 "打擊點" (約 300ms) 生成受擊特效
    setTimeout(() => {
        // A. 播放音效 (瀏覽器震動)
        if (navigator.vibrate) navigator.vibrate([50, 50, 100]);

        // B. 畫面/卡片震動
        const arena = document.getElementById('battle-arena');
        arena.classList.add('anim-screen-shake');
        targetContainer.classList.add('anim-shake'); // 使用 style.css 中原本定義的 shake
        
        setTimeout(() => {
            arena.classList.remove('anim-screen-shake');
            targetContainer.classList.remove('anim-shake');
        }, 500);

        // C. 產生刀光/爆炸特效
        createSlashEffect(targetVisual);

        // D. 顯示傷害數字
        if (damage > 0) {
            // 判斷是否為 "爆擊" (這裡簡單假設傷害 > 40 算大傷害)
            const isCrit = damage >= 40; 
            createDamageNumber(targetVisual, damage, isCrit);
        }

        // E. 顯示回血 (如果有)
        // 這裡需要邏輯支援：如果是吸血技能，顯示在攻擊者身上
        if (isHeal) {
             // 假設回血是回在自己身上
             const attackerVisual = document.getElementById(`${attackerPrefix}-card-visual`);
             createDamageNumber(attackerVisual, `+${isHeal}`, false, true);
        }

    }, 300); // 配合 CSS lunge 動畫的時間點

    // 4. 清除衝刺 class
    setTimeout(() => {
        attackerContainer.classList.remove(lungeClass);
    }, 600);
}

// [新增] 產生刀光特效 DOM
function createSlashEffect(parentEl) {
    if (!parentEl) return;
    const vfx = document.createElement('div');
    vfx.className = 'vfx-container';
    vfx.innerHTML = `<div class="vfx-slash"></div><div class="vfx-slash" style="animation-delay: 0.1s; transform: rotate(45deg);"></div>`; // 十字斬
    parentEl.appendChild(vfx);
    setTimeout(() => vfx.remove(), 500);
}

// [新增] 產生傷害飄字 DOM
function createDamageNumber(parentEl, value, isCrit, isHeal = false) {
    if (!parentEl) return;
    const el = document.createElement('div');
    el.innerText = isHeal ? value : `-${value}`;
    
    let classes = "dmg-number";
    if (isCrit) classes += " dmg-crit";
    if (isHeal) classes += " heal-number";
    
    el.className = classes;
    
    // 隨機一點點偏移，避免數字重疊
    const randX = (Math.random() - 0.5) * 40;
    el.style.left = `calc(50% + ${randX}px)`;

    parentEl.appendChild(el);
    setTimeout(() => el.remove(), 1200);
}

// [新增] 通用浮動文字 (用於技能名稱或 Miss)
function createFloatingText(parentEl, text, colorClass = "text-white", topOffset = 0) {
    if (!parentEl) return;
    const el = document.createElement('div');
    el.className = `absolute left-1/2 -translate-x-1/2 font-bold text-xl z-50 animate-bounce ${colorClass}`;
    el.style.top = topOffset !== 0 ? `${topOffset}px` : '50%';
    el.style.textShadow = "0 2px 4px rgba(0,0,0,0.8)";
    el.innerText = text;
    parentEl.appendChild(el);
    setTimeout(() => el.remove(), 1500);
}

// [改寫] 攻擊失敗動畫
function triggerMissAnimation(targetRole) {
    const targetPrefix = targetRole === 'my' ? 'my' : 'enemy';
    const targetVisual = document.getElementById(`${targetPrefix}-card-visual`);
    if (targetVisual) {
        createFloatingText(targetVisual, "MISS", "text-gray-400 text-3xl");
    }
}

// [修正版] 回合結算邏輯
async function resolveRoundLogic(roomId, room) {
    const host = room.host;
    const guest = room.guest;
    
    // 取得時間戳記 (防止 null 報錯)
    const tHost = host.answerTime ? host.answerTime.toMillis() : Date.now() + 999999;
    const tGuest = guest.answerTime ? guest.answerTime.toMillis() : Date.now() + 999999;

    // 決定攻擊順序：答對且時間短者先攻；若都錯則無所謂
    let turnOrder = [];
    if (host.answerCorrect && !guest.answerCorrect) turnOrder = ['host', 'guest'];
    else if (!host.answerCorrect && guest.answerCorrect) turnOrder = ['guest', 'host'];
    else if (tHost < tGuest) turnOrder = ['host', 'guest'];
    else turnOrder = ['guest', 'host'];

    const roomRef = doc(db, "rooms", roomId);

    await runTransaction(db, async (transaction) => {
        const freshDoc = await transaction.get(roomRef);
        if (!freshDoc.exists()) return;
        
        // 重新讀取最新數據，避免覆蓋並行寫入
        const freshRoom = freshDoc.data();
        let h = freshRoom.host;
        let g = freshRoom.guest;
        let battleLog = []; 

        const TRAIT_VALS = {
            buffDmg: 10,    // [英勇]
            reduceDmg: 15,  // [堅韌]
            healAmt: 20     // [共生]
        };

        // 模擬執行攻擊
        for (const attackerRole of turnOrder) {
            // 動態判斷攻防角色 (因為上一輪攻擊可能導致死亡狀態改變)
            const attacker = attackerRole === 'host' ? h : g;
            const defender = attackerRole === 'host' ? g : h;
            
            if (defender.isDead) continue; // 對手已死，鞭屍無效

            // ⚠️ 修正：重新獲取當前活著的 activeCard，因為可能剛剛被打死切換了
            let cardKey = attacker.activeCard; 
            // 如果當前主卡死了但副卡活著，強制切換（防呆）
            if (attacker.cards[cardKey].currentHp <= 0 && attacker.cards.sub?.currentHp > 0) {
                 cardKey = 'sub';
                 attacker.activeCard = 'sub';
            }
            
            const card = attacker.cards[cardKey];
            if (card.currentHp <= 0) continue; // 攻擊者自己也死了，無法攻擊

            // 只有答對才攻擊
            if (attacker.answerCorrect) {
                // 1. 計算攻擊方加成 (遍歷全隊)
                let extraDmg = 0;
                let healTrigger = false;

                ['main', 'sub'].forEach(slot => {
                    const c = attacker.cards[slot];
                    if (c && c.currentHp > 0) {
                        if (c.trait === '英勇') extraDmg += TRAIT_VALS.buffDmg;
                        if (c.trait === '共生') healTrigger = true;
                    }
                });

                // 2. 計算防守方減免
                let dmgReduction = 0;
                ['main', 'sub'].forEach(slot => {
                    const c = defender.cards[slot];
                    if (c && c.currentHp > 0) {
                        if (c.trait === '堅韌') dmgReduction += TRAIT_VALS.reduceDmg;
                    }
                });

                // 3. 基礎傷害
                let damage = card.atk; 
                let skill = "普通攻擊";
                if (cardKey === 'main') {
                    damage += (card.skillDmg || 0);
                    skill = card.skill || "技能攻擊";
                }

                // 4. 最終傷害 (保底 1 點)
                let finalDamage = Math.max(1, (damage + extraDmg) - dmgReduction);

                // 5. 扣血邏輯
                const targetKey = defender.activeCard;
                const targetCard = defender.cards[targetKey];
                let newHp = targetCard.currentHp - finalDamage;

                if (newHp <= 0) {
                    newHp = 0;
                    // 死亡切換
                    if (targetKey === 'main' && defender.cards.sub && defender.cards.sub.currentHp > 0) {
                        defender.activeCard = 'sub'; // 切換副卡
                    } else {
                        defender.isDead = true; // 全滅
                    }
                }
                defender.cards[targetKey].currentHp = newHp;

                // 6. 回血邏輯 (⚠️ 修正：加入 MaxHP 上限檢查)
                let healed = 0;
                if (healTrigger) {
                    ['main', 'sub'].forEach(slot => {
                        const c = attacker.cards[slot];
                        if (c && c.currentHp > 0) {
                            // 查找原始資料庫的 HP 上限
                            const dbCard = CARD_DATABASE[c.id];
                            const maxHp = dbCard ? dbCard.hp : 999; // 防呆
                            
                            if (c.currentHp < maxHp) {
                                const flow = Math.min(maxHp - c.currentHp, TRAIT_VALS.healAmt);
                                c.currentHp += flow;
                                healed += flow; // 記錄總回血量
                            }
                        }
                    });
                }

                // 7. 寫入日誌
                let logMsg = skill;
                if (extraDmg > 0) logMsg += `(+${extraDmg})`;
                if (dmgReduction > 0) logMsg += `(盾-${dmgReduction})`;
                
                battleLog.push({
                    attacker: attackerRole,
                    isHit: true,
                    dmg: finalDamage,
                    skill: logMsg,
                    healed: healed > 0 ? healed : null
                });

            } else {
                // 答錯 MISS
                battleLog.push({
                    attacker: attackerRole,
                    isHit: false,
                    dmg: 0,
                    skill: "MISS",
                    healed: null
                });
            }
        }

        // 判斷勝負
        let status = "ready";
        let winnerUid = null;
        
        if (h.isDead || g.isDead || freshRoom.round >= 10) {
             status = "finished";
             if (h.isDead && !g.isDead) { winnerUid = g.uid; }
             else if (!h.isDead && g.isDead) { winnerUid = h.uid; }
             else {
                 // 判斷總血量
                 const hTotal = h.cards.main.currentHp + (h.cards.sub?.currentHp || 0);
                 const gTotal = g.cards.main.currentHp + (g.cards.sub?.currentHp || 0);
                 if (hTotal > gTotal) winnerUid = h.uid;
                 else if (gTotal > hTotal) winnerUid = g.uid;
                 else winnerUid = null; // 平手
             }
        }

        // 寫入 DB
        transaction.update(roomRef, {
            host: h,
            guest: g,
            round: (status === "finished") ? freshRoom.round : freshRoom.round + 1,
            battleLog: battleLog,
            battleLogId: Date.now().toString(), // 觸發前端動畫
            status: status,
            winner: winnerUid,
            "host.done": false,
            "guest.done": false,
            "host.answerCorrect": null,
            "guest.answerCorrect": null,
            "host.answerTime": null,
            "guest.answerTime": null
        });
    });
}
// 輔助函式：處理勝利結算 (避免主函式太長)
async function processBattleWin(loserData, msgEl) {
    try {
        const lootIds = [];
        if (loserData.cards.main) lootIds.push(loserData.cards.main.id);
        if (loserData.cards.sub) lootIds.push(loserData.cards.sub.id);

        const userRef = doc(db, "users", auth.currentUser.uid);
        
        // 加分並獲得卡牌
        currentUserData.stats.totalScore += 500;
        currentUserData.stats.totalCorrect += 5; 
        
        const currentNetScore = getNetScore(currentUserData.stats);
        const newRank = calculateRankFromScore(currentNetScore);
        
        await updateDoc(userRef, { 
            "stats.totalScore": currentUserData.stats.totalScore,
            "stats.totalCorrect": currentUserData.stats.totalCorrect,
            "stats.rankLevel": newRank,
            "cards": arrayUnion(...lootIds)
        });

        // 更新本地
        currentUserData.cards.push(...lootIds);
        currentUserData.stats.rankLevel = newRank;

        msgEl.innerHTML = `獲得獎勵：<br>🏆 200 積分<br>🎴 戰利品卡牌 ${lootIds.length} 張<br>💫加十階排位！`;
        updateUIStats();
    } catch (e) { 
        console.error("Loot failed", e); 
        msgEl.innerText = "結算發生錯誤，請聯繫管理員";
    }
}
    // [新增] 計算並顯示首頁最強卡牌
window.updateHomeBestCard = () => {
    const container = document.getElementById('home-best-card-display');
    if (!container || !currentUserData || !currentUserData.cards || currentUserData.cards.length === 0) {
        if(container) container.innerHTML = '<div class="text-gray-500 text-xs">No cards</div>';
        return;
    }

    const levels = currentUserData.cardLevels || {};
    const cards = currentUserData.cards;

    // 尋找最強卡牌 (排序邏輯：稀有度 > 攻擊力)
    let bestCardId = cards[0];
    let bestScore = -1;

    const rarityScore = { "rainbow": 5000, "gold": 4000, "red": 3000, "purple": 2000, "blue": 1000, "gray": 0 };

    cards.forEach(id => {
        const c = CARD_DATABASE[id];
        if(!c) return;
        const lvl = levels[id] || 0;
        const finalAtk = c.atk + (lvl * 5);
        
        // 評分 = 稀有度分數 + 攻擊力
        const score = (rarityScore[c.rarity] || 0) + finalAtk;
        
        if (score > bestScore) {
            bestScore = score;
            bestCardId = id;
        }
    });

    // 渲染卡牌 (使用大的樣式)
    const card = CARD_DATABASE[bestCardId];
    const lvl = levels[bestCardId] || 0;
    const finalAtk = card.atk + (lvl * 5);
    const rConfig = RARITY_CONFIG[card.rarity];

    // 使用 w-40 (寬度160px) 來顯示，並保持 2/3 比例
    container.innerHTML = `
        <div class="w-40 aspect-[2/3] bg-slate-800 rounded-xl border-4 ${rConfig.border} relative overflow-hidden flex flex-col justify-between p-3 shadow-2xl bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]">
            <div class="absolute inset-0 bg-gradient-to-b from-transparent to-black/60 pointer-events-none"></div>
            
            <div class="flex justify-between items-start z-10">
                <span class="font-bold ${rConfig.color} text-lg drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">${card.name}</span>
                <span class="text-xs text-yellow-500 font-mono border border-yellow-500/50 px-1.5 rounded bg-black/40">Lv.${lvl}</span>
            </div>
            
            <div class="absolute inset-0 z-0">
                ${getCardImageUrl(bestCardId) ? 
                  `<img src="${getCardImageUrl(bestCardId)}" class="w-full h-full object-cover opacity-80">` : 
                  `<div class="w-full h-full flex items-center justify-center text-6xl opacity-30">${card.rarity === 'rainbow' ? '🐲' : '⚔️'}</div>`
                }
            </div>
            <div class="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/90 z-0"></div>

            <div class="flex justify-between items-start z-10 relative">
               </div>

            <div class="flex-1 z-10"></div> <div class="z-10 bg-slate-900/80 backdrop-blur rounded p-2 border border-white/10 relative">
               </div>

            <div class="z-10 bg-slate-900/80 backdrop-blur rounded p-2 border border-white/10">
                <div class="flex justify-between items-center">
                    <span class="text-xs text-gray-400">ATK</span>
                    <span class="text-xl font-black text-red-500 font-mono">${finalAtk}</span>
                </div>
                <div class="text-[10px] ${rConfig.color} mt-1 truncate">
                    Trait: ${card.trait}
                </div>
            </div>
        </div>
    `;
};
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

window.loadUserHistory = async () => {
    const ul = document.getElementById('history-list');
    if(!ul) return; 
    ul.innerHTML = `<li class="text-center py-10"><div class="loader"></div></li>`;
    try {
        const q = query(collection(db, "exam_logs"), where("uid", "==", auth.currentUser.uid), orderBy("timestamp", "desc"), limit(20));
        const snap = await getDocs(q);
        ul.innerHTML = '';
        if (snap.empty) { ul.innerHTML = `<li class="text-center text-gray-500 py-4">No History</li>`; return; }
        snap.forEach(doc => {
            const log = doc.data();
            const time = log.timestamp ? new Date(log.timestamp.toDate()).toLocaleString() : '--';
            const li = document.createElement('li');
            li.className = `p-3 rounded-lg text-xs border-l-4 mb-2 bg-slate-700/50 ${log.isCorrect ? 'border-green-500' : 'border-red-500'}`;
            li.innerHTML = `<div class="flex justify-between mb-1"><span class="text-gray-400 font-mono">${time}</span><span class="${log.isCorrect ? 'text-green-400' : 'text-red-400'} font-bold">${log.isCorrect ? 'Correct' : 'Wrong'}</span></div><div class="text-white mb-2 text-sm">${log.question}</div><div class="text-gray-500 text-right">${log.rankAtTime}</div>`;
            ul.appendChild(li);
        });
    } catch (e) { console.error(e); ul.innerHTML = '<li class="text-center text-red-400 py-4">Error</li>'; }
};
// main.js - 替換 renderKnowledgeGraph 函式

// main.js - 替換 renderKnowledgeGraph

let knowledgeChartInstance = null;

// main.js - 替換 renderKnowledgeGraph

// ... (calculateDomainScore 輔助函式保持不變，若遺失請補上) ...
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
    if (totalQuestions === 0) return 20; 
    return Math.round((totalCorrect / totalQuestions) * 100);
}

// 主渲染函式
window.renderKnowledgeGraph = (targetSubject = null) => {
    const ctx = document.getElementById('knowledgeChart');
    if (!ctx) return;

    // 1. 自動產生按鈕 (保持原本邏輯)
    let controls = document.getElementById('chart-controls');
    if (!controls) {
        controls = document.createElement('div');
        controls.id = 'chart-controls';
        controls.className = "flex flex-wrap gap-2 justify-center mt-4 px-2";
        
        const subjects = [
            { id: null, label: "全域總覽", color: "bg-blue-600" },
            { id: "國文", label: "國文", color: "bg-slate-600" },
            { id: "英文", label: "英文", color: "bg-slate-600" },
            { id: "數學", label: "數學", color: "bg-slate-600" },
            { id: "歷史", label: "歷史", color: "bg-amber-700" }, 
            { id: "地理", label: "地理", color: "bg-amber-700" },
            { id: "公民", label: "公民", color: "bg-amber-700" },
            { id: "物理", label: "物理", color: "bg-emerald-700" }, 
            { id: "化學", label: "化學", color: "bg-emerald-700" },
            { id: "生物", label: "生物", color: "bg-emerald-700" },
        ];

        subjects.forEach(subj => {
            const btn = document.createElement('button');
            btn.innerText = subj.label;
            btn.className = `px-3 py-1 text-[10px] font-bold text-white rounded-full transition-all shadow-md border border-white/10 ${subj.color} opacity-60 hover:opacity-100 hover:scale-105`;
            btn.onclick = () => window.renderKnowledgeGraph(subj.id);
            btn.dataset.subj = subj.id || 'all'; 
            controls.appendChild(btn);
        });
        
        // 🔥 修正：將按鈕列移出圖表容器 (wrapper)，避免因容器 max-height 限制導致按鈕被切掉或重疊
        // 原本: ctx.parentNode.insertBefore(controls, ctx.nextSibling);
        // 新邏輯: 插入到圖表容器 (ctx.parentNode) 的「後面」
        ctx.parentNode.parentNode.insertBefore(controls, ctx.parentNode.nextSibling);
    }

    // 更新按鈕樣式
    controls.querySelectorAll('button').forEach(btn => {
        const isActive = (btn.dataset.subj === (targetSubject || 'all'));
        if (isActive) {
            btn.classList.remove('opacity-60');
            btn.classList.add('opacity-100', 'ring-2', 'ring-white', 'scale-110');
        } else {
            btn.classList.add('opacity-60');
            btn.classList.remove('opacity-100', 'ring-2', 'ring-white', 'scale-110');
        }
    });

    // 2. 準備數據
    const map = currentUserData.stats.knowledgeMap || {};
    let labels = [];
    let dataValues = [];
    let chartTitle = "";
    let chartColor = "rgba(34, 211, 238, 1)"; // 預設青色

    if (targetSubject) {
        // --- 單科細項模式 ---
        chartTitle = `${targetSubject} 能力分析`;
        
        // 設定顏色
        if(["歷史","地理","公民"].includes(targetSubject)) chartColor = "rgba(245, 158, 11, 1)"; 
        if(["物理","化學","生物"].includes(targetSubject)) chartColor = "rgba(16, 185, 129, 1)"; 

        // 強制使用 SCHEMA 定義的標籤，確保軸向固定
        if (SUBJECT_SCHEMA_FRONTEND[targetSubject]) {
            labels = SUBJECT_SCHEMA_FRONTEND[targetSubject];
        } else {
            labels = map[targetSubject] ? Object.keys(map[targetSubject]) : [];
        }

        // 填入數據 (若無數據則補 0)
        dataValues = labels.map(topic => {
            const s = map[targetSubject]?.[topic];
            return (s && s.total > 0) ? Math.round((s.correct / s.total) * 100) : 0;
        });

        if (labels.length === 0) {
            labels = ["尚無數據", "請多練習", "累積數據"]; 
            dataValues = [0, 0, 0];
        }

    } else {
        // --- 全域總覽模式 ---
        chartTitle = "五大領域綜合分析";
        labels = ["國文", "英文", "數學", "社會", "自然"];
        dataValues = [
            calculateDomainScore(map, ["國文"]),
            calculateDomainScore(map, ["英文"]),
            calculateDomainScore(map, ["數學"]),
            calculateDomainScore(map, ["歷史", "地理", "公民"]),
            calculateDomainScore(map, ["物理", "化學", "生物"])
        ];
    }

    // 3. 繪圖
    if (knowledgeChartInstance) knowledgeChartInstance.destroy();

    knowledgeChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: [{
                label: '掌握度 (%)',
                data: dataValues,
                backgroundColor: chartColor.replace('1)', '0.2)'),
                borderColor: chartColor,
                pointBackgroundColor: '#fff',
                pointBorderColor: '#fff',
                borderWidth: 2,
                pointRadius: 3
            }]
        },
        options: {
            maintainAspectRatio: false,
            plugins: {
                title: { display: true, text: chartTitle, color: '#fff', font: { size: 16 } },
                legend: { display: false }
            },
            scales: {
                r: {
                    angleLines: { color: 'rgba(255, 255, 255, 0.1)' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    pointLabels: { 
                        color: '#e5e7eb', 
                        font: { size: 12, family: "'Noto Sans TC', sans-serif" } 
                    },
                    suggestedMin: 0,
                    suggestedMax: 100,
                    ticks: { display: false, backdropColor: 'transparent' } 
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
window.loadAdminData = async () => {
    loadAdminLogs(); 
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
    document.getElementById('store-user-points').innerText = currentUserData.stats.totalScore;
    
    try {
        const q = query(collection(db, "products"), orderBy("price", "asc"));
        const snap = await getDocs(q);
        grid.innerHTML = '';
        
        if (snap.empty) { grid.innerHTML = '<div class="col-span-2 text-center text-gray-500">Store is empty...</div>'; return; }

        snap.forEach(doc => {
            const item = doc.data();
            const pid = doc.id;
            const isOwned = currentUserData.inventory && currentUserData.inventory.includes(pid);
            const isEquipped = (currentUserData.equipped[item.type] === item.value);
            
            let visual = renderVisual(item.type, item.value, "w-14 h-14");
            let btnAction = '';
            if (isEquipped) {
                btnAction = `<button class="w-full mt-2 bg-green-600 text-white text-xs py-1.5 rounded cursor-default opacity-50">${t('btn_equipped')}</button>`;
            } else if (isOwned) {
                btnAction = `<button onclick="equipItem('${item.type}', '${pid}', '${item.value}')" class="w-full mt-2 bg-slate-600 hover:bg-slate-500 text-white text-xs py-1.5 rounded">${t('btn_equip')}</button>`;
            } else {
                btnAction = `<button onclick="buyItem('${pid}', ${item.price})" class="w-full mt-2 bg-blue-600 hover:bg-blue-500 text-white text-xs py-1.5 rounded flex items-center justify-center gap-1"><i class="fa-solid fa-coins text-yellow-300"></i> ${item.price}</button>`;
            }

            const card = document.createElement('div');
            card.className = `store-card ${item.type}-item relative`;
            card.innerHTML = `
                ${isOwned ? '<div class="absolute top-2 right-2 text-green-400 text-xs"><i class="fa-solid fa-check"></i></div>' : ''}
                ${visual}
                <div class="text-sm font-bold text-white mt-2">${item.name}</div>
                <div class="text-xs text-gray-400 mb-1">${item.type === 'frame' ? 'Frame' : 'Avatar'}</div>
                ${btnAction}
            `;
            grid.appendChild(card);
        });
    } catch (e) { console.error(e); }
};

window.buyItem = async (pid, price) => {
    if (!currentUserData || !currentUserData.stats) return alert(t('loading'));
    if (currentUserData.stats.totalScore < price) return alert(t('msg_no_funds'));
    const isConfirmed = await openConfirm(t('msg_buy_confirm', {price: price}));
    if (!isConfirmed) return;

    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        let newInventory = currentUserData.inventory || [];
        if(newInventory.includes(pid)) return alert("You already own this item");
        
        newInventory.push(pid);
        const newScore = currentUserData.stats.totalScore - price;
        currentUserData.stats.totalScore = newScore;
        currentUserData.inventory = newInventory;

        await updateDoc(userRef, { "stats.totalScore": newScore, "inventory": newInventory });

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
            const netScore = getNetScore(stats);
            const correctRank = calculateRankFromScore(netScore);
            
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


window.drawSingleCard = async () => {
    const COST = 100;
    if (currentUserData.stats.totalScore < COST) return alert("積分不足！");
    
    // 🔥 修改這裡：改用 await openConfirm
    const isConfirmed = await openConfirm(`花費 ${COST} 積分進行單次召喚？`);
    if (!isConfirmed) return;

    await executeDraw(1, COST);
};

// 11連抽 (保底)
window.draw11Cards = async () => {
    const COST = 1000;
    if (currentUserData.stats.totalScore < COST) return alert("積分不足！");
    
    // 🔥 修改這裡：改用 await openConfirm，並更新提示文字為「罕見」
    const isConfirmed = await openConfirm(`花費 ${COST} 積分進行 11 連抽？\n(包含一張保底罕見以上)`);
    if (!isConfirmed) return;

    // 🔥 修改這裡：保底參數改為 "purple"
    await executeDraw(11, COST, "purple"); 
};

// 通用執行抽卡邏輯
async function executeDraw(count, cost, guaranteedRarity = null) {
    const btn = document.querySelector('button[onclick^="draw"]'); // 簡單鎖定按鈕
    if(btn) btn.disabled = true;

    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        let currentScore = currentUserData.stats.totalScore;
        
        // 先扣款 (前端顯示)
        currentScore -= cost;
        currentUserData.stats.totalScore = currentScore;
        updateUIStats();

        let totalRefund = 0;
        let results = [];
        let htmlResults = "";

        // 執行抽卡迴圈
        for (let i = 0; i < count; i++) {
            // 如果是 11 連抽的最後一張，且有設定保底
            let minR = null;
            if (guaranteedRarity && i === count - 1) minR = guaranteedRarity;

            const cardId = pickRandomCardId(minR);
            const res = await processCardAcquisition(userRef, cardId, currentScore);
            
            totalRefund += res.refund;
            results.push(res);
            
            // 建立結果 HTML (用於彈窗顯示)
            const rConfig = RARITY_CONFIG[res.rarity];
            htmlResults += `
                <div class="flex justify-between items-center bg-slate-800 p-2 rounded mb-1 border-l-4 ${rConfig.border.replace('border', 'border-l')}">
                    <span class="${rConfig.color} font-bold text-xs">[${rConfig.name}]</span>
                    <span class="text-white text-sm flex-1 ml-2">${res.name}</span>
                    <span class="text-[10px] text-gray-400">${res.refund > 0 ? '💰+100' : (res.msg.includes('強化') ? '⚡+5' : '🆕')}</span>
                </div>
            `;
        }

        // 處理扣款與返還的最終寫入
        const finalScore = currentScore + totalRefund;
        await updateDoc(userRef, { "stats.totalScore": finalScore });
        currentUserData.stats.totalScore = finalScore;
        updateUIStats();

        // 顯示結果彈窗 (可以使用簡單的 alert 或自定義 Modal)
        // 這裡簡單用 alert 顯示文字摘要，或者你可以做一個漂亮的 Overlay
        showDrawResults(results, totalRefund);

        // 重新載入卡片列表
        loadMyCards();
        updateHomeBestCard()

    } catch (e) {
        console.error(e);
        alert("召喚失敗，請稍後再試");
    } finally {
        if(btn) btn.disabled = false;
    }
}

// ==========================================
// 🎨 新版抽卡動畫系統
// ==========================================

let gachaSkip = false; // 用於跳過動畫

// [修正版] 更新戰鬥卡牌 UI (修復變數未宣告 + 新增卡面血量顯示)
function updateBattleCardUI(prefix, playerData) {
    if (!playerData) return;
    
    // 定義 ID 對應
    const idPrefix = prefix === 'my' ? 'my' : 'enemy';
    
    const cardVisualEl = document.getElementById(`${idPrefix}-card-visual`);
    const hpBarEl = document.getElementById(`${idPrefix}-hp-bar`);
    const hpTextEl = document.getElementById(`${idPrefix}-hp-text`);
    const subIndicatorEl = document.getElementById(`${idPrefix}-sub-card-indicator`);

    if (!cardVisualEl || !hpBarEl) return;

    const activeKey = playerData.activeCard; // 'main' or 'sub'
    const activeCard = playerData.cards[activeKey];
    
    // 防呆：如果 activeCard 不存在 (例如數據錯誤)，直接返回
    if (!activeCard) return;

    const dbCard = CARD_DATABASE[activeCard.id];
    if (!dbCard) return;

    const maxHp = dbCard.hp;
    const currentHp = activeCard.currentHp;
    const hpPercent = Math.max(0, (currentHp / maxHp) * 100);

    // 1. 更新卡片下方的血條
    hpBarEl.style.width = `${hpPercent}%`;
    hpTextEl.innerText = `${currentHp}/${maxHp}`;

    // 2. 更新卡面視覺
    const nameColor = activeKey === 'main' ? 'text-yellow-400' : 'text-gray-300';
    const borderClass = activeKey === 'main' ? 'border-yellow-500' : 'border-gray-500';
    
    // 更新卡片容器樣式
    const container = document.getElementById(`${idPrefix}-card-container`);
    if(container) {
        container.className = `relative w-32 h-48 bg-slate-800 rounded-lg border-2 ${borderClass} transition-all duration-500 mb-6 overflow-hidden shadow-2xl`;
    }

    const hasImage = getCardImageUrl(activeCard.id); 

    // 🔥【修正 1】宣告變數，解決 ReferenceError 崩潰
    let innerContent = ""; 

    if (hasImage) {
        innerContent = `
            <img src="${hasImage}" 
                 class="absolute inset-0 w-full h-full object-cover transition-transform duration-700 hover:scale-110"
                 onerror="this.style.display='none'; this.parentElement.querySelector('.fallback-text').style.display='flex'">
            
            <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent"></div>
            
            <div class="absolute top-1 left-1 text-[8px] font-bold text-white bg-black/50 px-1.5 py-0.5 rounded border border-white/20 z-10">
                ${activeCard.rarity === 'rainbow' ? 'LEGEND' : (activeCard.rarity === 'gold' ? 'MYTHIC' : 'MAIN')}
            </div>

            <div class="absolute bottom-0 w-full p-2 flex flex-col items-center z-10">
                <div class="${nameColor} font-bold text-sm text-center drop-shadow-[0_2px_2px_rgba(0,0,0,1)]">${activeCard.name}</div>
                
                <div class="flex items-center gap-2 mt-0.5 bg-black/40 px-2 py-0.5 rounded-full border border-white/10 backdrop-blur-sm">
                    <span class="text-xs text-green-400 font-black drop-shadow-md flex items-center gap-0.5">
                        <i class="fa-solid fa-heart text-[10px]"></i> ${currentHp}
                    </span>
                    <span class="text-gray-500 text-[10px]">|</span>
                    <span class="text-xs text-red-400 font-black drop-shadow-md flex items-center gap-0.5">
                        <i class="fa-solid fa-khanda text-[10px]"></i> ${activeCard.atk}
                    </span>
                </div>

                <div class="mt-1 text-[9px] text-cyan-300 bg-blue-900/60 px-1.5 py-0.5 rounded border border-blue-500/30 backdrop-blur-sm">
                    ${activeCard.skill}
                </div>
            </div>

            <div class="fallback-text hidden flex-col items-center justify-center h-full relative z-0">
                <div class="text-3xl mb-2 filter drop-shadow-lg animate-pulse">
                    ${activeCard.id === 'c051' || activeCard.id === 'c041' ? '🐲' : '⚔️'}
                </div>
                <div class="${nameColor} font-bold text-sm text-center">${activeCard.name}</div>
            </div>
        `;
    } else {
        // 無圖片的預設樣式
        innerContent = `
            <div class="flex flex-col items-center justify-center h-full relative z-10">
                <div class="text-[10px] uppercase tracking-widest text-gray-500 mb-1">${activeKey}</div>
                <div class="text-3xl mb-2 filter drop-shadow-lg animate-pulse">
                    ${activeKey === 'main' ? '🐉' : '🛡️'}
                </div>
                <div class="${nameColor} font-bold text-sm text-center">${activeCard.name}</div>
                
                <div class="flex gap-2 mt-1">
                    <div class="text-xs text-green-400 font-mono">HP ${currentHp}</div>
                    <div class="text-xs text-red-400 font-mono">ATK ${activeCard.atk}</div>
                </div>

                ${activeKey === 'main' ? `<div class="text-[9px] text-blue-300 mt-2 text-center px-1">${activeCard.skill}</div>` : ''}
            </div>
        `;
    }

    cardVisualEl.innerHTML = innerContent;

    // 3. 更新副卡指示燈 (維持原樣)
    if (subIndicatorEl) {
        if (playerData.cards.sub) {
            const subCardId = playerData.cards.sub.id;
            const subBase = CARD_DATABASE[subCardId] || { name: "Sub", rarity: "gray" };
            const subRConfig = RARITY_CONFIG[subBase.rarity] || RARITY_CONFIG.gray;
            
            const isActive = activeKey === 'sub';
            const isDead = playerData.cards.sub.currentHp <= 0;

            // 微調位置
            subIndicatorEl.className = `absolute ${prefix==='my'?'bottom-4 -left-2':'top-4 -right-2'} w-12 h-16 bg-slate-800 rounded border-2 transition-all duration-300 flex flex-col items-center justify-center overflow-hidden z-20 shadow-lg`;
            
            if (isDead) {
                subIndicatorEl.classList.add('border-gray-700', 'opacity-30', 'grayscale');
                subIndicatorEl.innerHTML = '<i class="fa-solid fa-skull text-gray-500"></i>';
            } else if (isActive) {
                subIndicatorEl.className += ` ${subRConfig.border} scale-110 ring-2 ring-yellow-400 ring-offset-1 ring-offset-slate-900`;
                subIndicatorEl.innerHTML = `
                    <div class="text-[8px] ${subRConfig.color} font-bold truncate w-full text-center px-0.5">${subBase.name}</div>
                    <div class="text-xs">⚔️</div>
                    <div class="text-[8px] text-white">${playerData.cards.sub.currentHp}</div>
                `;
            } else {
                subIndicatorEl.className += ` ${subRConfig.border} opacity-80 hover:opacity-100 hover:scale-105`;
                subIndicatorEl.innerHTML = `
                    <div class="bg-black/50 w-full text-center text-[7px] text-gray-300 absolute top-0">WAIT</div>
                    <div class="text-[8px] ${subRConfig.color} font-bold mt-2 truncate w-full text-center">${subBase.name}</div>
                `;
            }
        } else {
            subIndicatorEl.style.opacity = '0';
        }
    }
}

// [修正 2] 顯示抽卡結果 (確保每次都使用最新的 results)
window.currentDrawResults = []; // 初始化為空陣列

function showDrawResults(results, totalRefund) {
    const overlay = document.getElementById('gacha-overlay');
    const stage = document.getElementById('gacha-stage');
    const resultsContainer = document.getElementById('gacha-results-container');
    const magicCircle = document.getElementById('magic-circle');
    const orb = document.getElementById('summon-orb');
    
    // [重要] 立即更新全域變數，確保 Skip 時拿到的是這一次的結果
    window.currentDrawResults = results;
    console.log("抽卡結果更新:", results);

    // 1. 重置 UI 狀態
    gachaSkip = false;
    overlay.classList.remove('hidden');
    stage.classList.remove('hidden');
    
    // [修正] 必須清除 inline style 的 display: flex，否則會覆蓋 classList 的 hidden
    resultsContainer.style.display = ''; 
    resultsContainer.classList.add('hidden');
    
    // [重要] 徹底清空舊的卡片 DOM，防止殘留
    document.getElementById('gacha-cards-grid').innerHTML = '';

    // 重置動畫元素
    magicCircle.style.opacity = '0';
    orb.className = "w-10 h-10 rounded-full shadow-[0_0_50px_rgba(255,255,255,0.8)] relative z-10 transition-all duration-300"; 
    orb.style.backgroundColor = 'white';
    orb.style.boxShadow = 'none';
    orb.classList.remove('anim-orb-charge');

    // 2. 決定光球顏色 (取最高稀有度)
    let maxRarityVal = 0;
    const rarityMap = { 'gray': 0, 'blue': 1, 'purple': 2, 'red': 3, 'gold': 4, 'rainbow': 5 };
    const colorMap = {
        'gray': '#9ca3af', 'blue': '#3b82f6', 'purple': '#a855f7',
        'red': '#ef4444', 'gold': '#eab308', 'rainbow': '#ffffff'
    };
    
    let bestRarity = 'gray';
    results.forEach(r => {
        if (rarityMap[r.rarity] > maxRarityVal) {
            maxRarityVal = rarityMap[r.rarity];
            bestRarity = r.rarity;
        }
    });

    // 3. 播放動畫序列
    setTimeout(() => { magicCircle.style.opacity = '1'; }, 100);

    setTimeout(() => {
        if(gachaSkip) return; 
        orb.style.backgroundColor = colorMap[bestRarity];
        orb.style.boxShadow = `0 0 60px ${colorMap[bestRarity]}`;
        orb.classList.add('anim-orb-charge');
    }, 500);

    setTimeout(() => {
        // [重要] 使用傳入的 results (閉包) 來確保正確性
        if (!gachaSkip) {
            revealGachaResults(results);
        }
    }, 2300); 
}

// [修正 3] 跳過動畫 (使用正確的當次結果)
window.skipGachaAnimation = () => {
    if (gachaSkip) return; // 避免重複點擊
    gachaSkip = true;
    
    const orb = document.getElementById('summon-orb');
    if(orb) orb.classList.remove('anim-orb-charge');
    
    // 立即顯示結果
    if (window.currentDrawResults && window.currentDrawResults.length > 0) {
        revealGachaResults(window.currentDrawResults);
    }
};

// 顯示卡牌列表
function revealGachaResults(results) {
    const stage = document.getElementById('gacha-stage');
    const resultsContainer = document.getElementById('gacha-results-container');
    const grid = document.getElementById('gacha-cards-grid');
    
    // 閃白屏特效
    document.getElementById('gacha-overlay').classList.add('anim-flash');
    setTimeout(() => document.getElementById('gacha-overlay').classList.remove('anim-flash'), 500);

    stage.classList.add('hidden');
    resultsContainer.classList.remove('hidden');
    resultsContainer.style.display = 'flex'; // 確保 flex 佈局

    grid.innerHTML = '';

    // 生成卡牌 DOM
    results.forEach((res, index) => {
        const cardHtml = renderGachaCard(res, index);
        grid.appendChild(cardHtml);
    });

    // 依序翻牌 (Staggered Flip)
    const cards = document.querySelectorAll('.gacha-card-wrapper');
    cards.forEach((card, idx) => {
        setTimeout(() => {
            card.classList.add('flipped');
            if (navigator.vibrate) navigator.vibrate(20); // 震動反饋
        }, 500 + (idx * 200)); // 每張卡間隔 0.2 秒翻開
    });
}

// 產生單張卡牌的 HTML
function renderGachaCard(res, index) {
    const rConfig = RARITY_CONFIG[res.rarity];
    const wrapper = document.createElement('div');
    
    // 不同的稀有度對應不同的邊框 Glow Class
    const glowClass = `glow-${res.rarity}`;
    
    wrapper.className = `gacha-card-wrapper card-entry`;
    wrapper.style.animationDelay = `${index * 0.1}s`; // 進場延遲

    // 內容：判斷是強化還是新卡
    const isUpgrade = res.msg.includes('強化');
    const isRefund = res.refund > 0;
    
    let statusBadge = '';
    if (isRefund) statusBadge = '<span class="absolute top-2 right-2 bg-yellow-500 text-black text-[10px] font-bold px-1 rounded">💰 GET</span>';
    else if (isUpgrade) statusBadge = '<span class="absolute top-2 right-2 bg-green-500 text-white text-[10px] font-bold px-1 rounded">UP</span>';
    else statusBadge = '<span class="absolute top-2 right-2 bg-red-500 text-white text-[10px] font-bold px-1 rounded">NEW</span>';

    // 取得卡牌詳細數據 (從 CARD_DATABASE) - *注意：需要用 res.name 反查 ID 或是修改 executeDraw 回傳 ID*
    // 為了簡化，這裡直接用 res.name 顯示
    // 如果您在 executeDraw 回傳物件中加入了 `id: cardId` 會更好，這裡假設我們只有 name 和 rarity

    wrapper.innerHTML = `
        <div class="gacha-card-inner">
            <div class="gacha-card-back ${glowClass}"></div>
            
            <div class="gacha-card-front ${glowClass} relative flex flex-col p-2 bg-slate-800 border-2 ${rConfig.border}">
                ${statusBadge}
                
                <div class="flex-1 flex items-center justify-center relative overflow-hidden my-2 rounded-lg bg-black/30">
                    ${getCardVisualHtml(res.id, res.rarity, "text-5xl")} 
                </div>
                
                <div class="mt-2 text-center">
                    <div class="${rConfig.color} font-bold text-xs truncate">${res.name}</div>
                    <div class="text-[10px] text-gray-400 mt-1">
                        ${isRefund ? `返還 ${res.refund}` : (isUpgrade ? 'ATK +5' : '獲得')}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // 點擊可以手動翻牌 (如果還沒翻)
    wrapper.onclick = () => wrapper.classList.add('flipped');
    
    return wrapper;
}

// 修改 main.js 中的 closeGacha
window.closeGacha = () => {
    const overlay = document.getElementById('gacha-overlay');
    const resultsContainer = document.getElementById('gacha-results-container');
    const stage = document.getElementById('gacha-stage');
    
    // 1. 隱藏整個抽卡遮罩層
    overlay.classList.add('hidden');
    
    // 2. 重置內部容器狀態，避免下次開啟時閃現舊內容
    resultsContainer.classList.add('hidden');
    resultsContainer.style.display = 'none'; // 強制隱藏
    stage.classList.remove('hidden'); // 回到準備召喚狀態
    
    // 3. 清空結果網格
    document.getElementById('gacha-cards-grid').innerHTML = '';
    
    // 4. 重新整理資料顯示
    loadMyCards();        // 重新載入背包列表
    updateHomeBestCard(); // 更新首頁最強卡牌
    updateUIStats();      // 更新積分顯示
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
