import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, query, orderBy, limit, getDocs, serverTimestamp, where, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
const RANKS = ["🥉 青銅", "🥈 白銀", "🥇 黃金", "💎 鉑金", "🔷 鑽石", "🌟 星耀"];

// 緩衝與狀態變數
let quizBuffer = [];
const BUFFER_SIZE = 1; 
let isFetchingBuffer = false; 
let battleUnsub = null; // 對戰監聽器
let currentBattleId = null;
let isBattleActive = false; // ⭐ 戰鬥鎖定狀態

// 綁定全域函式供 HTML onclick 使用
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

        const userRef = doc(db, "users", user.uid);
        try {
            const docSnap = await getDoc(userRef);
            
            // 1. 讀取或初始化使用者資料
            if (docSnap.exists()) {
                currentUserData = docSnap.data();
                if (!currentUserData.inventory) currentUserData.inventory = [];
                if (!currentUserData.equipped) currentUserData.equipped = { frame: '', avatar: '' };
            } else {
                // 如果是全新帳號，建立預設資料 (profile 留空)
                currentUserData = {
                    uid: user.uid, displayName: user.displayName, email: user.email,
                    profile: { educationLevel: "", strongSubjects: "", weakSubjects: "" }, // 這裡留空
                    inventory: [], // 擁有的物品 ID 列表
                    equipped: { frame: '', avatar: '' }, // 當前裝備
                    stats: { 
                        rankLevel: 0, currentStars: 0, totalScore: 0,
                        currentStreak: 0, bestStreak: 0, totalCorrect: 0, totalAnswered: 0
                    },
                    isAdmin: false
                };
                await setDoc(userRef, currentUserData);
            }

            // 2. 更新 UI 狀態
            updateUserAvatarDisplay();
            updateSettingsInputs();
            checkAdminRole(currentUserData.isAdmin);
            updateUIStats();

            // ⭐ 3. 關鍵修改：判斷是否為新帳號 (或未完成設定)
            // 如果 educationLevel 是空字串，代表還沒填過資料 -> 強制跳轉到引導頁
            if (!currentUserData.profile.educationLevel || currentUserData.profile.educationLevel === "") {
                switchToPage('page-onboarding'); 
                // 隱藏底部導航，避免使用者亂點跑走
                document.getElementById('bottom-nav').classList.add('hidden'); 
            } else {
                // 資料齊全，進入首頁
                switchToPage('page-home');
                fillBuffer(); 
            }

        } catch (error) { console.error(error); alert("資料讀取錯誤"); }
    } else {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('bottom-nav').classList.add('hidden');
    }
});

// ⭐ 頁面切換控制 (含鎖定邏輯)
window.switchToPage = (pageId) => {
    // 如果正在對戰中，禁止切換到其他頁面
    if (isBattleActive && pageId !== 'page-battle') {
        alert("⚔️ 戰鬥/配對中無法切換頁面！\n請先取消配對或完成對戰。");
        return;
    }

    document.querySelectorAll('.page-section').forEach(el => { el.classList.remove('active-page', 'hidden'); el.classList.add('hidden'); });
    const target = document.getElementById(pageId);
    if(target) { target.classList.remove('hidden'); target.classList.add('active-page'); }
    
    document.querySelectorAll('#nav-grid button').forEach(btn => {
        // 如果是鎖定狀態，讓導航看起來像失效 (UI Feedback)
        if(isBattleActive) {
            btn.classList.add('nav-locked');
        } else {
            btn.classList.remove('nav-locked');
        }

        if (btn.dataset.target === pageId) { btn.classList.add('text-white'); btn.classList.remove('text-gray-400'); } 
        else { btn.classList.remove('text-white'); btn.classList.add('text-gray-400'); }
    });
};

function updateUIStats() {
    if(!currentUserData) return;
    const stats = currentUserData.stats;
    if(typeof stats.currentStreak === 'undefined') stats.currentStreak = 0;
    if(typeof stats.bestStreak === 'undefined') stats.bestStreak = 0;
    if(typeof stats.totalCorrect === 'undefined') stats.totalCorrect = 0;
    if(typeof stats.totalAnswered === 'undefined') stats.totalAnswered = 0;

    document.getElementById('display-rank').innerText = RANKS[stats.rankLevel] || "未知";
    document.getElementById('display-stars').innerText = stats.currentStars;
    document.getElementById('display-score').innerText = stats.totalScore;
    document.getElementById('display-streak').innerText = stats.currentStreak;
    document.getElementById('display-best-streak').innerText = stats.bestStreak;
    
    const accuracy = stats.totalAnswered > 0 ? ((stats.totalCorrect / stats.totalAnswered) * 100).toFixed(1) : "0.0";
    document.getElementById('display-accuracy').innerText = accuracy + "%";
    setTimeout(() => { document.getElementById('progress-bar').style.width = `${(stats.currentStars / 10) * 100}%`; }, 100);
}

// ==========================================
//  雙人對戰系統 (PvP System)
// ==========================================

window.startBattleMatchmaking = async () => {
    // ⭐ 啟動鎖定
    isBattleActive = true;
    switchToPage('page-battle'); // 切換到對戰頁，同時觸發 UI 鎖定效果

    document.getElementById('battle-lobby').classList.remove('hidden');
    document.getElementById('battle-arena').classList.add('hidden');
    document.getElementById('battle-status-text').innerText = "正在搜尋合適對手...";

    const q = query(collection(db, "rooms"), where("status", "==", "waiting"), limit(1));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
        const roomDoc = snapshot.docs[0];
        currentBattleId = roomDoc.id;
        await updateDoc(doc(db, "rooms", currentBattleId), {
            guest: { uid: auth.currentUser.uid, name: currentUserData.displayName, score: 0, done: false },
            status: "ready"
        });
    } else {
        const roomRef = await addDoc(collection(db, "rooms"), {
            host: { uid: auth.currentUser.uid, name: currentUserData.displayName, score: 0, done: false },
            guest: null,
            status: "waiting",
            round: 1,
            createdAt: serverTimestamp()
        });
        currentBattleId = roomRef.id;
    }

    listenToBattleRoom(currentBattleId);
};

function listenToBattleRoom(roomId) {
    if (battleUnsub) battleUnsub();

    battleUnsub = onSnapshot(doc(db, "rooms", roomId), async (docSnap) => {
        if (!docSnap.exists()) return;
        const room = docSnap.data();
        const isHost = room.host.uid === auth.currentUser.uid;

        if (room.status === "ready") {
            document.getElementById('battle-lobby').classList.add('hidden');
            document.getElementById('battle-arena').classList.remove('hidden');
            
            document.getElementById('p1-score').innerText = isHost ? room.host.score : room.guest.score;
            document.getElementById('p2-score').innerText = isHost ? room.guest.score : room.host.score;
            document.getElementById('battle-round').innerText = room.round;

            if (!room.currentQuestion && isHost) {
                generateSharedQuiz(roomId);
            }
            
            if (room.currentQuestion) {
                document.getElementById('battle-loading').classList.add('hidden');
                document.getElementById('battle-quiz-box').classList.remove('hidden');
                document.getElementById('battle-q-text').innerText = room.currentQuestion.q;
                
                const container = document.getElementById('battle-options');
                container.innerHTML = '';
                
                const myData = isHost ? room.host : room.guest;
                
                if (!myData.done) {
                    document.getElementById('battle-waiting-msg').classList.add('hidden');
                    room.currentQuestion.opts.forEach((opt, idx) => {
                        const btn = document.createElement('button');
                        btn.className = "w-full text-left p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition border border-slate-600";
                        btn.innerText = opt;
                        btn.onclick = () => handleBattleAnswer(roomId, idx, room.currentQuestion.ans, isHost);
                        container.appendChild(btn);
                    });
                } else {
                    container.innerHTML = '<div class="text-center text-gray-500 italic">已提交，等待對手...</div>';
                    document.getElementById('battle-waiting-msg').classList.remove('hidden');
                }
            } else {
                document.getElementById('battle-loading').classList.remove('hidden');
                document.getElementById('battle-quiz-box').classList.add('hidden');
            }

            if (room.host.done && room.guest.done) {
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
            
            const myScore = isHost ? room.host.score : room.guest.score;
            const oppScore = isHost ? room.guest.score : room.host.score;
            
            if (myScore > oppScore) {
                document.getElementById('battle-result-title').innerText = "🎉 勝利！";
                document.getElementById('battle-result-title').className = "text-3xl font-bold mb-2 text-green-400";
                document.getElementById('battle-result-msg').innerText = `你以 ${myScore} : ${oppScore} 擊敗對手！`;
            } else if (myScore < oppScore) {
                document.getElementById('battle-result-title').innerText = "💔 惜敗...";
                document.getElementById('battle-result-title').className = "text-3xl font-bold mb-2 text-red-400";
                document.getElementById('battle-result-msg').innerText = `對手以 ${oppScore} : ${myScore} 獲勝`;
            } else {
                document.getElementById('battle-result-title').innerText = "🤝 平手";
                document.getElementById('battle-result-title').className = "text-3xl font-bold mb-2 text-yellow-400";
                document.getElementById('battle-result-msg').innerText = `雙方 ${myScore} : ${oppScore} 平分秋色`;
            }
        }
    });
}

async function generateSharedQuiz(roomId) {
    try {
        const q = await fetchOneQuestion(); 
        await updateDoc(doc(db, "rooms", roomId), {
            currentQuestion: {
                q: q.data.q,
                opts: q.data.opts,
                ans: q.data.ans
            }
        });
    } catch (e) {
        console.error("Host failed to generate question", e);
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

window.leaveBattle = () => {
    if (battleUnsub) battleUnsub();
    // ⭐ 解除鎖定
    isBattleActive = false;
    // 清除一些臨時變數或UI狀態
    currentBattleId = null;
    
    switchToPage('page-home'); // 解鎖後才能切換
};

// ==========================================
//  一般單人功能
// ==========================================

function updateSettingsInputs() {
    if (currentUserData && currentUserData.profile) {
        document.getElementById('set-level').value = currentUserData.profile.educationLevel || "國中一年級";
        document.getElementById('set-strong').value = currentUserData.profile.strongSubjects || "";
        document.getElementById('set-weak').value = currentUserData.profile.weakSubjects || "";
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
    } catch (e) {
        return rawText; 
    }
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
        // ...
    });
    
    // 更新本地暫存
    currentUserData.profile.educationLevel = level; 
    currentUserData.profile.strongSubjects = cleanStrong; 
    currentUserData.profile.weakSubjects = cleanWeak;
    
    updateSettingsInputs(); 
    updateUIStats(); 

    // ⭐ 提交成功後的動作：
    switchToPage('page-home');          // 1. 轉跳回首頁
    document.getElementById('bottom-nav').classList.remove('hidden'); // 2. 顯示底部導航列 (因為剛剛被隱藏了)
    
    localStorage.removeItem('currentQuiz'); 
    quizBuffer = []; 
    fillBuffer(); // 3. 開始背景載入題目
    btn.innerText = "開始旅程 🚀"; btn.disabled = false;
};

window.saveProfile = async () => {
    const level = document.getElementById('set-level').value;
    const rawStrong = document.getElementById('set-strong').value;
    const rawWeak = document.getElementById('set-weak').value;
    const btn = document.querySelector('button[onclick="saveProfile()"]');
    btn.innerText = "AI 優化中..."; btn.disabled = true;
    const cleanStrong = await getCleanSubjects(rawStrong);
    const cleanWeak = await getCleanSubjects(rawWeak);
    document.getElementById('set-strong').value = cleanStrong;
    document.getElementById('set-weak').value = cleanWeak;
    await updateDoc(doc(db, "users", auth.currentUser.uid), { "profile.educationLevel": level, "profile.strongSubjects": cleanStrong, "profile.weakSubjects": cleanWeak });
    currentUserData.profile.educationLevel = level; currentUserData.profile.strongSubjects = cleanStrong; currentUserData.profile.weakSubjects = cleanWeak;
    btn.innerText = "儲存成功！"; setTimeout(() => { btn.innerText = "更新設定"; btn.disabled = false; }, 2000);
    localStorage.removeItem('currentQuiz'); quizBuffer = []; fillBuffer();
};

function checkAdminRole(isAdmin) {
    const navGrid = document.getElementById('nav-grid');
    if (isAdmin && !document.getElementById('btn-admin-nav')) {
        navGrid.classList.remove('grid-cols-5'); navGrid.classList.add('grid-cols-6');
        const btn = document.createElement('button');
        btn.id = "btn-admin-nav"; btn.dataset.target = "page-admin";
        btn.className = "flex flex-col items-center justify-center hover:bg-white/5 text-gray-400 hover:text-red-400 transition group";
        btn.onclick = () => { loadAdminLogs(); switchToPage('page-admin'); };
        btn.innerHTML = `<i class="fa-solid fa-user-shield mb-1 text-lg group-hover:text-red-400 transition-colors"></i><span class="text-[10px]">管理</span>`;
        navGrid.appendChild(btn);
    }
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function fetchOneQuestion() {
    const BACKEND_URL = "/api/generate-quiz";
    const rankName = RANKS[currentUserData.stats.rankLevel];
    const level = currentUserData.profile.educationLevel || "一般";
    let rawWeakString = currentUserData.profile.weakSubjects || "";
    let targetSubject = "";
    let subjectsArray = rawWeakString.split(/[,，\s]+/).filter(s => s.trim().length > 0);
    if (subjectsArray.length > 0) { targetSubject = subjectsArray[Math.floor(Math.random() * subjectsArray.length)]; } 
    else { const generalTopics = ["台灣歷史", "世界地理", "生活科學", "邏輯推理", "國語文常識", "科技新知", "動漫與遊戲", "環境保育"]; targetSubject = generalTopics[Math.floor(Math.random() * generalTopics.length)]; }
    
    const response = await fetch(BACKEND_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: targetSubject, level: level, rank: rankName })
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
        badge: `🎯 專項特訓: ${targetSubject}`
    };
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
    // 檢查點：確保在本地測試或生產環境皆可運作
    const BACKEND_URL = "/api/generate-quiz"; 
    
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
            if (stats.rankLevel < RANKS.length - 1) { stats.rankLevel++; stats.currentStars = 0; fbTitle.innerText += ` (晉升 ${RANKS[stats.rankLevel]}!)`; } 
            else { stats.currentStars = 10; }
        }
    } else {
        stats.currentStreak = 0; stats.currentStars--;
        if (stats.currentStars < 0) {
            if (stats.rankLevel > 0) { stats.rankLevel--; stats.currentStars = 8; fbTitle.innerText += ` (降級...)`; } 
            else { stats.currentStars = 0; }
        }
    }
    updateDoc(doc(db, "users", auth.currentUser.uid), { stats: stats });
    addDoc(collection(db, "exam_logs"), { uid: auth.currentUser.uid, email: auth.currentUser.email, question: questionText, isCorrect: isCorrect, rankAtTime: RANKS[stats.rankLevel], timestamp: serverTimestamp() }).catch(e => console.error(e));
    updateUIStats(); fillBuffer();
}

window.giveUpQuiz = () => { if(confirm("確定要放棄這題嗎？")) handleAnswer(-1, -2, document.getElementById('question-text').innerText, "您選擇了放棄此題。"); };
window.nextQuestion = () => { startQuizFlow(); };
window.loadUserHistory = async () => {
    const ul = document.getElementById('history-list');
    ul.innerHTML = '<li class="text-center py-10"><div class="loader"></div></li>';
    try {
        const q = query(collection(db, "exam_logs"), where("uid", "==", auth.currentUser.uid), orderBy("timestamp", "desc"), limit(20));
        const snap = await getDocs(q);
        ul.innerHTML = '';
        if (snap.empty) { ul.innerHTML = '<li class="text-center text-gray-500 py-10">還沒有答題紀錄，快去挑戰吧！</li>'; return; }
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
        const q = query(collection(db, "users"), orderBy("stats.totalScore", "desc"), limit(10));
        const snap = await getDocs(q);
        tbody.innerHTML = '';
        let i = 1;
        snap.forEach(doc => {
            const d = doc.data();
            const isMe = auth.currentUser && d.uid === auth.currentUser.uid;
            const row = `<tr class="border-b border-slate-700/50 ${isMe ? 'bg-blue-900/20' : ''} hover:bg-slate-700/50 transition"><td class="px-4 py-4 font-bold ${i===1?'text-yellow-400':(i===2?'text-gray-300':(i===3?'text-orange-400':'text-gray-500'))}">${i}</td><td class="px-4 py-4 flex items-center gap-2"><div class="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-xs text-gray-400"><i class="fa-solid fa-user"></i></div><span class="${isMe ? 'text-blue-300 font-bold' : ''}">${d.displayName}</span></td><td class="px-4 py-4 text-right font-mono text-blue-300">${RANKS[d.stats.rankLevel] || "青銅"} <span class="text-xs text-gray-500 block">${d.stats.totalScore} pts</span></td></tr>`;
            tbody.innerHTML += row; i++;
        });
    } catch (e) { console.error(e); tbody.innerHTML = '<tr><td colspan="3" class="p-4 text-red-400 text-center">無法讀取排行榜</td></tr>'; }
};

// ==========================================
//  商店、庫存與管理系統 (Enhanced Store System)
// ==========================================

// --- [核心工具] 渲染視覺效果 (重要：處理圖片路徑) ---
function renderVisual(type, value, sizeClass = "w-12 h-12") {
    if (type === 'frame') {
        // 相框：使用 CSS Class (value = frame-gold)
        // 內部的 icon 是預設頭像佔位符
        return `<div class="${sizeClass} rounded-full border-2 border-gray-600 ${value} flex items-center justify-center bg-slate-800 relative z-0"><i class="fa-solid fa-user text-gray-500"></i></div>`;
    } else if (type === 'avatar') {
        // 頭像：使用圖片路徑 (value = avatar1.png)
        // 假設圖片都放在 public 根目錄，若有資料夾請自行加前綴 (e.g., /images/${value})
        // 增加 onerror 處理，若圖檔找不到顯示預設 icon
        return `<div class="${sizeClass} rounded-full overflow-hidden bg-slate-800 border-2 border-slate-600 relative z-10">
                    <img src="${value}" class="avatar-img" onerror="this.style.display='none';this.parentElement.innerHTML='<i class=\'fa-solid fa-image text-red-500\'></i>'">
                </div>`;
    }
    return '';
}

// 1. 管理員：載入商品列表與表單邏輯
window.loadAdminData = async () => {
    // 同時載入 Log 和 商品
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
            // 點擊列表項目 -> 進入編輯模式
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



// 4. 管理員：提交 (新增或更新)
window.handleProductSubmit = async () => {
    if (!currentUserData.isAdmin) return alert("權限不足");

    const id = document.getElementById('admin-p-id').value;
    const name = document.getElementById('admin-p-name').value;
    const type = document.getElementById('admin-p-type').value;
    const value = document.getElementById('admin-p-value').value;
    const price = parseInt(document.getElementById('admin-p-price').value);

    if (!name || !value || !price) return alert("請填寫完整資訊");

    const productData = { name, type, value, price, updatedAt: serverTimestamp() };

    try {
        if (id) {
            // 更新模式
            await updateDoc(doc(db, "products", id), productData);
            alert(`商品「${name}」更新成功！`);
        } else {
            // 新增模式
            productData.createdAt = serverTimestamp();
            await addDoc(collection(db, "products"), productData);
            alert(`商品「${name}」上架成功！`);
        }
        resetAdminForm();
        loadAdminData(); // 重新整理列表
    } catch (e) {
        console.error(e);
        alert("操作失敗: " + e.message);
    }
};

// 輔助：更新 Input Placeholder
window.updateValuePlaceholder = () => {
    const type = document.getElementById('admin-p-type').value;
    const label = document.getElementById('admin-value-label');
    const input = document.getElementById('admin-p-value');
    
    if (type === 'frame') {
        label.innerText = "CSS 類名 (從 style.css 定義)";
        input.placeholder = "例: frame-gold, frame-fire";
    } else {
        label.innerText = "圖片檔名 (需放在 public 資料夾)";
        input.placeholder = "例: avatar1.png, hero.jpg";
    }
};

// 5. 設定頁面：載入背包 (Inventory)
window.renderInventory = async (filterType = 'frame') => {
    const container = document.getElementById('inventory-display');
    const userInv = currentUserData.inventory || [];
    
    container.innerHTML = '<div class="col-span-4 text-center text-gray-500 py-4"><div class="loader"></div></div>';

    // 如果背包是空的
    if (userInv.length === 0) {
        container.innerHTML = '<div class="col-span-4 text-center text-gray-500 py-4 text-xs">背包空空的，去商店逛逛吧！</div>';
        return;
    }

    // 抓取所有商品資料來比對 (這裡可以優化，例如用 cache，但目前量少直接抓)
    const q = query(collection(db, "products"));
    const snap = await getDocs(q);
    const allProducts = {};
    snap.forEach(d => allProducts[d.id] = d.data());

    container.innerHTML = '';
    let count = 0;

    userInv.forEach(pid => {
        const item = allProducts[pid];
        if (!item) return; // 商品可能被刪除了
        if (item.type !== filterType) return; // 篩選類型

        const isEquipped = (currentUserData.equipped[filterType] === item.value);
        
        const div = document.createElement('div');
        div.className = `inventory-item ${isEquipped ? 'selected' : ''}`;
        div.onclick = () => equipItem(item.type, pid, item.value); // 點擊直接裝備
        
        // 裝備中標記
        const badge = isEquipped ? '<div class="absolute top-0 right-0 bg-green-500 text-[10px] px-1 rounded-bl">E</div>' : '';

        div.innerHTML = `
            ${renderVisual(item.type, item.value, "w-10 h-10")}
            ${badge}
        `;
        container.appendChild(div);
        count++;
    });

    if (count === 0) {
        container.innerHTML = `<div class="col-span-4 text-center text-gray-500 py-4 text-xs">沒有擁有的${filterType === 'frame' ? '相框' : '頭像'}</div>`;
    }
};

// 6. 載入商店 (更新版：使用 renderVisual)
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
            
            // 使用共用的 renderVisual
            let visual = renderVisual(item.type, item.value, "w-14 h-14");

            let btnAction = '';
            if (isEquipped) {
                btnAction = `<button class="w-full mt-2 bg-green-600 text-white text-xs py-1.5 rounded cursor-default opacity-50">已裝備</button>`;
            } else if (isOwned) {
                // 已擁有 -> 顯示裝備按鈕
                btnAction = `<button onclick="equipItem('${item.type}', '${pid}', '${item.value}')" class="w-full mt-2 bg-slate-600 hover:bg-slate-500 text-white text-xs py-1.5 rounded">裝備</button>`;
            } else {
                // 未擁有 -> 顯示購買按鈕
                btnAction = `<button onclick="buyItem('${pid}', ${item.price})" class="w-full mt-2 bg-blue-600 hover:bg-blue-500 text-white text-xs py-1.5 rounded flex items-center justify-center gap-1"><i class="fa-solid fa-coins text-yellow-300"></i> ${item.price}</button>`;
            }

            const card = document.createElement('div');
            card.className = `store-card ${item.type}-item`;
            card.innerHTML = `
                ${visual}
                <div class="text-sm font-bold text-white mt-2">${item.name}</div>
                <div class="text-xs text-gray-400 mb-1">${item.type === 'frame' ? '相框' : '頭像'}</div>
                ${btnAction}
            `;
            grid.appendChild(card);
        });
    } catch (e) { console.error(e); }
};

// 7. 更新用戶頭像顯示 (更新版：支援圖片)
window.updateUserAvatarDisplay = () => {
    if (!currentUserData) return;
    
    // 1. 處理首頁大頭貼 (Home Page)
    let homeAvatarContainer = document.getElementById('home-avatar-container');
    if (!homeAvatarContainer) {
        const homeSection = document.querySelector('#page-home > div'); 
        const avatarDiv = document.createElement('div');
        avatarDiv.id = 'home-avatar-container';
        avatarDiv.className = 'absolute top-4 left-4';
        homeSection.appendChild(avatarDiv);
        homeAvatarContainer = avatarDiv;
    }

    // 根據是否有裝備頭像來決定內容
    let avatarContent = '<i class="fa-solid fa-user text-2xl text-gray-400"></i>';
    if (currentUserData.equipped.avatar) {
        avatarContent = `<img src="${currentUserData.equipped.avatar}" class="w-full h-full object-cover rounded-full" onerror="this.src='';this.nextElementSibling.style.display='block'">`;
    }

    // 組合框與圖
    // 注意：相框是外層 div 的 class，頭像圖片是內部的 img
    homeAvatarContainer.innerHTML = `
        <div class="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center border-2 border-slate-600 relative ${currentUserData.equipped.frame || ''}">
            ${currentUserData.equipped.avatar ? 
                `<img src="${currentUserData.equipped.avatar}" class="w-full h-full rounded-full object-cover p-[2px]">` : 
                `<i class="fa-solid fa-user text-2xl text-gray-400"></i>`
            }
        </div>
    `;
};

// ... (保留 buyItem, equipItem 等邏輯，但記得 equipItem 最後要呼叫 renderInventory 以更新 UI) ...

window.equipItem = async (type, pid, value) => {
    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        if (type === 'frame') currentUserData.equipped.frame = value;
        if (type === 'avatar') currentUserData.equipped.avatar = value;

        await updateDoc(userRef, { "equipped": currentUserData.equipped });

        updateUserAvatarDisplay();
        loadStoreItems(); // 如果在商店頁，更新按鈕狀態
        renderInventory(type); // 如果在設定頁，更新選取狀態
    } catch (e) {
        console.error(e);
        alert("裝備失敗");
    }
};

// ==========================================
//  商店篩選與 UI 切換邏輯 (補上遺失的部分)
// ==========================================

window.filterStore = (type, btnElement) => {
    // 1. 篩選商品顯示 (DOM 操作)
    const items = document.querySelectorAll('.store-card');
    items.forEach(item => {
        if (type === 'all') {
            item.classList.remove('hidden');
        } else {
            // 檢查卡片是否有對應的 class (frame-item 或 avatar-item)
            if (item.classList.contains(`${type}-item`)) {
                item.classList.remove('hidden');
            } else {
                item.classList.add('hidden');
            }
        }
    });

    // 2. 切換按鈕樣式 (Highlight Active Tab)
    // 如果是透過點擊按鈕觸發的 (btnElement 存在)
    if (btnElement) {
        // 重置所有 Tab 樣式為「未選取狀態」 (灰色)
        document.querySelectorAll('.store-tab').forEach(tab => {
            tab.className = 'store-tab flex-1 py-2 text-xs font-bold rounded-lg transition-all bg-slate-800 text-gray-400 hover:bg-slate-700';
            // 移除 icon 的實心效果 (選用)
            const icon = tab.querySelector('i');
            if(icon) icon.classList.replace('fa-solid', 'fa-regular');
        });
        
        // 設定當前被點擊的 Tab 為「啟用樣式」 (粉紅色 + 發光)
        btnElement.className = 'store-tab active-tab flex-1 py-2 text-xs font-bold rounded-lg transition-all bg-pink-600 text-white shadow-lg shadow-pink-900/50';
        
        // 讓 icon 變實心 (選用)
        const activeIcon = btnElement.querySelector('i');
        if(activeIcon) activeIcon.classList.replace('fa-regular', 'fa-solid');
    }
};

// ⭐ 重要：修改 switchToPage，當切換到設定頁或管理頁時自動載入資料
const originalSwitchToPage = window.switchToPage;
window.switchToPage = (pageId) => {
    originalSwitchToPage(pageId); // 呼叫原本的切換邏輯
    
    if (pageId === 'page-settings') {
        renderInventory('frame'); // 預設載入相框背包
    }
    if (pageId === 'page-admin') {
        loadAdminData(); // 載入商品列表
    }
};
