from pathlib import Path

p = Path('public/cultivation/cultivation-training-v4.js')
s = p.read_text()

old = '''    let equippedCore = normalizeCore(raw.equippedCore || legacyEquippedObject, null);\n    if (!equippedCore && raw.equipped === true) equippedCore = { ...chosen };\n    // 很舊的資料沒有 equipped 欄位時，原本金丹就是已裝配狀態。\n    if (!equippedCore && typeof raw.equipped === 'undefined' && !raw.preview) equippedCore = { ...chosen };\n\n    let equipped = false;\n    if (typeof raw.equipped === 'boolean') equipped = raw.equipped && !!equippedCore;\n'''
new = '''    let equippedCore = normalizeCore(raw.equippedCore || legacyEquippedObject, null);\n    let repairedLegacyWashState = false;\n    if (!equippedCore && raw.equipped === true) equippedCore = { ...chosen };\n    // 很舊的資料沒有 equipped 欄位時，原本金丹就是已裝配狀態。\n    if (!equippedCore && typeof raw.equipped === 'undefined' && !raw.preview) equippedCore = { ...chosen };\n    // v4 舊版洗髓會把原裝備丹覆蓋後只留下 equipped=false。舊丹已無法還原，\n    // 因此僅對「沒有 equippedCore 的舊格式」做一次修復：讓目前金丹成為裝備丹，避免狀態頁永久空白。\n    if (!equippedCore && raw.equipped === false && !Object.prototype.hasOwnProperty.call(raw, 'equippedCore')) {\n      equippedCore = { ...chosen };\n      repairedLegacyWashState = true;\n    }\n\n    let equipped = repairedLegacyWashState;\n    if (!repairedLegacyWashState && typeof raw.equipped === 'boolean') equipped = raw.equipped && !!equippedCore;\n'''
if old not in s:
    raise SystemExit('legacy repair marker not found')
s = s.replace(old, new, 1)
p.write_text(s)
