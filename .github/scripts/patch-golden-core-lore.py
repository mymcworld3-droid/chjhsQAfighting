from pathlib import Path


def replace_exact(path, pairs):
    p = Path(path)
    s = p.read_text()
    for old, new in pairs:
        if old not in s:
            raise SystemExit(f'{path}: expected text not found: {old[:100]!r}')
        s = s.replace(old, new, 1)
    p.write_text(s)


replace_exact('public/cultivation/cultivation-training-v4.js', [
    (
        '// 修煉 v4：玩家永遠只有一顆金丹；洗髓直接重塑該金丹，金丹不進背包。',
        '// 修煉 v4：金丹是修士在自身靈田／丹田中凝聚的本命金丹；玩家永遠只有一顆，洗髓只重塑其丹性與品級。'
    ),
    ("note: '修為翻倍指基礎 +1 再額外 +1。',", "note: '金丹內自成一片汪洋。據說大成後可號令萬水；目前最明顯的副作用，是看見水龍頭沒關會產生一種莫名的責任感。',"),
    ("note: '9 品每 10 次；1 品每 2 次。',", "note: '太初元氣可返本歸元，但無法返還已交出去的作業、已讀的訊息，以及手滑花掉的靈石。',"),
    ("warning: '一般連勝本身沒有護體，必須裝備本丹才會觸發。',", "warning: '一般連勝本身沒有護體，必須調御此丹相才會觸發。',"),
    ("note: '9 品約需 4 連勝；1 品約需 2 連勝。',", "note: '金丹會替你隔絕雜念。師尊叫三次都沒回應時，通常會改用物理方式突破你的靜音結界。',"),
    ("note: '9 品為最後 20%；1 品為最後 60%。',", "note: '專治修行瓶頸。對真正的牆壁沒有作用，請勿以額頭驗證丹力。',"),
    ("note: '9 品先達 9 次；1 品先達 1 次。',", "note: '陰天時可打開天氣 App 對著月亮圖示修煉；丹師表示「理論上應該差不多」。',"),
    ("note: '9 品 20%；1 品 100%。',", "note: '號稱心如明鏡、萬念不生。答錯時仍可能先懷疑答案，再懷疑出題老師。',"),
    ("note: '突破區間 9 品 20%／1 品 60%；反擊 9 品 10%／1 品 90%。',", "note: '丹中雷光常年遊走。有人研究能不能順便替手機充電；手機沒充到，頭髮倒先充滿了。',"),
    ("note: '9 品需 10 連勝；1 品需 2 連勝。',", "note: '能逆轉陰陽、倒轉氣機。目前仍無法把星期一反轉成星期五，相關研究經費持續申請中。',"),
    ("note: '9 品 10%；1 品 50%。',", "note: '一念萬劍生。初成時偶爾只聽見腦中「鏘」的一聲，但本人通常會堅稱萬劍只是尚未抵達。',"),
    ('// core 是洗髓後目前正在查看／準備裝配的候選丹。', '// core 是洗髓後目前正在查看／準備調御的候選丹相。'),
    ('// equippedCore 才是真正作用中的金丹；洗髓不會把它清掉。', '// equippedCore 才是目前真正調御、正在作用中的本命金丹；洗髓不會把它清掉。'),
    ("<p>金丹屬於丹田本命之物，不會放入背包。</p>", "<p>金丹由修士自身靈田／丹田凝聚，屬於本命之物，不會放入背包。</p>"),
    ("${state.equipped ? '<i class=\"fa-solid fa-circle-check\"></i> 已裝配此金丹' : '<i class=\"fa-solid fa-circle-dot\"></i> 裝配此金丹'}", "${state.equipped ? '<i class=\"fa-solid fa-circle-check\"></i> 已調御此丹相' : '<i class=\"fa-solid fa-circle-dot\"></i> 調御此丹相'}"),
    (
        '<div><span>特性效果</span><p>${type.effect(core.grade)}</p></div>',
        '<div><span>本命丹源</span><p>此丹並非外來丹藥，而是修士在自身靈田／丹田中凝聚，並可透過洗髓重塑丹性與品級的本命金丹。</p></div>\n        <div><span>特性效果</span><p>${type.effect(core.grade)}</p></div>'
    ),
    ('toast(`已裝配：${state.core.grade} 品 ${coreType(state.core.type).name}`);', 'toast(`已調御丹相：${state.core.grade} 品 ${coreType(state.core.type).name}`);'),
    ("toast('裝配失敗，請稍後再試。');", "toast('調御失敗，請稍後再試。');"),
    ('// 候選丹：供金丹頁與「品質下降警告」使用。', '// 候選丹相：供金丹頁與「品質下降警告」使用。'),
    ('// 真正裝備中的丹：狀態頁、修為效果與鬥法只能讀這一份。', '// 真正調御中的本命金丹：狀態頁、修為效果與鬥法只能讀這一份。'),
])

replace_exact('public/cultivation/golden-core-tutorial.js', [
    (
        "body: '金丹只有一顆。點擊中央丹體可以查看種類、品質、特性效果、神通與相關說明。',",
        "body: '金丹不是外來丹藥，而是踏入金丹期後在自身靈田／丹田中凝聚出的本命金丹，而且永遠只有一顆。點擊中央丹體可查看丹性、品質、特性效果與神通。',"
    ),
    (
        "body: '洗髓會消耗 100 靈石，直接重塑目前唯一的金丹，不會把舊金丹放入背包。洗到較差品質時，之後裝配會先提醒你。',",
        "body: '洗髓不是換一顆外來丹藥，而是消耗 100 靈石重新洗鍊靈田中的本命金丹，重塑其丹性與品級。新丹相先作候選，原本調御中的丹相會繼續生效，直到你確認切換。',"
    ),
    ("note: '洗髓後的新金丹需要重新裝配才會生效。'", "note: '洗髓後的新丹相需要主動「調御此丹相」才會正式生效。'"),
    ("body: '「狀態」分頁會顯示目前金丹，以及玩家目前的攻擊力與生命值。之後其他戰鬥屬性也可以從這裡逐步擴充。',", "body: '「狀態」分頁會顯示目前正在調御的本命金丹，以及玩家目前的攻擊力與生命值。之後其他戰鬥屬性也可以從這裡逐步擴充。',"),
    ("note: '完成後就可以自由研究不同金丹的搭配。'", "note: '完成後就可以自由研究不同丹性與丹相的調御方式。'"),
])

replace_exact('public/cultivation/cultivation-core-equip-warning.js', [
    ('// 金丹品質下降提醒：若洗髓後品質比上一次已裝配金丹差，裝配前再次確認。', '// 金丹品質下降提醒：若洗髓後候選丹相品質比上一次調御的金丹差，切換丹相前再次確認。'),
    ("<p>目前的「${state?.name || '金丹'}」品質比上一次已裝配的金丹低，特性效果也可能較弱。</p>", "<p>目前候選丹相「${state?.name || '金丹'}」的品質比正在調御的本命金丹低，特性效果也可能較弱。</p>"),
    ('<p class="core-equip-warning-note">一品最佳、九品最低。若仍要更換，可以繼續裝配。</p>', '<p class="core-equip-warning-note">一品最佳、九品最低。若仍要改換丹相，可以繼續調御。</p>'),
    ('<button type="button" class="core-equip-warning-cancel">先不裝配</button>', '<button type="button" class="core-equip-warning-cancel">先不調御</button>'),
    ('<button type="button" class="core-equip-warning-confirm">仍然裝配</button>', '<button type="button" class="core-equip-warning-confirm">仍然調御</button>'),
    ('// 只在開始洗掉「已裝配」金丹時建立比較基準。', '// 只在開始洗髓「目前調御」的本命金丹時建立比較基準。'),
    ('// 若連續洗髓但尚未裝配，仍保留最初那顆已裝配金丹的品質作比較。', '// 若連續洗髓但尚未調御新丹相，仍保留原本調御金丹的品質作比較。'),
    ('// 若載入時已經是正常裝配狀態，舊的比較基準可以清掉；', '// 若載入時已經是正常調御狀態，舊的比較基準可以清掉；'),
    ('// 下一次洗髓時會重新記錄當下已裝配金丹的品質。', '// 下一次洗髓時會重新記錄當下調御金丹的品質。'),
])

replace_exact('public/cultivation/cultivation-status-panel.js', [
    ('// 修煉頁「狀態」分頁：顯示目前裝備金丹與玩家戰鬥數值。', '// 修煉頁「狀態」分頁：顯示目前調御中的本命金丹與玩家戰鬥數值。'),
    ('<span>目前未裝備金丹</span>', '<span>目前沒有調御中的金丹丹相</span>'),
    ('<span class="status-core-equipped on">已裝備</span>', '<span class="status-core-equipped on">調御中</span>'),
    ('<div class="status-section-title"><span>目前裝備金丹</span><small>EQUIPPED CORE</small></div>', '<div class="status-section-title"><span>目前調御金丹</span><small>ATTUNED CORE</small></div>'),
])

replace_exact('public/cultivation/cultivation-rules.js', [
    ('// 一般答題只提供固定基礎修為；所有額外修為與「金丹道心」效果只能由已裝配金丹觸發。', '// 一般答題只提供固定基礎修為；所有額外修為與「金丹道心」效果只能由目前調御中的本命金丹觸發。'),
])

replace_exact('public/cultivation/golden-core-battle-effects.js', [
    ('// 已裝備金丹的鬥法效果。戰鬥房只保存種類與品級，不保存整份修煉狀態。', '// 目前調御中的本命金丹之鬥法效果。戰鬥房只保存丹性與品級，不保存整份修煉狀態。'),
])
