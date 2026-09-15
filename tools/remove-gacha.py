from pathlib import Path
import re

# One-time migration helper for the 修仙世界 branch.
p = Path('public/main-legacy.js')
s = p.read_text(encoding='utf-8')

# Remove card/gacha translation keys and UI-only strings.
for pattern in [
    r'\n\s*tab_cards:\s*"卡牌", // 導航欄用到',
    r'\n\s*tab_cards:\s*"Cards",',
    r'\n\s*btn_draw:\s*"召喚 \(500分\)",',
    r'\n\s*msg_no_cards:\s*"你還沒有卡牌，快去召喚！",',
    r'\n\s*btn_draw:\s*"Summon \(500pts\)",',
    r'\n\s*msg_no_cards:\s*"No cards yet\. Summon now!",',
]:
    s = re.sub(pattern, '', s)

# Remove card database, rarity, traits, image helpers and battle-card factory.
s = re.sub(r'// ==========================================\n// 0\. 卡牌資料庫與稀有度設定.*?(?=// ==========================================\n// 🌍 國際化)', '', s, flags=re.S)
s = re.sub(r'// ==========================================\n// 0\. 卡牌資料庫 \(數值平衡調整版\).*?(?=// ==========================================\n//  Social & UI Injection)', '', s, flags=re.S)

# Remove inventory/card UI functions.
s = re.sub(r'window\.loadMyCards\s*=\s*\(\)\s*=>\s*\{.*?\n\};\n\n', '', s, flags=re.S)
s = re.sub(r'// \[新增\] 開啟選擇卡牌 Modal.*?async function setDeckCard\(cardId\)\s*\{.*?\n\}\n\n', '', s, flags=re.S)
s = re.sub(r'// \[新增\] 更新主畫面上的牌組顯示區塊.*?\n\}\n// ==========================================\n//  Social & UI Injection', '// ==========================================\n//  Social & UI Injection', s, flags=re.S)

# Remove all actual gacha/summon/upgrade/refund code and animation UI.
s = re.sub(r'// ==========================================\n// 核心：抽卡與合成系統.*?(?=// ==========================================\n//  🚀 隨機邀請系統)', '', s, flags=re.S)
s = re.sub(r'window\.drawSingleCard\s*=\s*async \(\)\s*=>\s*\{.*?\n\};\n\n// 11連抽.*?\n\};\n\n// 通用執行抽卡邏輯.*?\n\}\n\n// ==========================================\n// 🎨 新版抽卡動畫系統.*?(?=window\.addEventListener)', '', s, flags=re.S)

# Remove residual calls to card UI functions and page entry points.
s = re.sub(r'\s*updateDeckDisplay\(\);', '', s)
s = re.sub(r'\s*updateHomeBestCard\(\);', '', s)
s = re.sub(r'\s*loadMyCards\(\);', '', s)
s = re.sub(r'\n\s*if \(pageId === [\'\"]page-cards[\'\"]\) \{.*?\n\s*\}', '', s, flags=re.S)

# Remove card fields from user migration/defaults.
s = re.sub(r'\s*if \(!currentUserData\.cards \|\| currentUserData\.cards\.length === 0\) \{.*?\n\s*\}', '', s, flags=re.S)
s = re.sub(r'\s*cards:\s*\["c001",\s*"c002"\],\s*\n\s*deck:\s*\{\s*main:\s*"c001",\s*sub:\s*"c002"\s*\},', '', s)
s = re.sub(r'\s*cardLevels:\s*\{\},', '', s)

# Replace both card-dependent matchmaking payloads with a simple combat profile.
battle_obj = '''{\n        uid: auth.currentUser.uid,\n        name: currentUserData.displayName || "Player",\n        equipped: currentUserData.equipped || { frame: '', avatar: '' },\n        rankLevel: currentUserData.stats?.rankLevel || 0,\n        done: false,\n        answerCorrect: null,\n        answerTime: null,\n        isDead: false,\n        hp: 100,\n        maxHp: 100,\n        atk: 20\n    }'''
s = re.sub(r'const myBattleData = \{\s*uid: auth\.currentUser\.uid,.*?\n\s*\};', 'const myBattleData = ' + battle_obj + ';', s, count=2, flags=re.S)

# Remove card-specific matchmaking guards.
s = re.sub(r'\s*if \(!currentUserData\.deck\?\.main\) \{.*?\}', '', s, count=2, flags=re.S)

# Rewrite battle participant rendering without cards/rarity.
start = s.find('// [修正版] 更新戰鬥卡牌 UI')
end = s.find('// 觸發打擊動畫', start)
if start != -1 and end != -1:
    generic_ui = '''// Card-free battle participant UI.\nfunction updateBattleCardUI(prefix, playerData) {\n    if (!playerData) return;\n    const idPrefix = prefix === 'my' ? 'my' : 'enemy';\n    const container = document.getElementById(`${idPrefix}-card-container`);\n    const miniVisualEl = document.getElementById(`${idPrefix}-card-visual`);\n    const hpBarEl = document.getElementById(`${idPrefix}-hp-bar`);\n    const hpTextEl = document.getElementById(`${idPrefix}-hp-text`);\n    const subIndicatorEl = document.getElementById(`${idPrefix}-sub-card-indicator`);\n    if (!container || !hpBarEl) return;\n    const maxHp = Number(playerData.maxHp || 100);\n    const currentHp = Math.max(0, Number(playerData.hp ?? maxHp));\n    const hpPercent = Math.max(0, Math.min(100, (currentHp / maxHp) * 100));\n    hpBarEl.style.width = `${hpPercent}%`;\n    if (hpTextEl) hpTextEl.innerText = `${currentHp}/${maxHp}`;\n    container.className = `relative w-32 h-48 bg-slate-800 rounded-lg border-2 ${prefix === 'my' ? 'border-cyan-500' : 'border-red-500'} transition-all duration-500 mb-6 overflow-hidden shadow-2xl`;\n    container.innerHTML = `\n        <div class="absolute inset-0 flex flex-col items-center justify-center p-3 text-center">\n            <div class="text-4xl mb-3">${prefix === 'my' ? '⚔️' : '👹'}</div>\n            <div class="font-bold text-sm ${prefix === 'my' ? 'text-cyan-300' : 'text-red-300'}">${playerData.name || 'Player'}</div>\n            <div class="text-xs text-green-400 font-mono mt-2">HP ${currentHp}</div>\n            <div class="text-xs text-red-300 font-mono">ATK ${Number(playerData.atk || 20)}</div>\n        </div>`;\n    if (miniVisualEl) miniVisualEl.innerHTML = prefix === 'my' ? '⚔️' : '👹';\n    if (subIndicatorEl) { subIndicatorEl.innerHTML = ''; subIndicatorEl.style.opacity = '0'; }\n}\n'''
    s = s[:start] + generic_ui + s[end:]

# Rewrite round resolution to use only hp/atk and answer correctness.
start = s.find('// [修正版] 回合結算邏輯')
end = s.find('// 輔助函式：處理勝利結算', start)
if start != -1 and end != -1:
    generic_resolve = '''// Card-free round resolution.\nasync function resolveRoundLogic(roomId, room) {\n    const host = room.host;\n    const guest = room.guest;\n    const tHost = host.answerTime ? host.answerTime.toMillis() : Date.now() + 999999;\n    const tGuest = guest.answerTime ? guest.answerTime.toMillis() : Date.now() + 999999;\n    let turnOrder;\n    if (host.answerCorrect && !guest.answerCorrect) turnOrder = ['host', 'guest'];\n    else if (!host.answerCorrect && guest.answerCorrect) turnOrder = ['guest', 'host'];\n    else turnOrder = tHost < tGuest ? ['host', 'guest'] : ['guest', 'host'];\n    const roomRef = doc(db, "rooms", roomId);\n    await runTransaction(db, async (transaction) => {\n        const freshDoc = await transaction.get(roomRef);\n        if (!freshDoc.exists()) return;\n        const freshRoom = freshDoc.data();\n        let h = { ...freshRoom.host };\n        let g = { ...freshRoom.guest };\n        h.maxHp = Number(h.maxHp || 100); h.hp = Number(h.hp ?? h.maxHp); h.atk = Number(h.atk || 20);\n        g.maxHp = Number(g.maxHp || 100); g.hp = Number(g.hp ?? g.maxHp); g.atk = Number(g.atk || 20);\n        const battleLog = [];\n        for (const attackerRole of turnOrder) {\n            const attacker = attackerRole === 'host' ? h : g;\n            const defender = attackerRole === 'host' ? g : h;\n            if (defender.hp <= 0 || attacker.hp <= 0) continue;\n            if (attacker.answerCorrect) {\n                const damage = Math.max(1, attacker.atk);\n                defender.hp = Math.max(0, defender.hp - damage);\n                if (defender.hp === 0) defender.isDead = true;\n                battleLog.push({ attacker: attackerRole, isHit: true, dmg: damage, skill: '答題攻擊', healed: null });\n            } else {\n                battleLog.push({ attacker: attackerRole, isHit: false, dmg: 0, skill: 'MISS', healed: null });\n            }\n        }\n        let status = 'ready';\n        let winnerUid = null;\n        if (h.isDead || g.isDead || freshRoom.round >= 10) {\n            status = 'finished';\n            if (h.hp > g.hp) winnerUid = h.uid;\n            else if (g.hp > h.hp) winnerUid = g.uid;\n        }\n        transaction.update(roomRef, {\n            host: h, guest: g, round: status === 'finished' ? freshRoom.round : freshRoom.round + 1,\n            battleLog, battleLogId: Date.now().toString(), status, winner: winnerUid,\n            'host.done': false, 'guest.done': false,\n            'host.answerCorrect': null, 'guest.answerCorrect': null,\n            'host.answerTime': null, 'guest.answerTime': null\n        });\n    });\n}\n'''
    s = s[:start] + generic_resolve + s[end:]

# Replace battle rewards with score-only reward.
start = s.find('// 輔助函式：處理勝利結算')
end = s.find('// [修改] 處理對戰答題', start)
if start != -1 and end != -1:
    reward = '''// Battle victory reward (card-free).\nasync function processBattleWin(loserData, msgEl) {\n    try {\n        const userRef = doc(db, "users", auth.currentUser.uid);\n        currentUserData.stats.totalScore += 500;\n        currentUserData.stats.totalCorrect += 5;\n        const currentNetScore = getNetScore(currentUserData.stats);\n        const newRank = calculateRankFromScore(currentNetScore);\n        await updateDoc(userRef, {\n            "stats.totalScore": currentUserData.stats.totalScore,\n            "stats.totalCorrect": currentUserData.stats.totalCorrect,\n            "stats.rankLevel": newRank\n        });\n        currentUserData.stats.rankLevel = newRank;\n        msgEl.innerHTML = `獲得獎勵：<br>🏆 500 積分`;\n        updateUIStats();\n    } catch (e) {\n        console.error("Reward failed", e);\n        msgEl.innerText = "結算發生錯誤，請聯繫管理員";\n    }\n}\n'''
    s = s[:start] + reward + s[end:]

# Remove any residual card-specific syntax left by the migration.
s = re.sub(r'\s*cards:\s*\{.*?\}', '', s, flags=re.S)
s = re.sub(r'\s*activeCard:\s*"main",', '', s)
s = re.sub(r'\s*getBattleCardData\([^)]*\)', 'null', s)
s = re.sub(r'\s*arrayUnion\(\.\.\.lootIds\)', '', s)

p.write_text(s, encoding='utf-8')
print('cleaned', p)
