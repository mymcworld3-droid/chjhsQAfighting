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

// ==========================================
// 0. 卡牌資料庫與稀有度設定
// ==========================================

const RARITY_CONFIG = {
    gray:   { name: "普通", color: "text-gray-400", border: "border-gray-500", prob: 0.50 },    // 50%
    blue:   { name: "稀有", color: "text-blue-400", border: "border-blue-500", prob: 0.30 },    // 30%
    purple: { name: "罕見", color: "text-purple-400", border: "border-purple-500", prob: 0.15 }, // 15%
    red:    { name: "史詩", color: "text-red-500", border: "border-red-500", prob: 0.04 },      // 4%
    gold:   { name: "神話", color: "text-yellow-400", border: "border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.6)]", prob: 0.008 }, // 0.8%
    rainbow:{ name: "傳奇", color: "text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-green-500 to-blue-500 animate-pulse", border: "border-white shadow-[0_0_20px_rgba(255,255,255,0.8)]", prob: 0.002 } // 0.2%
};

// 為了測試，這裡擴充了一些卡牌
const CARD_DATABASE = {
    // --- 普通 (Gray) ---
    "c001": { name: "史萊姆", hp: 50, atk: 10, rarity: "gray", trait: "黏液", skill: "撞擊", skillDmg: 5 },
    "c002": { name: "哥布林", hp: 60, atk: 15, rarity: "gray", trait: "貪婪", skill: "偷襲", skillDmg: 8 },
    
    // --- 稀有 (Blue) ---
    "c011": { name: "冰霜狼", hp: 80, atk: 25, rarity: "blue", trait: "迅捷", skill: "冰咬", skillDmg: 15 },
    "c012": { name: "鐵甲衛兵", hp: 120, atk: 15, rarity: "blue", trait: "堅硬", skill: "盾防", skillDmg: 5 },

    // --- 罕見 (Purple) ---
    "c021": { name: "暗影刺客", hp: 90, atk: 45, rarity: "purple", trait: "隱匿", skill: "背刺", skillDmg: 35 },
    "c022": { name: "元素法師", hp: 100, atk: 40, rarity: "purple", trait: "魔力", skill: "火球", skillDmg: 30 },

    // --- 史詩 (Red) ---
    "c031": { name: "火焰幼龍", hp: 150, atk: 55, rarity: "red", trait: "龍威", skill: "龍息", skillDmg: 50 },
    "c032": { name: "吸血鬼伯爵", hp: 140, atk: 50, rarity: "red", trait: "吸血", skill: "血爆", skillDmg: 45 },

    // --- 神話 (Gold) ---
    "c041": { name: "光之守護者", hp: 250, atk: 70, rarity: "gold", trait: "聖光", skill: "審判", skillDmg: 80 },

    // --- 傳奇 (Rainbow) ---
    "c051": { name: "虛空魔神", hp: 500, atk: 120, rarity: "rainbow", trait: "毀滅", skill: "黑洞", skillDmg: 999 }
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
        rank_king: "👑 王者"
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
        rank_king: "👑 King"
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

onAuthStateChanged(auth, async (user) => {
    updateTexts();

    if (user) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('bottom-nav').classList.remove('hidden');
        document.getElementById('user-info').innerHTML = `<i class="fa-solid fa-user-astronaut"></i> ${user.displayName}`;
        document.getElementById('settings-email').innerText = user.email;

        injectSocialUI();

        const userRef = doc(db, "users", user.uid);
        try {
            const docSnap = await getDoc(userRef);
            
            if (docSnap.exists()) {
                currentUserData = docSnap.data();
                if (!currentUserData.inventory) currentUserData.inventory = [];
                if (!currentUserData.equipped) currentUserData.equipped = { frame: '', avatar: '' };
                if (!currentUserData.friends) currentUserData.friends = []; 
                if (!currentUserData.cards || currentUserData.cards.length === 0) {
                    currentUserData.cards = ["c001", "c002"];
                    currentUserData.deck = { main: "c001", sub: "c002" };
                    // 這裡建議加上 updateDoc 寫回資料庫，以免玩家沒存檔
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

            startPresenceSystem();
            startInvitationListener(); // 🔥 啟動邀請監聽
            listenToSystemCommands();  // 🔥 啟動全域重整監聽
            
            updateUserAvatarDisplay();
            updateSettingsInputs();
            checkAdminRole(currentUserData.isAdmin);
            updateUIStats();
            updateDeckDisplay();

            if (!currentUserData.profile.educationLevel || currentUserData.profile.educationLevel === "") {
                switchToPage('page-onboarding'); 
                document.getElementById('bottom-nav').classList.add('hidden'); 
            } else {
                switchToPage('page-home');
                fillBuffer(); 
            }

        } catch (error) { console.error(error); alert("Data Load Error"); }
    } else {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('bottom-nav').classList.add('hidden');
        // 登出時取消監聽
        if (inviteUnsub) inviteUnsub();
        if (systemUnsub) systemUnsub();
        if (chatUnsub) chatUnsub();
    }
});

// [修改] 載入我的卡庫 (支援等級與稀有度顯示)
window.loadMyCards = () => {
    const list = document.getElementById('my-card-list');
    if(!list) return;
    list.innerHTML = "";
    
    if(!currentUserData.cards || currentUserData.cards.length === 0) {
        list.innerHTML = `<div class="col-span-2 text-center text-gray-500 py-4">${t('msg_no_cards')}</div>`;
        return;
    }

    // 確保 cardLevels 存在
    const levels = currentUserData.cardLevels || {};
    const uniqueCards = [...new Set(currentUserData.cards)];

    // 排序：稀有度高 -> 低，等級高 -> 低
    uniqueCards.sort((a, b) => {
        const cardA = CARD_DATABASE[a];
        const cardB = CARD_DATABASE[b];
        const rarityOrder = ["rainbow", "gold", "red", "purple", "blue", "gray"];
        const rDiff = rarityOrder.indexOf(cardA.rarity) - rarityOrder.indexOf(cardB.rarity);
        if (rDiff !== 0) return rDiff; // 稀有度優先
        return (levels[b] || 0) - (levels[a] || 0); // 等級其次
    });

    uniqueCards.forEach(cardId => {
        const card = CARD_DATABASE[cardId];
        if(!card) return;
        
        const lvl = levels[cardId] || 0;
        const finalAtk = card.atk + (lvl * 5); // 基礎攻擊 + 等級加成
        const rConfig = RARITY_CONFIG[card.rarity];

        const isMain = currentUserData.deck.main === cardId;
        const isSub = currentUserData.deck.sub === cardId;
        let badge = "";
        if(isMain) badge = `<span class="bg-yellow-600 text-[10px] px-1 rounded ml-1">Main</span>`;
        else if(isSub) badge = `<span class="bg-gray-600 text-[10px] px-1 rounded ml-1">Sub</span>`;

        // 星星顯示 (等級)
        let stars = "";
        for(let i=0; i<lvl; i++) stars += "★";

        const div = document.createElement('div');
        // 套用稀有度邊框與光暈
        div.className = `bg-slate-800 p-3 rounded-xl border-2 ${rConfig.border} relative overflow-hidden group hover:scale-[1.02] transition-transform`;
        
        div.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <span class="font-bold ${rConfig.color} text-sm">${card.name} ${badge}</span>
                <span class="text-xs text-yellow-500 font-mono tracking-tighter">${stars}</span>
            </div>
            <div class="flex justify-between items-end">
                <div>
                    <div class="text-[10px] text-gray-400">HP: ${card.hp}</div>
                    <div class="text-[10px] text-gray-300">Trait: ${card.trait}</div>
                </div>
                <div class="text-right">
                    <div class="text-lg font-bold text-red-400 font-mono">⚔️${finalAtk}</div>
                    <div class="text-[9px] text-gray-500">Base: ${card.atk}</div>
                </div>
            </div>
            <div class="mt-2 pt-2 border-t border-white/10 text-[10px] text-blue-300 truncate">
                ⚡ ${card.skill} (${card.skillDmg})
            </div>
        `;
        // 點擊事件 (如果需要詳情或裝備)
        // div.onclick = ... 
        list.appendChild(div);
    });
};

// [新增] 開啟選擇卡牌 Modal
window.selectCardForSlot = (slot) => {
    currentSelectSlot = slot;
    document.getElementById('card-selector-modal').classList.remove('hidden');
    renderModalCards();
};

// [新增] 渲染 Modal 中的卡牌列表
function renderModalCards() {
    const list = document.getElementById('modal-card-list');
    list.innerHTML = "";
    const myCards = [...new Set(currentUserData.cards || [])]; 
    
    myCards.forEach(cardId => {
        const card = CARD_DATABASE[cardId];
        if(!card) return;
        
        const div = document.createElement('div');
        div.className = "bg-slate-700 p-2 rounded border border-slate-600 cursor-pointer hover:border-yellow-500 flex flex-col gap-1";
        div.innerHTML = `
            <div class="font-bold text-white text-sm">${card.name}</div>
            <div class="text-[10px] text-gray-300">HP:${card.hp} ATK:${card.atk}</div>
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
        refund = 100;
        // 分數不扣反增 (因為外層已經扣了，這裡補回)
        // 注意：外層是批次扣分，這裡是單張邏輯，我們回傳 refund 值由外層處理
        msg = `💰 ${cardName} 已滿等，返還 100 積分`;
    }

    return { msg, refund, rarity, name: cardName };
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
    btn.className = "flex flex-col items-center justify-center hover:bg-white/5 text-gray-400 hover:text-white transition group";
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

// [修改] 頁面切換函式
window.switchToPage = (pageId) => {
    if (isBattleActive && pageId !== 'page-battle') {
        alert("Battle in progress!");
        return;
    }
    
    // 如果離開社交頁面，關閉聊天室監聽
    if (pageId !== 'page-social' && chatUnsub) {
        chatUnsub();
        chatUnsub = null;
    }

    document.querySelectorAll('.page-section').forEach(el => { el.classList.remove('active-page', 'hidden'); el.classList.add('hidden'); });
    const target = document.getElementById(pageId);
    if(target) { target.classList.remove('hidden'); target.classList.add('active-page'); }
    
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
    
    if (pageId === 'page-settings') { renderInventory(); loadUserHistory(); }
    if (pageId === 'page-admin') loadAdminData();
    if (pageId === 'page-social') {
        switchSocialTab('friends');
    }
    // [新增] 當進入卡牌頁面時，載入卡庫並顯示牌組
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

    const starContainer = document.getElementById('display-stars').parentElement;
    starContainer.innerHTML = `<i class="fa-solid fa-star text-yellow-400 animate-pulse"></i> <span>${t('label_net_progress')}: <span id="display-stars" class="font-bold text-white text-lg">${currentStarsDisplay}</span> / ${maxStarsDisplay}</span>`;

    document.getElementById('display-score').innerText = stats.totalScore;
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
async function fetchOneQuestion() {
    const settings = currentUserData.gameSettings || { source: 'ai', difficulty: 'medium' };
    const rankName = getRankName(currentUserData.stats.rankLevel || 0); 

    let finalDifficulty = settings.difficulty;
    if (!finalDifficulty || finalDifficulty === 'auto') {
        finalDifficulty = getSmartDifficulty();
    }
    
    // --- AI 模式 ---
    if (settings.source === 'ai') {
        const BACKEND_URL = "/api/generate-quiz";
        const level = currentUserData.profile.educationLevel || "General";
        
        let rawWeakString = currentUserData.profile.weakSubjects || "";
        let rawStrongString = currentUserData.profile.strongSubjects || "";
        let weakArray = rawWeakString.split(/[,，\s]+/).filter(s => s.trim().length > 0);
        let strongArray = rawStrongString.split(/[,，\s]+/).filter(s => s.trim().length > 0);
        const generalTopics = ["History", "Geography", "Science", "Logic", "Language", "Tech"];
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
                subject: targetSubject, level: level, rank: rankName, difficulty: finalDifficulty,
                language: currentLang 
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
            badge: `🎯 ${targetSubject}` 
        };
    } 
    // --- 題庫模式 ---
    else {
        let targetSource = settings.source; 
        if (!currentBankData || currentBankData.sourcePath !== targetSource) {
            let filesToFetch = [];
            if (targetSource.endsWith('.json')) { filesToFetch = [targetSource]; } 
            else {
                if (allBankFiles.length === 0) {
                      try { const res = await fetch('/api/banks'); const data = await res.json(); allBankFiles = data.files || []; } catch (e) { console.error(e); }
                }
                filesToFetch = allBankFiles.filter(f => f.startsWith(targetSource + '/'));
                if (filesToFetch.length === 0) { console.error("Empty folder:", targetSource); return switchToAI(); }
            }
            try {
                console.log(`📚 Loading ${filesToFetch.length} files...`);
                const fetchPromises = filesToFetch.map(filePath => fetch(`/banks/${filePath}?t=${Date.now()}`).then(res => { if (!res.ok) throw new Error(); return res.json(); }).catch(err => []));
                const results = await Promise.all(fetchPromises);
                const mergedQuestions = results.flat();
                if (mergedQuestions.length === 0) throw new Error("No questions");
                currentBankData = { sourcePath: targetSource, questions: mergedQuestions };
            } catch (e) { console.error("Bank Error:", e); alert("Bank load failed, switching to AI"); return switchToAI(); }
        }
        const filteredQuestions = currentBankData.questions.filter(q => q.difficulty === finalDifficulty);
        const pool = filteredQuestions.length > 0 ? filteredQuestions : currentBankData.questions;
        if (pool.length === 0) throw new Error("Pool empty!");
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
window.startQuizFlow = async () => {
    switchToPage('page-quiz');
    document.getElementById('quiz-container').classList.add('hidden');
    document.getElementById('feedback-section').classList.add('hidden');
    document.getElementById('btn-giveup').classList.remove('hidden');
    const savedQuiz = localStorage.getItem('currentQuiz');
    if (savedQuiz) { const q = JSON.parse(savedQuiz); renderQuiz(q.data, q.rank, q.badge); fillBuffer(); return; }
    if (quizBuffer.length > 0) { const nextQ = quizBuffer.shift(); localStorage.setItem('currentQuiz', JSON.stringify(nextQ)); renderQuiz(nextQ.data, nextQ.rank, nextQ.badge); fillBuffer(); } 
    else {
        document.getElementById('quiz-loading').classList.remove('hidden');
        document.getElementById('loading-text').innerText = t('loading_text');
        try { const q = await fetchOneQuestion(); localStorage.setItem('currentQuiz', JSON.stringify(q)); renderQuiz(q.data, q.rank, q.badge); fillBuffer(); } 
        catch (e) { console.error(e); alert("Failed to start"); switchToPage('page-home'); }
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
        fbTitle.innerText = t('msg_correct'); fbTitle.className = "text-xl font-bold text-green-400";
        fbIcon.innerHTML = '<i class="fa-solid fa-circle-check text-green-400"></i>';
        if (navigator.vibrate) navigator.vibrate(50);
    } else {
        fbTitle.innerText = t('msg_wrong'); fbTitle.className = "text-xl font-bold text-red-400";
        fbIcon.innerHTML = '<i class="fa-solid fa-circle-xmark text-red-400"></i>';
        if (navigator.vibrate) navigator.vibrate(200);
    }
    localStorage.removeItem('currentQuiz');
    fbText.innerText = explanation || "AI did not provide explanation.";

    let stats = currentUserData.stats;
    stats.totalAnswered++;
    if (isCorrect) {
        stats.totalCorrect++; stats.currentStreak++;
        if (stats.currentStreak > stats.bestStreak) stats.bestStreak = stats.currentStreak;
        stats.totalScore += 10 + (stats.rankLevel * 5) + (stats.currentStreak * 2);
    } else {
        stats.currentStreak = 0; 
    }

    const netScore = getNetScore(stats);
    const newRank = calculateRankFromScore(netScore);
    
    if (newRank > stats.rankLevel) {
        stats.rankLevel = newRank;
        fbTitle.innerHTML += ` <br><span class="text-yellow-400 text-sm animate-bounce">${t('msg_rank_up')} ${t(RANKS_KEYS[newRank])}!</span>`;
        if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
    } else if (newRank < stats.rankLevel) {
        stats.rankLevel = newRank;
        fbTitle.innerHTML += ` <br><span class="text-red-400 text-sm">${t('msg_rank_down')} ${t(RANKS_KEYS[newRank])}...</span>`;
    }

    updateDoc(doc(db, "users", auth.currentUser.uid), { stats: stats });
    addDoc(collection(db, "exam_logs"), { uid: auth.currentUser.uid, email: auth.currentUser.email, question: questionText, isCorrect: isCorrect, rankAtTime: t(RANKS_KEYS[stats.rankLevel]), timestamp: serverTimestamp() }).catch(e => console.error(e));
    updateUIStats(); fillBuffer();
}

window.giveUpQuiz = () => { if(confirm("Give up this question?")) handleAnswer(-1, -2, document.getElementById('question-text').innerText, "Skipped."); };
window.nextQuestion = () => { startQuizFlow(); };

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
            alert("系統進行更新，即將重新整理網頁...");
            location.reload();
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



let isGenerating = false;
async function generateSharedQuiz(roomId) {
    if (isGenerating) return;
    isGenerating = true; 
    try {
        const q = await fetchOneQuestion(); 
        await updateDoc(doc(db, "rooms", roomId), { currentQuestion: { q: q.data.q, opts: q.data.opts, ans: q.data.ans } });
    } catch (e) { console.error("Gen Error", e); } finally { isGenerating = false; }
}
// [修正] 離開對戰 (確實清理房間)
window.leaveBattle = async () => {
    if (battleUnsub) { 
        battleUnsub(); 
        battleUnsub = null; 
    }

    if (currentBattleId) {
        const roomIdToRemove = currentBattleId;
        // 只有當我是房主，且房間還在 waiting 狀態時，才刪除房間
        try {
            const snap = await getDoc(doc(db, "rooms", roomIdToRemove));
            if (snap.exists()) { 
                const data = snap.data(); 
                if (data.status === "waiting" && data.host.uid === auth.currentUser.uid) { 
                    console.log("🗑️ 清理未配對的房間:", roomIdToRemove);
                    await deleteDoc(doc(db, "rooms", roomIdToRemove)); 
                } 
            }
        } catch (err) { console.error("清理房間失敗", err); }
    }
    
    isBattleActive = false; 
    currentBattleId = null; 
    switchToPage('page-home');
};

// [修正] 開始配對 (增加隨機性與重試機制)
window.startBattleMatchmaking = async () => {
    if (!auth.currentUser) { alert("Please login first!"); return; }
    if (!currentUserData.deck?.main) { alert("請先到卡牌中心設定「主卡」！"); switchToPage('page-cards'); return; }

    console.log("🚀 Matchmaking..."); 
    isBattleActive = true;
    switchToPage('page-battle');
    document.getElementById('battle-lobby').classList.remove('hidden');
    document.getElementById('battle-arena').classList.add('hidden');
    document.getElementById('battle-status-text').innerText = t('battle_searching');

    // 只搜尋最近 1 分鐘內建立的房間，避免配對到死房間
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    
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

    try {
        // 搜尋等待中的房間
        const q = query(
            collection(db, "rooms"), 
            where("status", "==", "waiting"), 
            where("createdAt", ">", oneMinuteAgo), // 加入時間過濾
            limit(10) // 增加搜尋範圍
        );
        
        const snapshot = await getDocs(q);
        let joinedRoomId = null;

        if (!snapshot.empty) {
            // 過濾掉自己開的房間
            const availableDocs = snapshot.docs.filter(d => { 
                const data = d.data(); 
                return data.host && data.host.uid !== auth.currentUser.uid; 
            });

            if (availableDocs.length > 0) {
                // 隨機選一個加入
                const targetDoc = availableDocs[Math.floor(Math.random() * availableDocs.length)];
                const roomRef = doc(db, "rooms", targetDoc.id);
                
                try {
                    await runTransaction(db, async (transaction) => {
                        const sfDoc = await transaction.get(roomRef);
                        if (!sfDoc.exists()) throw "Doc missing";
                        const data = sfDoc.data();
                        if (data.status === "waiting" && !data.guest) {
                            transaction.update(roomRef, { guest: myBattleData, status: "ready" });
                            joinedRoomId = targetDoc.id;
                        } else { throw "Room full"; }
                    });
                } catch (e) { console.log("Match conflict", e); }
            }
        }

        if (joinedRoomId) {
            currentBattleId = joinedRoomId;
            isBattleResultProcessed = false;
            document.getElementById('battle-status-text').innerText = t('battle_connecting');
            listenToBattleRoom(currentBattleId);
        } else {
            // 沒找到房間，自己建立
            document.getElementById('battle-status-text').innerText = "Waiting for challenger...";
            const roomRef = await addDoc(collection(db, "rooms"), { 
                host: myBattleData, 
                guest: null, 
                status: "waiting", 
                round: 1, 
                createdAt: serverTimestamp() 
            });
            currentBattleId = roomRef.id;
            isBattleResultProcessed = false;
            
            // 隨機邀請線上玩家 (增加配對機率)
            inviteRandomPlayers(currentBattleId);
            
            listenToBattleRoom(currentBattleId);
        }
    } catch (e) {
        console.error("Match error", e);
        alert("Match failed: " + e.message); 
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
// [修正] 監聽對戰室 (加入強制 UI 切換邏輯)
function listenToBattleRoom(roomId) {
    if (battleUnsub) battleUnsub();
    
    console.log("📡 開始監聽對戰房間:", roomId);

    battleUnsub = onSnapshot(doc(db, "rooms", roomId), async (docSnap) => {
        if (!docSnap.exists()) {
            console.log("房間已不存在");
            alert("對戰已結束或房間被關閉");
            leaveBattle();
            return;
        }

        const room = docSnap.data();
        if (!auth.currentUser) return;

        const isHost = room.host.uid === auth.currentUser.uid;
        const myData = isHost ? room.host : room.guest;
        const oppData = isHost ? room.guest : room.host;

        // --- 1. 遊戲進行中 (Ready) ---
        if (room.status === "ready") {
            // 🔥 [關鍵修正]：只要狀態是 ready，強制切換到戰鬥畫面
            const lobby = document.getElementById('battle-lobby');
            const arena = document.getElementById('battle-arena');
            
            if (!lobby.classList.contains('hidden')) {
                lobby.classList.add('hidden');
                arena.classList.remove('hidden');
            }

            // 確保「題目遮罩層」是打開的
            const overlay = document.getElementById('battle-quiz-overlay');
            if(overlay.classList.contains('hidden') && !room.currentQuestion) {
                 overlay.classList.remove('hidden');
                 overlay.style.display = "flex";
            }

            // 更新血量與卡牌
            updateBattleCardUI('my', myData);
            updateBattleCardUI('enemy', oppData);
            document.getElementById('battle-round').innerText = room.round;

            // --- 題目處理邏輯 (結合上一輪的修改) ---
            if (room.currentQuestion) {
                 const qTextEl = document.getElementById('battle-q-text');
                 // 儲存解析
                 window.currentBattleExp = room.currentQuestion.exp;

                 if (qTextEl.innerText !== room.currentQuestion.q) {
                    document.getElementById('battle-loading').classList.add('hidden');
                    document.getElementById('battle-quiz-box').classList.remove('hidden');
                    document.getElementById('battle-feedback').classList.add('hidden');
                    document.getElementById('battle-waiting-msg').classList.add('hidden');
                    
                    qTextEl.innerText = room.currentQuestion.q;
                    const container = document.getElementById('battle-options');
                    container.innerHTML = '';
                    
                    if (!myData.done) {
                        room.currentQuestion.opts.forEach((opt, idx) => {
                            const btn = document.createElement('button');
                            btn.className = "w-full text-left p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition border border-slate-600 active:scale-95 mb-2 flex items-center";
                            btn.innerHTML = `<span class="bg-slate-800 w-8 h-8 rounded-full inline-flex items-center justify-center text-sm font-bold text-blue-400 border border-slate-600 mr-3 shrink-0">${String.fromCharCode(65+idx)}</span><span class="text-white font-bold">${opt}</span>`;
                            btn.onclick = () => handleBattleAnswer(roomId, idx, room.currentQuestion.ans, isHost);
                            container.appendChild(btn);
                        });
                    } else {
                        // 如果已經 Done 但還在 ready 狀態 (等待對手)，顯示等待
                        document.getElementById('battle-waiting-msg').classList.remove('hidden');
                    }
                }
            } else {
                // 沒有題目時顯示 Loading
                document.getElementById('battle-loading').classList.remove('hidden');
                document.getElementById('battle-quiz-box').classList.add('hidden');
                if (isHost) generateSharedQuiz(roomId);
            }

            // Host 結算邏輯
            if (room.host?.done && room.guest?.done && isHost && !room.isResolving) {
                updateDoc(doc(db, "rooms", roomId), { isResolving: true });
                setTimeout(() => resolveRoundLogic(roomId, room), 2500);
            }
        }
        
        // --- 2. 遊戲結束 (Finished) ---
        if (room.status === "finished") {
            // (這部分維持原樣)
            document.getElementById('battle-quiz-overlay').classList.add('hidden');
            document.getElementById('battle-arena').classList.add('hidden');
            document.getElementById('battle-result').classList.remove('hidden');
            
            const titleEl = document.getElementById('battle-result-title');
            const msgEl = document.getElementById('battle-result-msg');
            const isWinner = room.winner === auth.currentUser.uid;
            
            if (isWinner) {
                titleEl.innerText = "🎉 勝利！";
                titleEl.className = "text-3xl font-bold mb-2 text-green-400 animate-bounce";
                if (!isBattleResultProcessed) {
                    isBattleResultProcessed = true;
                    processBattleWin(isHost ? room.guest : room.host, msgEl);
                }
            } else if (!room.winner) {
                titleEl.innerText = "🤝 平手";
                msgEl.innerText = "勢均力敵";
            } else {
                titleEl.innerText = "💔 戰敗";
                msgEl.innerText = "再接再厲！";
            }
        }
    });
}
// [新增] 回合結算邏輯 (Host Only)
async function resolveRoundLogic(roomId, room) {
    const host = room.host;
    const guest = room.guest;
    
    // 取得時間戳記 (如果是 null 則視為極大值，即超時)
    const tHost = host.answerTime ? host.answerTime.toMillis() : Date.now();
    const tGuest = guest.answerTime ? guest.answerTime.toMillis() : Date.now();

    // 建立行動佇列 (Action Queue)
    // 邏輯：答對者加入攻擊佇列。若都答對，時間短者排前面。
    let actions = [];

    if (host.answerCorrect && guest.answerCorrect) {
        if (tHost < tGuest) {
            actions = ['host', 'guest']; // Host 較快
        } else {
            actions = ['guest', 'host']; // Guest 較快
        }
    } else if (host.answerCorrect) {
        actions = ['host'];
    } else if (guest.answerCorrect) {
        actions = ['guest'];
    }
    // 若都答錯，actions 為空，無人攻擊

    const roomRef = doc(db, "rooms", roomId);

    await runTransaction(db, async (transaction) => {
        // 重新讀取以確保數據最新
        const freshDoc = await transaction.get(roomRef);
        if (!freshDoc.exists()) return;
        const freshRoom = freshDoc.data();
        
        let h = freshRoom.host;
        let g = freshRoom.guest;
        let logMsg = "";

        // 執行攻擊迴圈
        for (const attackerRole of actions) {
            const attacker = attackerRole === 'host' ? h : g;
            const defender = attackerRole === 'host' ? g : h;
            const defRole = attackerRole === 'host' ? 'guest' : 'host';

            // 如果防守者已經死了，停止攻擊 (鞭屍邏輯可選)
            if (defender.isDead) continue;

            const cardKey = attacker.activeCard;
            const card = attacker.cards[cardKey];
            // 簡單傷害公式
            let damage = card.atk; 
            // 如果是主卡，加技能傷害
            if (cardKey === 'main') damage += (card.skillDmg || 0);

            // 扣血
            const targetKey = defender.activeCard;
            let newHp = defender.cards[targetKey].currentHp - damage;

            if (newHp <= 0) {
                newHp = 0;
                // 死亡切換邏輯
                if (targetKey === 'main' && defender.cards.sub) {
                    // 主卡死，切副卡
                    defender.activeCard = 'sub';
                    logMsg = `${attacker.name} 擊敗了 ${defender.cards.main.name}！`;
                } else {
                    // 全死
                    defender.isDead = true;
                    logMsg = `${attacker.name} 獲得了勝利！`;
                }
            }

            // 更新記憶體中的數據
            defender.cards[targetKey].currentHp = newHp;
        }

        // 判斷遊戲是否結束
        if (h.isDead || g.isDead || freshRoom.round >= 10) {
             let winnerUid = null;
             let loserUid = null;
             
             if (h.isDead && !g.isDead) { winnerUid = g.uid; loserUid = h.uid; }
             else if (!h.isDead && g.isDead) { winnerUid = h.uid; loserUid = g.uid; }
             else {
                 // 回合結束比血量
                 const hTotal = h.cards.main.currentHp + (h.cards.sub?.currentHp || 0);
                 const gTotal = g.cards.main.currentHp + (g.cards.sub?.currentHp || 0);
                 if (hTotal > gTotal) { winnerUid = h.uid; loserUid = g.uid; }
                 else if (gTotal > hTotal) { winnerUid = g.uid; loserUid = h.uid; }
             }

             transaction.update(roomRef, {
                 host: h,
                 guest: g,
                 status: "finished",
                 winner: winnerUid,
                 loser: loserUid,
                 isResolving: false
             });
        } else {
            // 進入下一回合
            transaction.update(roomRef, {
                host: h,
                guest: g,
                round: freshRoom.round + 1,
                currentQuestion: null, // 清空題目以觸發生成
                "host.done": false,
                "guest.done": false,
                "host.answerCorrect": null,
                "guest.answerCorrect": null,
                "host.answerTime": null,
                "guest.answerTime": null,
                isResolving: false
            });
        }
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
        currentUserData.stats.totalCorrect += 10; 
        
        const currentNetScore = getNetScore(currentUserData.stats);
        const newRank = calculateRankFromScore(currentNetScore);
        
        await updateDoc(userRef, { 
            "stats.totalScore": currentUserData.stats.totalScore,
            "stats.rankLevel": newRank,
            "cards": arrayUnion(...lootIds)
        });

        // 更新本地
        currentUserData.cards.push(...lootIds);
        currentUserData.stats.rankLevel = newRank;

        msgEl.innerHTML = `獲得獎勵：<br>🏆 200 積分<br>🎴 戰利品卡牌 ${lootIds.length} 張`;
        updateUIStats();
    } catch (e) { 
        console.error("Loot failed", e); 
        msgEl.innerText = "結算發生錯誤，請聯繫管理員";
    }
}

window.confirmBattleDeck = async () => {
    const btn = document.getElementById('btn-battle-ready');
    const cancelBtn = document.getElementById('btn-battle-cancel');
    const previewDiv = document.getElementById('setup-stats-preview');
    
    // UI 切換為尋找狀態
    btn.classList.add('hidden');
    cancelBtn.classList.remove('hidden');
    
    // 顯示配對中狀態
    previewDiv.innerHTML = `
        <div class="text-center py-4">
            <div class="loader w-8 h-8 border-2 mx-auto mb-2"></div>
            <p class="text-sm text-blue-400 animate-pulse">🔍 搜尋對手中...</p>
            <p class="text-xs text-gray-500 mt-1">請稍候</p>
        </div>
    `;

    try {
        // 計算戰鬥數據
        const main = selectedDeck.main;
        const sub = selectedDeck.sub;
        let finalHp = main.hp;
        let finalAtk = main.power;

        if (sub.subTrait) {
            if (sub.subTrait.type === 'buff_hp') finalHp *= (1 + sub.subTrait.val);
            if (sub.subTrait.type === 'buff_atk') finalAtk *= (1 + sub.subTrait.val);
            if (sub.subTrait.type === 'buff_hp_flat') finalHp += sub.subTrait.val;
            if (sub.subTrait.type === 'buff_atk_flat') finalAtk += sub.subTrait.val;
        }

        const myBattleData = {
            uid: auth.currentUser.uid,
            name: currentUserData.displayName,
            avatar: currentUserData.equipped?.avatar || '',
            hp: Math.floor(finalHp),
            maxHp: Math.floor(finalHp),
            atk: Math.floor(finalAtk),
            mainCard: main,
            subCard: sub,
            answer: null
        };

        // 先清理過期房間 (超過 2 分鐘且還在 waiting 的)
        const twoMinAgo = new Date(Date.now() - 120000);
        const expiredQuery = query(
            collection(db, "pvp_rooms"), 
            where("status", "==", "waiting"), 
            where("createdAt", "<", twoMinAgo)
        );
        const expiredSnap = await getDocs(expiredQuery);
        const batch = writeBatch(db);
        expiredSnap.forEach(doc => batch.delete(doc.ref));
        if (!expiredSnap.empty) await batch.commit();

        // 配對邏輯：尋找等待中的房間
        const waitingQuery = query(
            collection(db, "pvp_rooms"), 
            where("status", "==", "waiting"),
            where("createdAt", ">", twoMinAgo),
            limit(5) // 多抓幾個以防有自己的房間
        );
        const snapshot = await getDocs(waitingQuery);

        // 過濾掉自己創建的房間
        const availableRooms = snapshot.docs.filter(
            doc => doc.data().host.uid !== auth.currentUser.uid
        );

        if (availableRooms.length > 0) {
            // 找到對手的房間，加入
            const roomDoc = availableRooms[0];
            console.log('[Guest] 找到房間:', roomDoc.id, '準備加入...');
            
            await updateDoc(doc(db, "pvp_rooms", roomDoc.id), {
                guest: myBattleData,
                status: "battle",
                turn: 1,
                attacker: Math.random() < 0.5 ? 'host' : 'guest'
            });
            
            currentRoomId = roomDoc.id;
            myBattleRole = 'guest';
            
            console.log('✅ [Guest] 成功加入房間，進入戰鬥介面');
            showToast('✅ 找到對手！', 'success');
            
            // 延遲進入戰鬥
            setTimeout(() => {
                initBattleInterface();
            }, 500);
            return;
        }

        // 沒有可用房間，創建新房間
        const docRef = await addDoc(collection(db, "pvp_rooms"), {
            host: myBattleData,
            guest: null,
            status: "waiting",
            createdAt: serverTimestamp(),
            turn: 1,
            expiresAt: new Date(Date.now() + 120000) // 2 分鐘後過期
        });
        currentRoomId = docRef.id;
        myBattleRole = 'host';
        
        showToast('🔍 等待對手加入...', 'info');

        // 設定超時機制 (90 秒後自動取消)
        const matchTimeout = setTimeout(() => {
            if (currentRoomId && myBattleRole === 'host') {
                showToast('⏰ 配對超時，已取消', 'warning');
                leaveBattle(true);
            }
        }, 90000);
        
        // 監聽房間狀態 (等待對手加入)
        battleUnsub = onSnapshot(doc(db, "pvp_rooms", currentRoomId), (docSnap) => {
            if (!docSnap.exists()) {
                clearTimeout(matchTimeout);
                showToast('❌ 房間已關閉', 'error');
                leaveBattle(true);
                return;
            }
            
            const data = docSnap.data();
            console.log('[Host Waiting] Room Status:', data.status, 'Has Guest:', !!data.guest);
            
            // 檢查對手是否加入
            if (data.status === 'battle' && data.guest && data.guest.uid) {
                clearTimeout(matchTimeout);
                console.log('✅ 對手已加入，進入戰鬥！');
                showToast('⚔️ 對手已加入！', 'success');
                
                // 延遲一下再進入戰鬥介面，讓 Toast 顯示出來
                setTimeout(() => {
                    initBattleInterface();
                }, 500);
            }
        });

    } catch (error) {
        console.error("匹配失敗:", error);
        showToast('❌ 匹配失敗，請重試', 'error');
        leaveBattle(false);
    }
};

// [新增] 輔助：更新戰鬥卡牌 UI (動態生成卡牌 HTML)
// 取代 main.js 原本的 updateBattleCardUI 函式
function updateBattleCardUI(prefix, playerData) {
    if (!playerData) return;
    
    // 定義 ID 對應 (配合你的 HTML)
    const idPrefix = prefix === 'my' ? 'my' : 'enemy';
    
    const cardVisualEl = document.getElementById(`${idPrefix}-card-visual`);
    const hpBarEl = document.getElementById(`${idPrefix}-hp-bar`);
    const hpTextEl = document.getElementById(`${idPrefix}-hp-text`);
    const subIndicatorEl = document.getElementById(`${idPrefix}-sub-card-indicator`);

    if (!cardVisualEl || !hpBarEl) return; // 防止元素未找到導致報錯

    const activeKey = playerData.activeCard; // 'main' or 'sub'
    const activeCard = playerData.cards[activeKey];
    
    // 取得原始卡牌數據 (用於計算最大血量)
    const dbCard = CARD_DATABASE[activeCard.id];
    if (!dbCard) return;

    const maxHp = dbCard.hp;
    const currentHp = activeCard.currentHp;
    const hpPercent = Math.max(0, (currentHp / maxHp) * 100);

    // 1. 更新血條
    hpBarEl.style.width = `${hpPercent}%`;
    hpTextEl.innerText = `${currentHp}/${maxHp}`;

    // 2. 更新卡面視覺
    // 判斷是否為主卡，主卡顯示黃色字，副卡顯示灰色
    const nameColor = activeKey === 'main' ? 'text-yellow-400' : 'text-gray-300';
    const borderClass = activeKey === 'main' ? 'border-yellow-500' : 'border-gray-500';
    
    // 更新卡片容器的邊框顏色 (選擇上一層 container)
    const container = document.getElementById(`${idPrefix}-card-container`);
    if(container) {
        container.className = `relative w-32 h-44 bg-slate-800 rounded-lg border-2 ${borderClass} transition-all duration-500 mb-6`;
    }

    cardVisualEl.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full">
            <div class="text-[10px] uppercase tracking-widest text-gray-500 mb-1">${activeKey}</div>
            <div class="text-3xl mb-2">
                ${activeKey === 'main' ? '🐉' : '🛡️'}
            </div>
            <div class="${nameColor} font-bold text-sm text-center">${activeCard.name}</div>
            <div class="text-xs text-red-400 mt-1 font-mono">⚔️ ${activeCard.atk}</div>
            ${activeKey === 'main' ? `<div class="text-[9px] text-blue-300 mt-2 text-center px-1">${activeCard.skill}</div>` : ''}
        </div>
    `;

    // 3. 更新副卡指示燈 (透明度)
    // 如果現在是主卡且還有副卡，顯示副卡指示燈；如果現在已經是副卡了，指示燈改為激活狀態或隱藏
    if (subIndicatorEl) {
        if (activeKey === 'main' && playerData.cards.sub) {
            subIndicatorEl.style.opacity = '0.5'; // 待機中
            subIndicatorEl.innerHTML = '<span class="text-[8px] text-center block text-gray-400">Sub</span>';
        } else if (activeKey === 'sub') {
            subIndicatorEl.style.opacity = '1'; // 上場了 (或者可以選擇隱藏，因為卡片已經在中間了)
            subIndicatorEl.classList.add('border-green-500'); // 亮起
            subIndicatorEl.innerHTML = '<span class="text-[8px] text-center block text-green-400">Active</span>';
        } else {
            subIndicatorEl.style.opacity = '0.1'; // 無副卡或副卡已死
        }
    }
}
// [重寫] 處理對戰答題 (只記錄狀態與顯示解析，不直接扣血)
async function handleBattleAnswer(roomId, userIdx, correctIdx, isHost) {
    const isCorrect = userIdx === correctIdx;
    
    // 1. 震動回饋
    if (navigator.vibrate) navigator.vibrate(isCorrect ? 50 : 200);

    // 2. 鎖定按鈕 UI
    const btns = document.querySelectorAll('#battle-options button');
    btns.forEach((btn, idx) => {
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        if (idx === correctIdx) {
            btn.classList.remove('bg-slate-700');
            btn.classList.add('bg-green-600', 'border-green-400', 'text-white'); // 正確答案亮綠燈
        } else if (idx === userIdx && !isCorrect) {
            btn.classList.remove('bg-slate-700');
            btn.classList.add('bg-red-600', 'border-red-400', 'text-white'); // 選錯亮紅燈
        }
    });

    // 3. 顯示解析 UI
    const fbBox = document.getElementById('battle-feedback');
    const fbStatus = document.getElementById('battle-fb-status');
    const fbText = document.getElementById('battle-fb-text');
    
    // 取得目前暫存的題目解析 (需要確保 fetchOneQuestion 有存下來，或從 room 讀取)
    // 這裡我們假設 room.currentQuestion.exp 存在，這需要從 DOM 或全域變數獲取
    // 簡單解法：直接讀取 DOM 上的題目，或依賴 listenToBattleRoom 的全域變數
    // 為了穩健，我們從 DOM 讀取剛才渲染的解析文字 (如果有存) 或者顯示預設文字
    const currentExp = window.currentBattleExp || "AI 未提供解析"; 

    fbBox.classList.remove('hidden');
    if (isCorrect) {
        fbStatus.innerHTML = '<span class="text-green-400"><i class="fa-solid fa-check"></i> 回答正確！</span>';
    } else {
        fbStatus.innerHTML = '<span class="text-red-400"><i class="fa-solid fa-xmark"></i> 回答錯誤...</span>';
    }
    fbText.innerText = currentExp;

    // 顯示等待訊息
    document.getElementById('battle-waiting-msg').classList.remove('hidden');

    // 4. 更新資料庫 (只標記已完成與時間戳記)
    const roomRef = doc(db, "rooms", roomId);
    const meField = isHost ? "host" : "guest";

    try {
        await updateDoc(roomRef, {
            [`${meField}.done`]: true,
            [`${meField}.answerCorrect`]: isCorrect, // 記錄是否答對
            [`${meField}.answerTime`]: serverTimestamp() // 記錄伺服器時間 (用於判斷快慢)
        });
    } catch (e) {
        console.error("Answer upload failed", e);
    }
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
    if (!confirm(t('msg_buy_confirm', {price: price}))) return;

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


// 單抽
window.drawSingleCard = async () => {
    const COST = 100;
    if (currentUserData.stats.totalScore < COST) return alert("積分不足！");
    if (!confirm(`花費 ${COST} 積分進行單次召喚？`)) return;

    await executeDraw(1, COST);
};

// 11連抽 (保底)
window.draw11Cards = async () => {
    const COST = 1000;
    if (currentUserData.stats.totalScore < COST) return alert("積分不足！");
    if (!confirm(`花費 ${COST} 積分進行 11 連抽？\n(包含一張保底史詩以上)`)) return;

    await executeDraw(11, COST, "red"); // minRarity = red (史詩)
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

    } catch (e) {
        console.error(e);
        alert("召喚失敗，請稍後再試");
    } finally {
        if(btn) btn.disabled = false;
    }
}

// 顯示抽卡結果的簡易 Modal (需要你在 HTML 加一個 id="draw-result-modal")
function showDrawResults(results, totalRefund) {
    // 簡單版：用 alert 顯示
    let msg = `🎉 召喚完成！\n`;
    results.forEach(r => {
        msg += `[${RARITY_CONFIG[r.rarity].name}] ${r.name} -> ${r.refund > 0 ? '返還積分' : (r.msg.includes('強化') ? '強化 +5' : '獲得')}\n`;
    });
    if (totalRefund > 0) msg += `\n💰 總共返還：${totalRefund} 積分`;
    alert(msg);
}
