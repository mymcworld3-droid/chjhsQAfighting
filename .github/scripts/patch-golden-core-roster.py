from pathlib import Path
import re

training = Path('public/cultivation/cultivation-training-v4.js')
text = training.read_text()

if 'function breakthroughPercent(grade)' not in text:
    marker = """  function randomPercent(chance) {\n    return Math.random() * 100 < chance;\n  }\n"""
    helper = marker + """\n  function breakthroughPercent(grade) {\n    return 20 + (9 - clampGrade(grade)) * 5;\n  }\n\n  function inBreakthroughZone(score, grade) {\n    const value = Math.max(0, Number(score) || 0);\n    const thresholds = [GOLDEN_CORE_SCORE, ...REALM_THRESHOLDS];\n    const next = thresholds.find((need) => need > value);\n    if (!next) return false;\n\n    let previous = GOLDEN_CORE_SCORE;\n    for (const need of thresholds) {\n      if (need <= value) previous = need;\n      else break;\n    }\n\n    const span = Math.max(1, next - previous);\n    const range = span * (breakthroughPercent(grade) / 100);\n    return next - value <= range;\n  }\n"""
    if marker not in text:
        raise SystemExit('randomPercent marker not found')
    text = text.replace(marker, helper, 1)

new_core_types = r'''  const CORE_TYPES = [
    {
      id: 'ocean', name: '大海無垠丹', icon: '≈', tone: 'ocean',
      effect(grade) {
        const chance = chanceByGrade(grade, 10, 5, 50);
        return `獲得修為時有 ${chance}% 機率使本次基礎修為翻倍；鬥法攻擊時有 ${chance}% 機率召喚千尺巨浪，額外造成 100 傷害。`;
      },
      ability: '潮汐入丹，悟道與鬥法皆可借海勢增幅。',
      upkeep: '每日觀水片刻，平心定氣。',
      warning: '巨浪只在鬥法結算中造成額外傷害。',
      note: '修為翻倍指基礎 +1 再額外 +1。',
      resolve({ isCorrect, grade }) {
        if (!isCorrect) return {};
        const chance = chanceByGrade(grade, 10, 5, 50);
        return randomPercent(chance)
          ? { bonusGain: 1, message: `${this.name}潮聲大作，本次基礎修為翻倍` }
          : {};
      }
    },
    {
      id: 'taichu', name: '太初回元丹', icon: '☀', tone: 'gold',
      effect(grade) { return `每累積 ${Math.max(2, grade + 1)} 次悟道成功，額外獲得 1 修為。`; },
      ability: '以太初元氣反覆回補修行底蘊。',
      upkeep: '每日清晨靜坐片刻。',
      warning: '計數只累積悟道成功次數。',
      note: '9 品每 10 次；1 品每 2 次。',
      resolve({ isCorrect, grade, counters }) {
        if (!isCorrect) return {};
        const interval = Math.max(2, grade + 1);
        return counters.correct % interval === 0
          ? { bonusGain: 1, message: `${this.name}回元，額外 +1 修為` }
          : {};
      }
    },
    {
      id: 'ningxin', name: '凝心靜音丹', icon: '◈', tone: 'ivory',
      effect(grade) { return `連續悟道達 ${Math.max(1, Math.ceil(grade / 3)) + 1} 次，即凝聚金丹道心護體。`; },
      ability: '凝神斂念，以連續悟道穩固金丹道心。',
      upkeep: '保持專注即可。',
      warning: '一般連勝本身沒有護體，必須裝備本丹才會觸發。',
      note: '9 品約需 4 連勝；1 品約需 2 連勝。',
      resolve({ isCorrect, grade, previousStreak }) {
        if (!isCorrect) return {};
        const threshold = Math.max(1, Math.ceil(grade / 3));
        return previousStreak >= threshold
          ? { forceShield: true, message: `${this.name}凝神，金丹道心護體成形` }
          : {};
      }
    },
    {
      id: 'pojing', name: '破境衝仙丹', icon: '✦', tone: 'amber',
      effect(grade) { return `進入下一境界前最後 ${breakthroughPercent(grade)}% 的修為區間時，悟道成功額外 +2 修為。`; },
      ability: '越近瓶頸，丹力越能衝擊境界壁障。',
      upkeep: '突破前保持穩定悟道。',
      warning: '只在接近下一境界的指定比例區間生效。',
      note: '9 品為最後 20%；1 品為最後 60%。',
      resolve({ isCorrect, grade, score }) {
        if (!isCorrect || !inBreakthroughZone(score, grade)) return {};
        return { bonusGain: 2, message: `${this.name}衝破瓶頸，額外 +2 修為` };
      }
    },
    {
      id: 'xingchen', name: '星辰吞月丹', icon: '✧', tone: 'pale',
      effect(grade) { return `連續悟道達 ${Math.max(1, grade)} 次後，之後每次成功額外 +2 修為。`; },
      ability: '連勝越久，星月之力越穩定。',
      upkeep: '維持連續悟道。',
      warning: '中斷連勝後需重新累積。',
      note: '9 品先達 9 次；1 品先達 1 次。',
      resolve({ isCorrect, grade, previousStreak }) {
        return isCorrect && previousStreak >= Math.max(1, grade)
          ? { bonusGain: 2, message: `${this.name}引星吞月，額外 +2 修為` }
          : {};
      }
    },
    {
      id: 'wugou', name: '無垢清心丹', icon: '◇', tone: 'silver',
      effect(grade) { return `答錯時有 ${chanceByGrade(grade, 20, 10, 100)}% 機率凝聚金丹道心護體。`; },
      ability: '失誤之際清心去垢，反而護住道心。',
      upkeep: '答錯後重新定神即可。',
      warning: '只產生金丹道心，不屬於舊版通用道心系統。',
      note: '9 品 20%；1 品 100%。',
      resolve({ isCorrect, grade }) {
        if (isCorrect) return {};
        const chance = chanceByGrade(grade, 20, 10, 100);
        return randomPercent(chance)
          ? { forceShield: true, message: `${this.name}清心去垢，金丹道心護體成形` }
          : {};
      }
    },
    {
      id: 'thunder', name: '萬劫雷霆丹', icon: '⚡', tone: 'thunder',
      effect(grade) {
        const counterChance = chanceByGrade(grade, 10, 10, 90);
        return `進入下一境界前最後 ${breakthroughPercent(grade)}% 的修為區間時，悟道成功額外 +1 修為；鬥法受到攻擊時有 ${counterChance}% 機率雷光反擊，造成等同本次實際承受傷害的反擊傷害。`;
      },
      ability: '以雷劫淬丹，突破與受擊皆可引雷。',
      upkeep: '雷意需在實戰中承受攻擊才會反擊。',
      warning: '若該次攻擊已使你倒下，則不再發動反擊。',
      note: '突破區間 9 品 20%／1 品 60%；反擊 9 品 10%／1 品 90%。',
      resolve({ isCorrect, grade, score }) {
        if (!isCorrect || !inBreakthroughZone(score, grade)) return {};
        return { bonusGain: 1, message: `${this.name}雷劫淬體，額外 +1 修為` };
      }
    },
    {
      id: 'reverse', name: '陰陽反轉丹', icon: '↺', tone: 'violet',
      effect(grade) { return `連續悟道達 ${Math.max(2, grade + 1)} 次的那一次，額外 +3 修為。`; },
      ability: '陰陽翻轉，在指定連勝節點爆發丹力。',
      upkeep: '保持連勝直到觸發節點。',
      warning: '只在達到指定連勝的那一次觸發。',
      note: '9 品需 10 連勝；1 品需 2 連勝。',
      resolve({ isCorrect, grade, previousStreak }) {
        const threshold = Math.max(2, grade + 1);
        return isCorrect && previousStreak + 1 === threshold
          ? { bonusGain: 3, message: `${this.name}陰陽反轉，額外 +3 修為` }
          : {};
      }
    },
    {
      id: 'sword', name: '破鋒劍心丹', icon: '⚔', tone: 'silver',
      effect(grade) { return `鬥法發動攻擊時有 ${chanceByGrade(grade, 10, 5, 50)}% 機率召喚萬劍追擊，額外造成 200 傷害。`; },
      ability: '丹心化劍，命中後有機率萬劍追擊。',
      upkeep: '只在鬥法攻擊命中時判定。',
      warning: '本丹沒有額外修為效果。',
      note: '9 品 10%；1 品 50%。',
      resolve() { return {}; }
    }
  ];'''

pattern = re.compile(r"  const CORE_TYPES = \[.*?\n  \];(?=\n\n  function coreType)", re.S)
text, count = pattern.subn(new_core_types, text, count=1)
if count != 1:
    raise SystemExit(f'CORE_TYPES replacement count={count}')
training.write_text(text)

legacy = Path('public/main-legacy.js')
src = legacy.read_text()
equipped_line = "        equipped: currentUserData.equipped || { frame: '', avatar: '' },\n"
golden_line = "        goldenCore: window.getEquippedGoldenCoreBattleSnapshot?.() || null,\n"
if golden_line not in src:
    if equipped_line not in src:
        raise SystemExit('myBattleData equipped marker not found')
    src = src.replace(equipped_line, equipped_line + golden_line, 1)

old_attack = """            if (attacker.answerCorrect) {\n                const damage = Math.max(1, attacker.atk);\n                defender.hp = Math.max(0, defender.hp - damage);\n                if (defender.hp === 0) defender.isDead = true;\n                battleLog.push({ attacker: attackerRole, isHit: true, dmg: damage, skill: '答題攻擊', healed: null });\n            } else {\n                battleLog.push({ attacker: attackerRole, isHit: false, dmg: 0, skill: 'MISS', healed: null });\n            }"""
new_attack = """            if (attacker.answerCorrect) {\n                const baseDamage = Math.max(1, attacker.atk);\n                const attackEffect = window.resolveGoldenCoreBattleAttack?.({ attacker, defender, baseDamage }) || {};\n                const extraDamage = Math.max(0, Number(attackEffect.extraDamage) || 0);\n                const intendedDamage = baseDamage + extraDamage;\n                const defenderHpBefore = Math.max(0, Number(defender.hp) || 0);\n                const receivedDamage = Math.min(defenderHpBefore, intendedDamage);\n                defender.hp = Math.max(0, defenderHpBefore - intendedDamage);\n                if (defender.hp === 0) defender.isDead = true;\n                battleLog.push({\n                    attacker: attackerRole, isHit: true, dmg: intendedDamage,\n                    skill: attackEffect.skill || '答題攻擊', healed: null\n                });\n\n                if (defender.hp > 0 && receivedDamage > 0) {\n                    const counterEffect = window.resolveGoldenCoreBattleCounter?.({\n                        defender, attacker, receivedDamage\n                    }) || {};\n                    const reflectDamage = Math.max(0, Number(counterEffect.reflectDamage) || 0);\n                    if (reflectDamage > 0) {\n                        const defenderRole = attackerRole === 'host' ? 'guest' : 'host';\n                        attacker.hp = Math.max(0, Number(attacker.hp || 0) - reflectDamage);\n                        if (attacker.hp === 0) attacker.isDead = true;\n                        battleLog.push({\n                            attacker: defenderRole, isHit: true, dmg: reflectDamage,\n                            skill: counterEffect.skill || '萬劫雷霆丹・雷光反擊', healed: null\n                        });\n                    }\n                }\n            } else {\n                battleLog.push({ attacker: attackerRole, isHit: false, dmg: 0, skill: 'MISS', healed: null });\n            }"""
if old_attack in src:
    src = src.replace(old_attack, new_attack, 1)
elif 'resolveGoldenCoreBattleAttack' not in src:
    raise SystemExit('battle attack marker not found')
legacy.write_text(src)

status = Path('public/cultivation/cultivation-status-panel.js')
s = status.read_text()
if "sword: { icon: '⚔', tone: 'silver' }" not in s:
    old = "    reverse: { icon: '↺', tone: 'violet' }\n"
    new = "    reverse: { icon: '↺', tone: 'violet' },\n    sword: { icon: '⚔', tone: 'silver' }\n"
    if old not in s:
        raise SystemExit('status CORE_META marker not found')
    s = s.replace(old, new, 1)
    status.write_text(s)

tests = Path('tests/progression-gates.test.cjs')
t = tests.read_text()
if "const battleEffects = read('golden-core-battle-effects.js');" not in t:
    marker = "const equipWarning = read('cultivation-core-equip-warning.js');\n"
    repl = marker + "const battleEffects = read('golden-core-battle-effects.js');\nconst legacy = readRoot('main-legacy.js');\n"
    if marker not in t:
        raise SystemExit('test declarations marker not found')
    t = t.replace(marker, repl, 1)

if "test('Golden Core roster matches the nine current pills and battle effects'" not in t:
    t += r'''

test('Golden Core roster matches the nine current pills and battle effects', () => {
  for (const name of [
    '大海無垠丹', '太初回元丹', '凝心靜音丹', '破境衝仙丹', '星辰吞月丹',
    '無垢清心丹', '萬劫雷霆丹', '陰陽反轉丹', '破鋒劍心丹'
  ]) assert.match(training, new RegExp(name));
  for (const oldName of ['破境拆牆丹', '無垢摸魚丹', '雷公安眠丹', '倒反天罡丹']) {
    assert.doesNotMatch(training, new RegExp(oldName));
  }
  assert.match(training, /chanceByGrade\(grade, 10, 5, 50\)/);
  assert.match(training, /breakthroughPercent\(grade\)/);
  assert.match(training, /chanceByGrade\(grade, 20, 10, 100\)/);
  assert.match(training, /bonusGain: 3/);
  assert.match(statusPanel, /sword: \{ icon: '⚔', tone: 'silver' \}/);
  assert.match(battleEffects, /extraDamage: 100/);
  assert.match(battleEffects, /extraDamage: 200/);
  assert.match(battleEffects, /chanceByGrade\(core\.grade, 10, 10, 90\)/);
  assert.match(battleEffects, /reflectDamage: damage/);
  assert.match(main, /cultivation\/golden-core-battle-effects\.js/);
  assert.match(legacy, /goldenCore: window\.getEquippedGoldenCoreBattleSnapshot/);
  assert.match(legacy, /resolveGoldenCoreBattleAttack/);
  assert.match(legacy, /resolveGoldenCoreBattleCounter/);
});
'''
tests.write_text(t)

cultivation_tests = Path('tests/cultivation.test.cjs')
ct = cultivation_tests.read_text()
if "wrong-answer Golden Core effect may directly form Golden Core Dao-heart" not in ct:
    ct += r'''

test('wrong-answer Golden Core effect may directly form Golden Core Dao-heart', async () => {
  const h = setup(120);
  h.context.window.resolveGoldenCoreCultivationReward = () => ({ forceShield: true, message: '清心護體' });
  await h.answer(1, 0);
  assert.equal(h.context.currentUserData.stats.totalScore, 120);
  assert.equal(h.context.currentUserData.stats.goldenCoreShield, true);
});
'''
    cultivation_tests.write_text(ct)
