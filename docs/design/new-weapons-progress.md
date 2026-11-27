# 六把新武器 V1 開發進度

盤點日期：2026-11-27（台灣時間）
目標：main
規格： [new-weapons-v1.md](new-weapons-v1.md)
盤點基準：`a3c4109a80822154521d6faf5747d8b03899358f`（Refresh static module versions for weapon balance update）。

## 階段 0：完成（CI 基準已確認）

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
| 0 專案盤點 | 完成：3106/3106 |
| 1 共用技能預覽 | 回合制核心及渲染已接入；待完整 CI、瀏覽器驗收與即時副本整合 |
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

## 2026-11-27 第二次盤點：CI 基準與過時預期修正

已透過 main push 的 Actions REST 紀錄查到原盤點 SHA 的 [回歸測試](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45833068849)：3106 項，3103 通過、3 失敗，靜態版本檢查通過。三項均為既有合法武器倍率調整後的測試預期：四步連推碰撞 90→120（200×0.6）；突進橫斬首領 HP 3440→3520（4000−200×2.4）；翻摔首領 HP 3700→3400（4000−200×3）。修正對應三個預期，不改戰鬥規則、不移除命中次數或位移驗證。此提交的完整回歸仍須核對；第 0 階段尚待確認。

## 第 0 階段最終驗收

基準提交 `7e34a934b44cb0dcab7c7e91d2f4ca6e0ae0242a` 的 [GitHub Actions](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45913936579) 已完成：3106 項全部通過、0 失敗、0 跳過，module-versions 檢查亦通過；Pages 部署成功。先前記錄的未執行與失敗狀態為歷史紀錄，現以此提交為穩定開發基準。已補查武器修煉頁（manual-training-page.js）、動畫事件（tactical-animation.js 的 plan 按事件 ID/revision 建立時間軸，damage/move/cast）、即時副本前端（dungeon-map-view.js），後續須接入共用預覽規則。無法本地 checkout 不再阻礙基準確認，使用 CI 驗收。

## 第 1 階段（回合制預覽核心）

- tactical-rules.js：previewCast/skillPreviewPlan 逐個合法目標呼叫相同 cast，使用獨立 clone、WeakMap 收集完整事件，不受正式事件 64 筆截斷；低體力仍可查看幾何但不可施放。預測傷害逐段、強制位移、終點與範圍；不相信客戶端值。
- tactical-renderer.js：依 revision、角色、地形、目標及配置等快照快取所有方案，繪圖時僅查快取；金色淡/亮範圍、虛線位移落點，保留紅色敵方預告及點選語意。
- tactical-target-visuals.js：選定/懸停方案顯示模擬傷害，原無方案呼叫保留幾何相容性；未擅改確認/自動施放互動。
- tests/tactical-skill-preview-plan.test.cjs：4 個新增測試在獨立 JS 環境執行通過（使用實際共用規則及輕量 assertion，非完整 Node CI）。
- module-versions.json 使用 Git 實際 blob SHA 同步 3 個靜態資源；完整版本檢查待 CI。
- 尚未完成：即時合作副本仍有獨立 geometry/castSkill，待共用轉接；新武器多端點方案尚未實作；瀏覽器視覺驗收待執行。第 1 階段尚不能標記完整驗收。不得公開新武器。
