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
| 4 共用動畫及特效 | 完成基礎驗收 |
| 5–6 折光靈劍 | 完成私有核心及自動化驗收；正式公開留第19階段 |
| 7–8 鳴鐘圖騰 | 戰鬥機制、V2動畫與專屬鐘聲完成自動化驗收 |
| 9–10 織界靈劍 | 第9–10階段原版CI通過；使用者修訂穿牆及兩次點選，待新CI |
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

## 第4–5階段正式基礎驗收

84b118c 完整回歸 [45919521426](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45919521426)：3141/3141，0失敗；戰術、修煉、單人副本瀏覽器 [45919521483](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45919521483) 全數通過；合作副本於04e4b27 [45919457969](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45919457969) 通過。

## 第6階段（折光靈劍 V2動畫）

共用 prism.timeline 根據權威射線與實際傷害紀錄產生260/440/600ms時間軸；同層並行、子射線在父層碰撞後生成；冰藍/金白/青綠/淡紫色，碰撞閃光與粒子沿用共用引擎。回合制保留原傷害日誌、護盾及反擊，V2動畫以 weaponGroup 去重，完整狀態變化由同一事件呈現。即時副本採相同時間軸與傷害數字。金色選區上加入橙色及紫色次級射線；同一敵人的多段數字錯位顯示，零傷害且無護盾吸收不顯示。戰術命中音最多三個深度節拍，合作副本每次施放最多一次既有命中音。新增三項測試；目前僅語法檢查、完整CI及真實新技能瀏覽器驗收尚待。新武器仍不公開，未新增專屬音檔。各深度採固定共同碰撞時間，長短不同的同層射線以速度調整同步抵達。

## 第6階段接續驗收（2026-11-27）

- 接續基準：219f934a5ba7f00e92b3fbd5d9e3bc9d5fe187f8。既有最後一次完整回歸 3141/3141 為第4–5階段紀錄，不代表第6階段通過。
- 以該提交實際原始碼及遞迴載入的本地相依模組，在隔離 JavaScript 執行環境執行 tests/prism-weapon-animation.test.cjs 的既有三項測試，485 次斷言通過；node:test 與 node:assert/strict 使用輕量測試替身，非 Node 原生完整 CI。
- 提交 4b1c5004638cedd4ad30ca136ba9ba8a453d041c 新增完整21道漫射射線樹的繪製測試：固定障礙地圖、600ms、每10ms取樣、上下兩圖層、一般及簡化特效、有限座標、Canvas save/restore 平衡、傷害文字、分支生成時點及時間軸不變性。四項測試合計57326次斷言全部通過（隔離 JS；Canvas 為記錄式替身，非真實瀏覽器或效能測量）。
- CI 阻礙：GitHub combined status 與僅涵蓋 PR 事件的 workflow 查詢均為空；公開 Actions 頁及 REST 讀取失敗，容器 git ls-remote 無法解析 github.com。故無法確認最新 main push 的 CI、剩餘失敗名稱或靜態版本檢查，亦無法執行真實瀏覽器。沒有刪除測試、降低要求或修改正式戰鬥程式；本輪只改測試與交接文件，不涉及靜態資源。
- 第6階段仍為待完整驗收；未公開新武器。下一步：取得最新 main push Actions run ID，逐一查失敗日誌並修正；補齊真實折光靈劍三技能瀏覽器驗收、角色圖層、幀率/流暢度、音效限制及專屬音效資源的檢查。通過完整回歸及所需驗收後，再依原 V1 進入第7階段鳴鐘圖騰（鳴拳、震鐘、回響），不得簡化逐層傷害、擊退後重判與大型靈獸去重。第7–19階段尚未開始。


### 第 6 階段續作（2026-11-27）
- 已恢復 Actions REST 查詢。基準 `9696b75` 原生 Node 回歸 3145/3145，失敗 0、略過 0，靜態版本通過（run 45921222779）；戰術瀏覽器及 Pages 成功（45921222783、45921222456）；合作副本於原始階段6提交 219f934 通過（45919776628）。
- `d3f80d2c` 新增實際 Chromium 專項 harness，三招、四種 viewport、一般／簡化模式、實際 trial/dungeon renderer、角色層級、傷害時間與 replay 驗證、畫面截圖及耗時；`6b6d5f9` 接入原戰術瀏覽器 workflow。實際瀏覽器結果待 Actions 確認，不能以 fixture 或替身結果替代。
- 本次原子提交補上聚光、碰撞晶體閃光、原創短音效（三個 MP3）、共用 V2 音效節拍（每次施放最多三次，去重、無過期音效積壓），接入兩個 renderer 與既有 QAGameAudio。未公開新武器，未改倍率及既有機制。
- 新增測試後以真實 JS 模組搭配輕量測試斷言執行 5 項 prism 專項測試、61184 次斷言通過；此為隔離驗證，非完整 Node CI。三項音檔已生成並驗證 Git blob SHA，版本表同步；完整 CI 與瀏覽器音效實測仍待確認。
- 第 6 階段仍須檢查最新 Actions 結果，修正任何失敗並完成實機畫面／聲音驗收，之後從第7階段鳴鐘圖騰逐層判定及擊退接續。第7–19階段尚未完成。原始 V1.0 規格不變。

- `72f84b4` 已提交專屬聚光/閃光/音效與版本表。前一提交 `6b6d5f9` 的原生回歸及實際 Chromium（包含折光三招、24種測試情境、截圖 artifact 15164825584）均通過（45921536386、45921536357）。`72f84b4` 原生回歸 3145/3146，唯一失敗為既有音效快取測試寫死 8 個音檔（實際 11）；版本表通過（45922010766）。本次改以實際 SOUNDS 目錄大小驗證請求及解碼數，另驗證請求無重複，保留單一 context；並擴充 Chromium 驗收三個 MP3 的實際解碼/播放、重送去重、靜音及無積壓。待新提交 CI 結果再確認第6階段。人工聽感及實體手機效能不由自動化測試保證。

## 第6階段最終自動化驗收
`dd00f1ce` 原生回歸 [45922134740](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45922134740) 3146/3146、0失敗、0跳過，版本表通過；[45922134775](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45922134775) 全部步驟成功，24種折光畫面測試及真實Chromium音效解碼/播放三次、peakVoices=1、去重、靜音驗收通過。前一功能提交 `72f84b4` 多人合作 [45922010725](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45922010725) 成功。第6階段自動化驗收完成。人工聽感與實體手機效能仍需正式公開前確認；不改原技能。

## 第7階段（鳴鐘圖騰戰鬥機制）
新增 bell-weapon-rules.js，共用鳴拳兩格、震鐘24格（排除自身）、回響四層8/16/24/32格，逐層快照存活敵人、逐段傷害及合法擊退後才查下一層，完整足跡逐層去重。回合制 cast/previewCast/skillPreviewPlan 與即時副本 resolveCast/previewPlan 接入；保留既有傷害、護盾、蓄勢體力、死亡及打斷規則；bellSteps 記錄每層實際傷害與位移。鳴鐘依既有拳法採四方向；外推取足跡中心的主軸、平手水平優先，外側敵人優先、同距離按ID排序；保留既有固定首領不可擊退例外（可移動大型敵人須檢查整個占地）。此為未明訂細節的實作決策，待驗收。新增6項原生測試，涵蓋4/3/2/1次命中、阻牆、死亡、隊友占位、足跡去重、體力不足時預覽不變更原狀態；目前尚未執行完整CI。未公開武器；正式授權/掉落與多人時鐘整合依原階段進行。第8階段須接入V2逐層動畫、實際分段位移、鐘聲與瀏覽器測試。

## 第7階段驗收
提交 `31b95c2` [回歸](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45922463243) 3152/3152、0失敗、0跳過，版本表通過；[戰術及武器瀏覽器](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45922463227)、[多人合作瀏覽器](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45922463248)、Pages 均成功。隔離實際模組6項89次斷言也通過。第7階段完成，保留私有授權門檻。

## 第8階段（鳴鐘圖騰動畫）
鳴拳260ms、震鐘350ms、回響600ms。回響四段命中110/220/330/440ms，以權威 bellSteps 產生獨立波段及位移；每段結束後抵達下一格。V2 group 去重保留反擊、護盾及移動日誌，完整變更含最終座標；即時副本以同一時間軸取樣HP/位移，已死亡靈獸保留至命中而非提前消失。武器效果加銅金拳勁、方形雙輪廓與地面鐘紋。原創程序合成 bell-wave.mp3，940 bytes、SHA校驗相符；四段鐘聲依110ms節拍逐段變調，沿用單一音效管理器。新增3項專項測試、將原Chromium測試擴至六招48種情境並增加四段鐘聲解碼/播放驗證，待CI。未公開武器、未改倍率；真實裝置聽感與手感仍須最後實測。第9階段尚未開始。

## 第8階段最終自動化驗收
提交 `4a6a311` [完整回歸](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45922808352) 3155/3155、0失敗、0跳過，版本表一致；[戰術與武器瀏覽器](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45922808358) 所有步驟成功，六技能、四viewport、兩特效模式48種情境通過，四段鐘聲實際播放4次、peakVoices=2；[合作副本](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45922808328) 成功，[Pages](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45922807862) 成功。隔離實際模組9項34941次斷言全通過（含第7階段6項）。第6–8階段自動化驗收完成，實體裝置手感與人工聽感依第19階段補驗。新武器仍保留私有門檻。下次直接依原 V1 第9階段織界靈劍戰鬥機制接續，使用已完成的 weapon-special-objects.js、weapon-geometry.js 與雙模式共用預覽；不可重做、不可簡化牽絲的任意兩端點或織界的完整內部區域。第9–19階段尚未實作。

## 第9階段（織界靈劍戰鬥機制）
新增 weave-weapon-rules.js，重用共用幾何與特殊物件：刻界八方向直線三格（遇障停止），所選格留下劍痕，FIFO三道、重複不刷新；牽絲枚舉所有有序合法端點對，含任兩道己方劍痕或自身與劍痕，阻牆即拒絕；織界按兩點240%、三點共線280%、凸包內部與邊界320%，排除障礙格、破損邊界拒絕。自身與劍痕重疊合併為同一幾何端點，禁止零長線。共用 resolve 去重占地；回合制與即時副本共用傷害與預覽；API傳輸first與權威房間weaponObjects，保持公開授權目錄不變。新增5項測試，提交前隔離實際模組62次斷言全部通過（非完整Node CI；拆分寫入後仍需原生驗證）。第10階段仍須實作雙端點觸控/取消、高亮、持續劍痕、V2時間軸、動畫音效及實際瀏覽器驗收；特殊物件跨場景及裝備清理仍需正式整合，不宣稱已公開。第9階段等待CI。

## 第9階段自動化驗收
提交 `a4121c6` [完整回歸](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45923375932) 3160/3160、0失敗、0跳過，版本表一致；[戰術瀏覽器](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45923375889)、[合作副本](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45923375880)、Pages 均通過。戰鬥機制、完整區域及端點預計算完成驗收。新武器仍私有。

## 第10階段（織界靈劍介面及動畫）
雙模式接入牽絲端點選擇：點第一端點，突出合法第二端點，點第二端點顯示精確範圍，再點第二端點確認；重點第一端點取消，保留其他技能原點擊流程。以座標重驗權威端點，拒絕非整數座標。300/360/500ms V2 時間軸由實際命中紀錄產生，保留反擊護盾，區域內部翡翠絲紋、雙端向中間編織、劍痕脈動與持續顯示。兩個原創程序合成MP3（627/784 bytes，SHA與本地編碼一致），沿用音效管理與節拍去重。試煉結束/離場清除物件，合作副本跨場景與裝備清理尚待整合。新增3個單元測試，擴充Chromium至九招、72個畫面情境、手機/平板畫布實際觸控及新音效播放；尚未取得第10階段CI結果，不標記驗收完成。測試使用私有技能fixture，不等於公開玩家已獲得武器。第11–19階段尚未開始。

## 第10階段 CI 修正
`9dd72ab` 原生回歸 3161/3163，兩項失敗：[45923904233](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45923904233)。修正舊劍痕無 sequence 時脈動 alpha 為 NaN 的相容問題，並更新舊副本輪盤測試使其驗證實際六參數 castDungeonSkill（含 first），不刪除測試。版本表同步。該提交的[戰術與私有武器 Chromium](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45923904169)、[合作副本](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45923904206)及 Pages 均成功。修正後須重新核對最新全部 CI，才標記第10階段完成。第11–19階段尚未接入 main；依 V1 順序續作，保持新武器私有，合作副本跨場景、裝備清理與實體裝置驗收尚待。

## 第10階段驗收與使用者修訂（2026-11-27）
修正提交 `aff7b16` 的[完整回歸](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45924138800)、[戰術瀏覽器](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/45924138844)與 Pages 均已成功。使用者要求「可以穿牆並且減少選擇步驟」，本次僅修訂織界靈劍：牽絲、織界的幾何連線與區域跨牆，仍排除牆格/地圖外及非法劍痕端點；刻界三格射線保留遇障停止。沿用共用幾何，不改其他武器穿牆規則。牽絲點第一端點後顯示合法第二端點，點第二端點直接施放，重點第一端點取消；無體力不得施放。多人即時副本在送出時清除已確認的端點，避免重複點擊同一組合。倍率、體力、FIFO、保留劍痕、每敵去重均不變。更新V1第6節相關規則（明示使用者修訂）、技能文案、雙模式操作提示、原生及Chromium測試；新增穿牆兩模式一致性測試。隔離執行9項專項測試38072次斷言通過，非原生CI；最新提交完整Actions待驗。第11–19階段尚未開始，維持新武器私有，合作副本生命週期及實體裝置仍待後續驗收。
