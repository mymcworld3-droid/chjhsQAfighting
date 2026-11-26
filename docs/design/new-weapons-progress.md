# 六把新武器 V1 開發進度

盤點日期：2026-11-27（台灣時間）
目標：main
規格： [new-weapons-v1.md](new-weapons-v1.md)
盤點基準：`a3c4109a80822154521d6faf5747d8b03899358f`（Refresh static module versions for weapon balance update）。

## 階段 0：部分完成，尚未驗收

- 已核對主分支武器目錄、平衡文件、戰鬥預覽、渲染與動畫入口、即時副本技能入口、武器掉落入口。
- 已保存完整 V1 規格（提交 `3618fbf86aab364054b08f2734f01d1240a6d0ad`）。
- 本次只修改 docs；未修改遊戲規則、玩家資料、掉落池、靜態資源或既有測試。
- 阻礙：本地 git ls-remote 無法解析 github.com，未能 checkout 或安裝依賴、執行完整測試。GitHub combined status 返回空陣列；可用 workflow 查詢僅涵蓋 PR 事件且返回空陣列，不代表 CI 通過或失敗。
- 基準測試：未執行，通過/失敗數未知；無法區分既有失敗與未來改動的失敗。階段 0 未達完整驗收，先不要公開武器。

## 實際程式架構

| 路徑 | 盤點結果與後續注意 |
| --- | --- |
| public/cultivation/manual-rules.js | 共用瀏覽器/Node 目錄，BOOKS 六把、BY_BOOK/BY_SKILL 由目錄衍生；熟練度 1/5/10、上限 20，技能上限 5、精煉上限 5。skillAtLevel 已套用每級 10% 與每星 5%。新增多段倍率應擴充共用縮放規則。 |
| docs/weapon-balance-rules.md | 確認境界優勢與輸出循環原則；不要僅比較最高單次倍率。 |
| public/cultivation/tactical-rules.js | aimCells 是可指定目標集合，不等於所有攻擊格；skillCells 與 techniquePreview 已存在，四步連推使用 clone 模擬，validateSkill 同時驗證體力及出手限制。保留既有目標選擇語意，另建最大攻擊格集合。已有 blocked、covers、canOccupy、push 等幾何工具。 |
| public/cultivation/tactical-renderer.js | update 約第 324 行先取 aimCells，約第 815 行選點後才計算 techniquePreview。現有攻擊格為紅色，應區分金色預覽和紅色敵方預告；保留可選目標及點擊邏輯。 |
| public/cultivation/tactical-target-visuals.js | derive 目前限 PvE 且要求已選地格，使用 validateSkill/techniquePreview，預估受影響角色但不估算傷害。避免另建重複 UI。 |
| public/cultivation/tactical-seal-targeting.js | 已依 skillCells/techniquePreview 查詢封印是否可攻擊；改預覽需維持封印導引功能。 |
| public/cultivation/tactical-combat.js | 約第 1359 行選定後讀取 skillCells；約第 1388 行使用 aimCells 判斷無可選攻擊地格。保留原控制輪與既有互動。 |
| public/cultivation/tactical-animation.js、tactical-skill-effects.js | 既有動畫引擎與技能效果入口，階段 4 擴充而非重寫；需再深入盤點實際事件格式。 |
| dungeon-skill-combat.cjs | castSkill 使用裝備/熟練度伺服器驗證、skillSeq 去重、tile 驗證、獨立位移及傷害計算。房間以 members/enemies 及 position 表達，不可直接假定與回合制 actors 格式相同。 |
| dungeon-player-combat.cjs、dungeon-enemy-combat.cjs、dungeon-room-api.cjs | 即時副本戰鬥與世界時間入口；星核需接權威時鐘並去重，禁止每隻敵人或每次答題觸發。 |
| manual-reward-rules.cjs、weapon-dungeon-rewards.cjs | 掉落池直接由 Manuals.BOOKS 篩選，故不能先把未完成武器直接放入公開 BOOKS。須先設發布門檻並防止伺服器取得/裝備/施放。 |
| public/cultivation/tactical-power-rules.js | estimateMove 為戰力估算入口，須納入布置、多段與持續效果。 |
| public/cultivation/weapon-dungeon-rules.js | 單人武器副本規則入口。 |

## 恢復工作順序

1. 重新取得最新 main（不要回退至盤點 SHA），檢查工作樹。
2. 在可連 GitHub 的環境安裝依賴，執行 `npm test`、`npm run test:battle`、`npm run check:module-versions`，記錄實際測試數及失敗名稱；核對 main push 的 Actions，不把空狀態當成功。
3. 檢查武器修煉頁與即時副本前端預覽、動畫事件格式，補足第 0 階段盤點。確認目前基準後才標記第 0 階段完成。
4. 第 1 階段：在既有規則中列舉合法方案，分開「可點選目標」與「攻擊格聯集」，將每方案的模擬結果及失效快取接入 renderer/target-visuals；不要在逐幀 draw 重算所有方案；保留既有方向、封印和飛劍操作。預覽不得扣體力或修改戰鬥狀態。之後再擴充新技能與各模式共用結算。
5. 相關既有測試：tests/tactical-target-visuals.test.cjs、tests/manual-training.test.cjs、tests/tactical-left-manual-wheel.test.cjs、tests/tactical-skill-effects.test.cjs、tests/weapon-dungeons.test.cjs、tests/dungeon-skill-combat.test.cjs、tests/dungeon-boss-teamwork.test.cjs、tests/tactical-browser-initialization.test.cjs。保留原驗收目的；任何靜態資源改動需重建 module-versions.json。

## 階段追蹤

| 階段 | 狀態 |
| --- | --- |
| 0 專案盤點 | 部分完成：待測試基準及補充盤點 |
| 1 共用技能預覽 | 未開始 |
| 2 共用幾何與位移工具 | 未開始 |
| 3 武器資料與特殊物件 | 未開始 |
| 4 共用動畫及特效 | 未開始 |
| 5–6 折光靈劍 | 未開始 |
| 7–8 鳴鐘圖騰 | 未開始 |
| 9–10 織界靈劍 | 未開始 |
| 11–13 蜃影圖騰 | 未開始 |
| 14–15 歲輪天劍 | 未開始 |
| 16–17 星隕圖騰 | 未開始 |
| 18 養成、掉落及各模式整合 | 未開始 |
| 19 完整測試、平衡及正式公開 | 未開始 |

目前沒有新武器進入公開目錄；不宣稱任何新技能已接入或測試通過。
