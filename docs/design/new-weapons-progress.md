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
| 1 共用技能預覽 | 基礎驗收完成；新技能多端點隨個別階段接入 |
| 2 共用幾何與位移工具 | 基礎驗收完成 |
| 3 武器資料與特殊物件 | 基礎驗收完成；正式時鐘及授權隨技能接入 |
| 4 共用動畫及特效 | V2 共用時間軸及雙模式橋接已實作；待 CI |
| 5–6 折光靈劍 | 第5階段私有戰鬥核心及雙模式接入；待CI、第6階段視覺與整合 |
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

## 第 1 階段（即時副本補充）

上一輪回歸 3110 項，3109 通過、1 項舊版圖層字串測試失敗；module-versions 一致。已於 `310145a` 修正圖層檢查，使聯集、可點目標、選取路徑、命中格及落點仍必須畫在角色和血條之下；[修正後 CI](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45914541599) 通過。

本次抽出 dungeon-skill-resolution.js，保持原 C 端授權、序號、裝備與熟練度驗證，將施放運算移為共用純函式；dungeon-boss-hit.js 抽出相同首領傷害與 2×2 占地規則。即時副本預先列舉各技能可選地格與攻擊聯集，快取依 room revision，金色底層渲染選取命中及位移。新增精煉快照欄位；舊快照未提供精煉時不標記傷害精確。傷害計算為快照模擬，伺服器仍以最新帳戶資料為準。新增三項測試，獨立 JS 測試（部分伺服器依賴以等價測試替身執行）通過，完整 CI 待驗證。尚未完成：普通攻擊特殊敵人選取、即時副本預覽傷害的可見文字、瀏覽器驗收、新技能多端點操作。未公開新武器。

## 第 1 階段（普通攻擊、動畫檢查與瀏覽器驗收）

即時技能整合 CI 3113 項，3112 通過；唯一失敗是舊動畫測試仍在 dungeon-skill-combat.cjs 搜尋已移至共用 resolver 的 origin。提交 e74fc5c 改為同時驗證 server 呼叫及共用事件格式。本次將普通攻擊射線及傷害流程共用給 server 與 preview，區分可能射線與可點選靈獸占地；預估傷害在選取格旁以金色文字顯示（快照資訊不足時不顯示確切數字）。新增 2 項回歸測試。將既有 tactical-browser 和 dungeon-browser 工作流程開放 main push 執行，以便實際驗收，不更改原測試命令。此提交的 CI 與瀏覽器驗收尚待確認；新武器多端點仍隨其個別階段完成，不提前公開。

## 第 2 階段（共用幾何工具）

新增 weapon-geometry.js：八方向格點射線、閉角阻擋、碰撞面法線與法線射線、正方形外圈/區域、可逆任意兩點連線、凸包與包含內部的多邊形填充、點對稱、完整占地及順時針強制位移分配。原始占地在分配期間保留，禁止交換與重疊；邊界視為阻擋面，斜向碰撞面不唯一時取反向對角法線。此兩點為實作決策，需在個別武器階段驗收。新增 8 項 Node 測試及獨立 JS 6561 組線段正反向對照，全通過；完整 CI 未確認。工具尚未接入新技能，無新武器公開。第 1 階段瀏覽器驗收可與純幾何測試並行，仍未正式完成。

## 瀏覽器驗收追蹤

[fe22736 完整回歸](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45915314444)：3115 項全通過，靜態資源版號一致。新增的 main 合作副本瀏覽器測試 [45915314521](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45915314521) 在第 598 行停止，原腳本要求舊 img/book PNG，而現行共用 weapon-presentation.js 使用 data-qy-weapon-art、role=img 和 HD WebP 背景；本次更新測試檢查正確武器 ID、HD 圖片路徑及 role，不移除 XP、進度、音效等檢查。尚待重新執行完整合作瀏覽器測試與戰術瀏覽器測試，幾何 CI 也尚待確認。第 1、2 階段尚未標記正式驗收。

## 第 1、2 階段 CI 修正

fe67669 回歸 3123 項，3122 通過，幾何法線負零 (-0) 在 Node 嚴格比較失敗；現已正規化方向零分量，未更改反射規則。多人副本真實瀏覽器 [45915482218](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45915482218) 全數通過。戰術瀏覽器 [45915482130](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45915482130) 三個子測試失敗：關閉按鈕新增共用導覽 data 屬性，舊 dataset 拼接不再等於 close；修煉升級新增確認對話框，舊腳本未同意；副本券採共用獎勵元件，舊 3 / 5、2 / 5 文案改為檢查當前券數與補發上限。更新測試並保留功能要求，不改主頁/修煉 UI 或略過確認。待 CI 重跑。

## 第 3 階段（私有武器資料與特殊物件）

新增 new-weapon-drafts.js，按 V1 保存六把武器、十八個技能、境界、1/5/10 解鎖及多段倍率/機制參數。新目錄獨立於公開 Manuals.BOOKS/BY_BOOK/BY_SKILL，既有正規化拒絕未發布的裝備資料；未改掉落池、現有玩家資料或技能授權。manual-rules.js 擴充同一 skillAtLevel 縮放 powers 及 maxTargetPower，維持既有每級10%、每星5%公式，鏡像比例30%固定。

新增 weapon-special-objects.js：版本化純 JSON 狀態、來源及擁有者驗證、序號、生成時鐘、技能等級/精煉快照、劍痕最多3道 FIFO 且同格重複不刷新、蜃影唯一且點對稱動態求值、殘影最多2道 FIFO（同格可保留不同施放時刻）、星核唯一且空地替換、5次單調事件去重、第五次後保留至 owner window 結束；提供裝備清理與戰鬥結束清除。尚未連到正式回合/即時時鐘及技能授權：後續個別階段才接入，不能公開或取得新武器。

新增 6 項測試，獨立 JS 嚴格比較 161 次斷言通過。需核對完整 CI；第1、2階段的修正 CI 與瀏覽器驗收仍需確認。所有新檔案的 module-versions 已同步。

## 第 1–3 階段驗收

提交 af9abdc：[回歸](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45916321214) 3129/3129，0 失敗、0 跳過，版本檢查通過；[戰術瀏覽器](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45916321333) 三個測試步驟全部通過；合作瀏覽器先前 45915482218 成功。既有基礎驗收完成；多端點、特殊物件與各新技能結算仍按個別階段接入。

## 第 4 階段（共用 V2 動畫基礎）

新增 weapon-effects.js：版本2事件 weaponTimeline={version:2,durationMs,segments}，250–650ms；segment 帶 kind/start/impact/end、cells、rays（每條以 cells map 包裝）、vertices、echoes、hits、moves。座標、傷害及位移由結算端提供，不由動畫推測。平行射線共享時間；各段依 impact 排序，數字只於命中出現；位移按段插值，支援 slide/arc/swap/fall。六種通用 Canvas 元件：ray/shock/domain/echo/vortex/crash；地面與命中兩層、持續物件、簡化粒子模式。透過既有 tactical-animation/skill-effects/renderer 與 dungeon-skill-animation/map-view 接入可選 V2 payload，不影響舊 V1。回合制 V2 cast 必須以同一動畫事件提供 committed changes，不得再送重複的獨立 damage/move 視覺事件；即時 V2 result 可帶相同 payload。尚無新武器正式事件，個別技能階段才產生並驗證實際效果；音效先沿用既有命中音，不新增音檔。6 項測試、獨立 JS 2558 次斷言通過；完整 CI 與實際新技能畫面待驗收。未公開新武器。

## 第 4 階段 CI 修正

提交 a44b7c9 回歸 3135 項，3134 通過，1 項舊版共用動畫呼叫字串檢查需同步 V2 參數；合作瀏覽器與 Pages 通過。戰術與單人副本瀏覽器等待畫布逾時：新物件繪製提前使用尚未宣告的 actors，將 sample 宣告移至首次使用之前，保留單次取樣。修正後待 CI 驗證。

## 第 5 階段（折光靈劍）

新增 prism-weapon-rules.js：八方向完整射線樹、流光斬三格、法線反射三格、兩層漫射（最多21道）、固定廣度優先順序、每射線大型靈獸去重及各敵人獨立倍率上限240%（同時縮放等級與精煉）。閉角阻擋、牆與邊界停止。初始射線至少一格才可選方向；同一方向任一合法格共用同一個攻擊方案，零長度分支不算攻擊。回合制 cast/previewCast、即時 resolveCast 接入同一計畫與既有權威傷害函式。預覽以方向為單位模擬並重用同方向結果。新武器仍不進入公開目錄、裝備、掉落或API授權。六項測試的第一版曾在獨立JS環境通過358次斷言，批次提交版另外加入同方向結果重用驗證，完整CI尚待確認。V2技能動畫、分層顏色、瀏覽器視覺與公開前驗收留第6階段。

## 第4階段補充回歸修正

提交7a7bf58：回歸3135項、3131通過、4失敗，原因為既有圖層測試把提前的角色座標取樣宣告誤認成角色實際繪製。修正四項測試改以 positions 排序後的角色繪製入口作基準，維持所有圖層限制，未變更顯示效果。戰術瀏覽器及單人副本瀏覽器已恢復通過；武器修煉瀏覽器在768×1100檢查出空白區，增加5秒內等待ResizeObserver版面重排，保留原本16px上限與比例斷言，尚須重跑以確認是否僅為時序問題。第4階段尚未正式驗收。
