from pathlib import Path
import re

training = Path('public/cultivation/cultivation-training-v4.js')
s = training.read_text()

old_default = '''  function defaultState() {\n    return {\n      announced: false,\n      core: starterCore(),\n      equipped: true,\n      counters: { correct: 0, mistakes: 0 },\n      items: []\n    };\n  }\n'''
new_default = '''  function defaultState() {\n    const core = starterCore();\n    return {\n      announced: false,\n      // core 是洗髓後目前正在查看／準備裝配的候選丹。\n      core,\n      // equippedCore 才是真正作用中的金丹；洗髓不會把它清掉。\n      equippedCore: { ...core },\n      equipped: true,\n      counters: { correct: 0, mistakes: 0 },\n      items: []\n    };\n  }\n'''
if old_default not in s:
    raise SystemExit('defaultState block not found')
s = s.replace(old_default, new_default, 1)

migrate_pattern = re.compile(r"  function migrate\(raw\) \{.*?\n  \}\n\n  function loadState\(\)", re.S)
new_migrate = '''  function migrate(raw) {\n    const base = defaultState();\n    if (!raw || typeof raw !== 'object') return base;\n\n    const legacyEquippedObject = raw.equipped && typeof raw.equipped === 'object' ? raw.equipped : null;\n    const chosen = normalizeCore(raw.core || raw.preview || legacyEquippedObject, base.core);\n\n    let equippedCore = normalizeCore(raw.equippedCore || legacyEquippedObject, null);\n    if (!equippedCore && raw.equipped === true) equippedCore = { ...chosen };\n    // 很舊的資料沒有 equipped 欄位時，原本金丹就是已裝配狀態。\n    if (!equippedCore && typeof raw.equipped === 'undefined' && !raw.preview) equippedCore = { ...chosen };\n\n    let equipped = false;\n    if (typeof raw.equipped === 'boolean') equipped = raw.equipped && !!equippedCore;\n    else if (raw.preview && legacyEquippedObject && raw.preview.instanceId && legacyEquippedObject.instanceId) {\n      equipped = raw.preview.instanceId === legacyEquippedObject.instanceId;\n    } else if (equippedCore) {\n      equipped = chosen.type === equippedCore.type &&\n        clampGrade(chosen.grade) === clampGrade(equippedCore.grade) &&\n        Number(chosen.createdAt || 0) === Number(equippedCore.createdAt || 0);\n    }\n\n    return {\n      announced: !!raw.announced,\n      core: chosen,\n      equippedCore,\n      equipped,\n      counters: { ...base.counters, ...(raw.counters || {}) },\n      items: Array.isArray(raw.items) ? raw.items : []\n    };\n  }\n\n  function loadState()'''
s, count = migrate_pattern.subn(new_migrate, s, count=1)
if count != 1:
    raise SystemExit(f'migrate replacement count={count}')

old_serial = '''  function serializableState() {\n    return {\n      announced: state.announced,\n      core: state.core,\n      equipped: state.equipped,\n      counters: state.counters,\n      items: state.items\n    };\n  }\n'''
new_serial = '''  function serializableState() {\n    return {\n      announced: state.announced,\n      core: state.core,\n      equippedCore: state.equippedCore,\n      equipped: state.equipped,\n      counters: state.counters,\n      items: state.items\n    };\n  }\n'''
if old_serial not in s:
    raise SystemExit('serializableState block not found')
s = s.replace(old_serial, new_serial, 1)

old_wash_backup = '''    const previousCore = { ...state.core };\n    const previousEquipped = state.equipped;\n    const previousGold = stones;\n'''
new_wash_backup = '''    const previousCore = { ...state.core };\n    const previousEquippedCore = state.equippedCore ? { ...state.equippedCore } : null;\n    const previousEquipped = state.equipped;\n    const previousGold = stones;\n'''
if old_wash_backup not in s:
    raise SystemExit('wash backup block not found')
s = s.replace(old_wash_backup, new_wash_backup, 1)

old_wash_apply = '''      const fresh = randomCore();\n      state.core = fresh;\n      state.equipped = false;\n      userData.stats.gold = stones - WASH_COST;\n'''
new_wash_apply = '''      const fresh = randomCore();\n      state.core = fresh;\n      // 洗髓只產生候選丹；原本裝備中的丹繼續生效，直到玩家主動裝配新丹。\n      state.equipped = false;\n      userData.stats.gold = stones - WASH_COST;\n'''
if old_wash_apply not in s:
    raise SystemExit('wash apply block not found')
s = s.replace(old_wash_apply, new_wash_apply, 1)

old_wash_catch = '''      state.core = previousCore;\n      state.equipped = previousEquipped;\n      userData.stats.gold = previousGold;\n'''
new_wash_catch = '''      state.core = previousCore;\n      state.equippedCore = previousEquippedCore;\n      state.equipped = previousEquipped;\n      userData.stats.gold = previousGold;\n'''
if old_wash_catch not in s:
    raise SystemExit('wash catch block not found')
s = s.replace(old_wash_catch, new_wash_catch, 1)

old_equip = '''  async function equipCore() {\n    if (busy || state.equipped) return;\n    busy = true;\n    state.equipped = true;\n    renderTrainingPage();\n    try {\n      await persistRemote();\n      toast(`已裝配：${state.core.grade} 品 ${coreType(state.core.type).name}`);\n    } catch (error) {\n      console.error('Equip golden core failed:', error);\n      state.equipped = false;\n      saveLocal();\n      toast('裝配失敗，請稍後再試。');\n    } finally {\n      busy = false;\n      renderTrainingPage();\n    }\n  }\n'''
new_equip = '''  async function equipCore() {\n    if (busy || state.equipped) return;\n    busy = true;\n    const previousEquippedCore = state.equippedCore ? { ...state.equippedCore } : null;\n    state.equippedCore = { ...state.core };\n    state.equipped = true;\n    renderTrainingPage();\n    try {\n      await persistRemote();\n      toast(`已裝配：${state.core.grade} 品 ${coreType(state.core.type).name}`);\n      window.dispatchEvent(new CustomEvent('golden-core-equipped-changed'));\n    } catch (error) {\n      console.error('Equip golden core failed:', error);\n      state.equippedCore = previousEquippedCore;\n      state.equipped = false;\n      saveLocal();\n      toast('裝配失敗，請稍後再試。');\n    } finally {\n      busy = false;\n      renderTrainingPage();\n    }\n  }\n'''
if old_equip not in s:
    raise SystemExit('equipCore block not found')
s = s.replace(old_equip, new_equip, 1)

old_resolve_start = '''  window.resolveGoldenCoreCultivationReward = function ({ stats, isCorrect }) {\n    if (!isUnlocked() || !state.equipped || !state.core) {\n      return { bonusGain: 0, message: '' };\n    }\n\n    const type = coreType(state.core.type);\n    const grade = clampGrade(state.core.grade);\n'''
new_resolve_start = '''  window.resolveGoldenCoreCultivationReward = function ({ stats, isCorrect }) {\n    const equippedCore = state.equippedCore;\n    if (!isUnlocked() || !equippedCore) {\n      return { bonusGain: 0, message: '' };\n    }\n\n    const type = coreType(equippedCore.type);\n    const grade = clampGrade(equippedCore.grade);\n'''
if old_resolve_start not in s:
    raise SystemExit('resolve reward start not found')
s = s.replace(old_resolve_start, new_resolve_start, 1)

old_getter = '''  window.getGoldenCoreState = function () {\n    if (!isUnlocked()) return null;\n    const type = coreType(state.core.type);\n    return {\n      type: state.core.type,\n      name: type.name,\n      grade: state.core.grade,\n      effect: type.effect(state.core.grade),\n      equipped: state.equipped,\n      core: { ...state.core }\n    };\n  };\n'''
new_getter = '''  // 候選丹：供金丹頁與「品質下降警告」使用。\n  window.getGoldenCoreState = function () {\n    if (!isUnlocked()) return null;\n    const type = coreType(state.core.type);\n    return {\n      type: state.core.type,\n      name: type.name,\n      grade: state.core.grade,\n      effect: type.effect(state.core.grade),\n      equipped: state.equipped,\n      core: { ...state.core }\n    };\n  };\n\n  // 真正裝備中的丹：狀態頁、修為效果與鬥法只能讀這一份。\n  window.getEquippedGoldenCoreState = function () {\n    if (!isUnlocked() || !state.equippedCore) return null;\n    const core = state.equippedCore;\n    const type = coreType(core.type);\n    return {\n      type: core.type,\n      name: type.name,\n      grade: core.grade,\n      effect: type.effect(core.grade),\n      equipped: true,\n      core: { ...core }\n    };\n  };\n'''
if old_getter not in s:
    raise SystemExit('getGoldenCoreState block not found')
s = s.replace(old_getter, new_getter, 1)

training.write_text(s)

status = Path('public/cultivation/cultivation-status-panel.js')
t = status.read_text()
t = t.replace("    const core = window.getGoldenCoreState?.();\n", "    const core = window.getEquippedGoldenCoreState?.() || null;\n", 1)
status.write_text(t)

battle = Path('public/cultivation/golden-core-battle-effects.js')
b = battle.read_text()
b = b.replace("    const core = window.getGoldenCoreState?.();\n", "    const core = window.getEquippedGoldenCoreState?.() || null;\n", 1)
battle.write_text(b)
