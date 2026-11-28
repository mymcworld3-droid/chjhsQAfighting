# 單人武器副本 V4 開發進度

規格：[weapon-dungeons-v4.md](weapon-dungeons-v4.md)。萬獸險域尚未開放。

## 第 1 階段：共通連續行動機制（已驗收）

- 基準 main：922a1699a6b3374a8277ebb4f0f9e3fcfb2808d5。
- 規劃保存：074b3c4bc9dc53700f17856a1e1fd62686d4a9a2（將使用者貼上的 V4 轉為 Markdown，保留 13 章、九階段、地圖草案、提示詞及驗收清單，非逐字原始檔）。
- 修正既有單人石域普通靈獸及 2×2 領主：使用既有已顯示預告結算一次，再追擊最多一格，立即準備下一次；攻擊落空亦追擊；成功擊退取消攻擊，下一次行動恢復追擊。領主不再落入一般 boss 移動分支而漏掉追蹤攻擊。
- 重用占位、傷害、追蹤及動作事件；領主反傷死亡、引力效果或玩家死亡時停止剩餘敵方行動。玩家回合開頭引力打斷不被下一次預告覆蓋。其他模式沿用既有分支。
- 新增 5 個確定性測試：普通與大型領主連續循環及 JSON 恢復、追擊及落空、擊退後重啟、完整占位阻擋、反傷擊殺領主停止後續行動。
- 基準 CI 的既有失敗：一般回歸 46097621387、候選版 46097621377；瀏覽器 46097621327、Pages 46097620455 成功。失敗為 Peak Stone legacy desert terrain 測試將 API 公開 actors（剔除 knowledgeScope）與原始私有 actors 比對；修正為同層比對並額外保留原始存檔完整性斷言，不改動公開資訊過濾或遊戲規則。
- 修改：public/cultivation/tactical-rules.js、tests/weapon-dungeons.test.cjs、public/module-versions.json、本文件。
- 測試命令：node --test tests/weapon-dungeons.test.cjs；npm run test:battle；npm test；npm run check:module-versions。
- 本地環境無法解析 github.com，無法下載完整儲存庫並執行 Node 測試；使用 GitHub Actions 驗收。尚未確認新提交 CI 結果，不能標記完成。
- 下一步：取得包含本修改的實際提交 SHA 及最新 CI，修正任何失敗；全部必要回歸通過後開始第 2 階段共用靈獸技能架構。第 3 階段才加入四種劍法技能；第 4 階段才建置隱藏萬獸險域。

### 提交與 CI 查核

- 程式與回歸測試提交：[ebbf5b32519f36f5074e117c56d265deb6f4a832](https://github.com/mymcworld3-droid/chjhsQAfighting/commit/ebbf5b32519f36f5074e117c56d265deb6f4a832)，已確認 main 指向該提交。
- GitHub Actions 查核：Cultivation regression tests：in_progress / 未結論（46106093401）；Tactical browser acceptance：in_progress / 未結論（46106092805）；New weapon release candidate acceptance：in_progress / 未結論（46106092826）；pages build and deployment：in_progress / 未結論（46106092636）
- 仍須在此階段完成最新 CI 及必要測試；下一次先補驗收，不直接跳到第二階段。

### 第一階段結案（2026-11-28）

- 最新文件提交 870e97a2f486a3dcc611d4dcb8f3a252d6aad088：完整回歸 [46106112726](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46106112726) 成功，3280 項／3279 通過／0 失敗／1 跳過；靜態版本表一致。瀏覽器 [46106112733](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46106112733) 與 Pages [46106112665](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46106112665) 均成功。
- 程式提交 ebbf5b3 的完整回歸、瀏覽器及候選版 [46106092826](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46106092826) 成功；該提交 Pages 被後續部署取消，最新 870e97a Pages 成功。後續提交僅修改文件，未改程式。
- 第一階段結案，開始第二階段。

## 第 2 階段：共用靈獸技能架構（已驗收）

- 將單人副本連續行動入口與追蹤旗標解耦，普通、精英及 2×2 領主共用；尖峰石域仍使用既有落石/尖峰崩裂，保留原射程、倍率與移動規則。
- server layout 可配置有順序的 dungeonSkills；技能資料包含 ID、名稱、形狀、射程、倍率、追蹤/鎖定、動畫、領主與難度限制、位移、擊退及層數。僅選擇當前能命中的合法技能。
- 共用 blast/point/line/cone/square 幾何；直線重用 line、扇形重用 monsterCells、方形外圈重用 weapon-geometry squareRing 並以完整占位計算。v3 intent 保存技能、方向、路徑、格位及波次，鎖定預告不重算；追蹤只刷新同一技能，結算時不偷偷重瞄。舊 v2 已預告落石可直接結算。
- 位移使用既有 canOccupy 與 push；大體型檢查完整占位，實際擊退取消預告；逐層結算依最新玩家位置，終局立即停止。
- 新增六項確定性回歸案例（選招限制、鎖定及 JSON 恢復、追蹤不換技、2×2 幾何、位移碰撞及擊退、舊預告恢復）。未新增公開技能或萬獸險域。撞牆傷害與推動式衝撞屬第五階段，正式震波及動畫屬第六/七階段。
- 修改：public/cultivation/tactical-rules.js、tests/weapon-dungeons.test.cjs、public/module-versions.json、本文件。
- 測試命令：node --test tests/weapon-dungeons.test.cjs；npm run test:battle；npm test；npm run check:module-versions。待本次 CI，未確認測試全部通過。
- 下一步：第二階段 CI 驗收及修正，通過後才實作第三階段四種劍法。

### 第二階段提交與 CI 查核

- 程式提交：[45e212883915ada95a967b9e96d02014dc47f886](https://github.com/mymcworld3-droid/chjhsQAfighting/commit/45e212883915ada95a967b9e96d02014dc47f886)，已確認 main 已包含本次變更。
- [Tactical browser acceptance](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46107114687)：in_progress / 未結論；[New weapon release candidate acceptance](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46107114726)：in_progress / 未結論；[Cultivation regression tests](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46107114697)：in_progress / 未結論；[pages build and deployment](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46107114429)：in_progress / 未結論
- 本地 Node v22.16.0 可用，但 git ls-remote 無法解析 github.com，未能取得完整工作樹執行本地測試。等待上述 GitHub Actions 結果；第二階段尚未正式結案。

### 第二階段追加驗收（2026-11-28）

- 基準 main：e4b9fdb64fcf3e2d5ff25980193f9eaba4d95539，僅文件提交，程式與 45e212883915ada95a967b9e96d02014dc47f886 相同。
- [最新完整回歸 46107146151](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46107146151)：3286 項，3285 通過、0 失敗、1 跳過；module-versions.json 一致。[程式提交完整回歸 46107114697](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46107114697) 亦成功。
- [候選版 46107114726](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46107114726) 的 candidate-regression（job 140862223822）：3286 項，3285 通過、0 失敗、1 跳過；靜態版本一致。最近一次 job 查核 12/15 成功、0 失敗，尚有 tactical browser 與兩組六階武器實戰平衡未完成。
- [最新 Pages 46107145792](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46107145792) 成功；程式提交的 Pages 46107114429 被取消，不將取消當作通過。
- 本次最後查核：[Tactical browser acceptance 46107146152](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46107146152)：in_progress / 未結論；[Tactical browser acceptance 46107114687](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46107114687)：in_progress / 未結論；[New weapon release candidate acceptance 46107114726](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46107114726)：in_progress / 未結論。
- 已檢查第三階段可重用入口：weapon-dungeon-rules.js 副本配置、tactical-rules.js 的 dungeonSkillPlan / dungeonIntent / weaponDungeonMonsterTurn、tactical-renderer.js 的 line / cone / meteor 特效、tactical-skill-effects.js 的劍法效果。正式四技、分工、數值、舊房間相容策略及動畫驗證尚未實作；依 V4 不越過第二階段 CI 門檻。
- 此批只更新驗收證據，不改戰鬥程式、不刪除測試。下一次先確認上述未結論 CI 及最新 main；若失敗修正後重跑，全部通過才開始第三階段。

### 第二階段正式結案（2026-11-28）

- 基準 main 7bb78031419df2dd2e97c761bff071c031ced34d；最新完整回歸 [46107314075](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46107314075)、瀏覽器 [46107314077](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46107314077)、Pages [46107313121](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46107313121) 均成功。程式提交 45e2128 的候選版整合驗收 [46107114726](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46107114726) 全部成功；先前未結論的兩次瀏覽器驗收亦成功。第二階段結案。

## 第 3 階段：尖峰石域劍法（已驗收）

- 新開副本配置直線劍氣（5 格）、橫掃斬擊（3 格扇區）、穿刺突進（3 格、最多 2 格技能位移）、領主劍雨（4 格瞄準、曼哈頓半徑 2）；倍率暫沿用 1，未調整血量/普通移動/基礎傷害。上述射程為暫定值，最終待第八階段平衡。
- 巖獸使用橫掃及穿刺；石靈使用直線及橫掃；守衛使用穿刺及直線；領主四技。從上次已施展技能之後循環尋找合法選項，不改已預告的技能；不合法則正常追擊。
- 穿刺以完整占位逐格檢查，攻擊格為合法路徑前緣及停止點前一格；結算時只可縮短既存預告，不能穿過牆、其他單位、或偷偷延長路徑。保存路徑及技能選擇。成功擊退沿用共用打斷。
- 既有存檔未配置新技能者保留舊落石，避免更新改變既有預告或進度；新開副本使用四技。地圖、獎勵、進度及圖騰加成不改。
- 四個獨立動畫 ID，重用既有 Canvas 劍法光束、斬擊與位移，劍雨逐格落下；傷害動畫使用實際事件及格位。入口特色文字與靈獸資料同步。
- 新增六項回歸，涵蓋正式配置、四技能傷害及動畫事件、追蹤方向與遮蔽、扇形及劍雨、2×2 路徑碰撞、技能循環；保留既有測試。
- 修改：public/cultivation/tactical-rules.js、public/cultivation/weapon-dungeon-rules.js、public/cultivation/tactical-skill-effects.js、public/cultivation/tactical-animation.js、tests/weapon-dungeons.test.cjs、public/module-versions.json、本文件。
- 待 CI：npm test、npm run test:battle、npm run check:module-versions、瀏覽器及候選版驗收。未完成最新 CI 前不得宣稱第三階段正式驗收；下一階段為隱藏萬獸險域基礎建置。

- 補強：穿刺位移動畫同樣使用劍法速度線，新增四技（含穿刺）擊退打斷及實際動畫路徑辨識斷言。

### 第三階段提交與 CI 查核

- 主要實作提交 [baf81494bdbd0dc3a4aef9ef1ec0a13f65f751d0](https://github.com/mymcworld3-droid/chjhsQAfighting/commit/baf81494bdbd0dc3a4aef9ef1ec0a13f65f751d0)；補強動畫及測試 [f20180a3b7126a25ea29b7d2a3a0db293a085d81](https://github.com/mymcworld3-droid/chjhsQAfighting/commit/f20180a3b7126a25ea29b7d2a3a0db293a085d81)，均已直接更新 main。
- 首次程式提交：[Cultivation regression tests](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46110995091) completed / success；[Tactical browser acceptance](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46110995134) in_progress / 未結論；[New weapon release candidate acceptance](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46110995120) in_progress / 未結論；[pages build and deployment](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46110994689) completed / cancelled。
- 最新程式提交：[Tactical browser acceptance](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46111036453) in_progress / 未結論；[pages build and deployment](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46111036213) in_progress / 未結論；[New weapon release candidate acceptance](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46111036435) queued / 未結論；[Cultivation regression tests](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46111036378) in_progress / 未結論。
- 本地完整工作樹仍未取得，尚無本地 Node 測試結果；已觸發 GitHub Actions。必須確認最新程式提交及後續 main CI 成功，修復所有失敗，才能標記第三階段已驗收及開始第四階段。萬獸險域未開放。

### 第三階段 CI 修正

- 858b969 最新回歸 46111072913 與 f20180a 回歸 46111036378、候選版 regression 140874394638 皆出現同一失敗：四技擊退測試的穿刺案例將崩山拳目標設成距離兩格的靈獸，而非相鄰方向格；遊戲正確拒絕該指令。修正為合法相鄰方向，增加瞄準合法性與實際位移斷言，保留四技能 stagger、無傷害與既有測試。不改任何戰鬥規則。
- 修正後須重跑完整回歸、候選版、瀏覽器及部署驗收；未全數通過前不得開始第四階段。

### 第三階段修正後追加驗收（2026-11-28）

- 修正提交 [e140d50f862156396c958c638500304777c9325b](https://github.com/mymcworld3-droid/chjhsQAfighting/commit/e140d50f862156396c958c638500304777c9325b)：完整回歸 [46111230150](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46111230150) 和候選版 regression job 140875000726 均為 3292 項、3291 通過、0 失敗、1 跳過，靜態資源版本一致。四技擊退測試已通過；未刪除測試。
- [Tactical browser acceptance 46111230179](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46111230179)：in_progress / 未結論；[New weapon release candidate acceptance 46111230218](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46111230218)：in_progress / 未結論；[Cultivation regression tests 46111230150](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46111230150)：completed / success；[pages build and deployment 46111229261](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46111229261)：completed / success。
- 候選版工作 12/15 成功，未結論：candidate-browser (tactical)、candidate-balance (5)、candidate-balance (10)。最新已完成工作無失敗。
- 第四階段預檢：weapon-dungeon-rules.js 的 CATALOG、progressFor/recordClear 與 layout；tactical-combat-api.cjs 的 start/weaponDungeonState 已共用原子扣券及重送憑證；weapon-dungeon-rewards.cjs 已依權威目錄限制掉落流派。須將隱藏目錄與可公開目錄分離，僅允許伺服器可信測試設定進場，禁止客戶端自行開啟。舊 peak-stone 存檔仍維持頂層 unlocked/clears，萬獸險域獨立 byDungeon。沙地圖集索引 13，石域遷移已限定 peak-stone；初步素材使用玄甲山豬 species 1、巖甲獸 species 8，領主可採現有大型巖獸，正式造型待第七階段。需修正僅對相應武器流派生效的環境倍率，避免新副本沿用舊圖騰預設 1.15。
- 尚未寫入第四階段戰鬥或副本資料；依要求全部最新第三階段 CI 通過才開工。本次僅補記驗收證據與預檢，不公開萬獸險域。

### 第三階段正式結案（2026-11-28）

- 修正程式 e140d50 的完整回歸 46111230150、瀏覽器 46111230179、候選版 46111230218（15/15）及 Pages 46111229261 全部成功。最新文件 50e5cfb 的回歸 46111441978、瀏覽器 46111442014、Pages 46111441727 亦全部成功。第三階段正式結案。

## 第 4 階段：萬獸險域基礎建置（已驗收）

- 技術 ID beast-wilds。公開 catalog/selection 預設排除 hidden；僅伺服器註冊時明確傳 allowHiddenWeaponDungeons:true 可進場及列出測試副本，客戶端 body/query 不能開啟。正式 register 預設 false，無環境自動開啟或公開按鈕。
- 11×15 沙地索引 13，主畫面繪製時僅新副本加赤紅色調；舊石域遷移仍只作用於 peak-stone。種子鏡像與三種側翼障礙配置、領主上下變化；出生點 (5,13)，領主最近占位距離六/七格，六隻普通靈獸三衝撞型三震波型，暫沿用山豬 species 1、巖甲獸 species 8 及大型巖獸素材。
- 共用原子進場、扣券、重送與結算；六階獨立 byDungeon，尖峰石域頂層進度保留。內部權威 CATALOG 支援隱藏圖騰掉落池，30/20/50 及空池規則不變；公開 API 不暴露隱藏進度。弦修預留 weaponType bow +15%，不新增弓系武器；萬獸圖騰倍率 1，保留尖峰舊存檔圖騰 1.15。
- 暫定敵人數值沿用尖峰基礎倍率；開發測試用近身鎖定試擊只用於隱藏副本，並非正式衝撞或震波。第五階段逐格衝撞/推動/撞牆，第六階段方形震波及 AI，第七階段完整美術。不得提前公開。
- 新增五組測試：API 隱藏限制與可信開發進場、六階 48 種子完整占位及閃避、共用票券與六階實際通關及防重複、圖騰掉落及空池、環境加成隔離及實際武器傷害。
- 修改 public/cultivation/weapon-dungeon-rules.js、public/cultivation/tactical-rules.js、public/cultivation/tactical-renderer.js、tactical-combat-api.cjs、tests/weapon-dungeons.test.cjs、public/module-versions.json、本文件。待 npm test、npm run test:battle、npm run check:module-versions、瀏覽器、候選版及 Pages 驗收。未確認最新 CI 前不得宣稱完成；萬獸險域仍隱藏。

- 補強：共用戰場介面改用同一傷害倍率函式、依副本顯示領主、追蹤/鎖定預告、弦修加成與結算文案；保留石域原本結算文字。新增既有 Chromium 驗收腳本內的公開 HTTP 進場拒絕及可信測試路由進入萬獸險域、共用扣券與實際地圖檢查，不移除原石域驗收。

### 第四階段提交及 CI 查核

- 基礎實作 [723839182dfda79e50391101f15f36c4abe2a1ca](https://github.com/mymcworld3-droid/chjhsQAfighting/commit/723839182dfda79e50391101f15f36c4abe2a1ca)：完整回歸 46112148156 成功（3297 項、3296 通過、0 失敗、1 跳過；靜態版本一致）。[Tactical browser acceptance 46112148247](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46112148247) in_progress/未結論；[New weapon release candidate acceptance 46112148204](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46112148204) in_progress/未結論；[Cultivation regression tests 46112148156](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46112148156) completed/success；[pages build and deployment 46112147574](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46112147574) completed/success。
- UI 與真實瀏覽器驗收補強 [87a90fb08025ea5b56ac0adc19a9681b251c8968](https://github.com/mymcworld3-droid/chjhsQAfighting/commit/87a90fb08025ea5b56ac0adc19a9681b251c8968)：查核時尚未列出 workflow run。不能以基礎提交成功代替最新驗收。
- 本地完整工作樹不可用，Node/Chromium 驗收以 GitHub Actions 為準。待全部最新 CI 成功才進入第五階段；萬獸險域正式進場仍關閉。

### 第四階段 CI 修正（2026-11-28）

- 基礎提交 7238391 的回歸 46112148156、瀏覽器 46112148247、候選版 46112148204、Pages 46112147574 全部成功。
- 補強提交 87a90fb 的瀏覽器 46112267896 成功；候選版 46112267877 共 14/15 成功（含 tactical/coop 及十二組實戰），僅 candidate-regression 失敗；一般回歸 46112267890 及最新文件 d3e7baf 回歸 46112268565 同一失敗。最新文件瀏覽器 46112268571、Pages 46112268442 成功（補強提交 Pages 被取代取消）。
- 失敗根因：tests/manual-damage-description.test.cjs 仍用兩個舊硬編碼 body/圖騰加成正規式。修正為精確驗證兩處 UI 均呼叫共用 R.dungeonDamageMultiplier 並以武器目錄的 weaponType 選擇；原有其他斷言全部保留，另增實際傷害說明測試（無副本、舊存檔、石域、萬獸、弦修預留）。不改任何戰鬥規則或降低標準。
- 修正後重跑最新 CI，全部必要驗收通過才開始第五階段。萬獸險域仍隱藏。

### 第四階段正式結案（2026-11-28）

- 修正提交 7437438 的完整回歸 [46113718535](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46113718535)、候選版 [46113718542](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46113718542)、真實瀏覽器 [46113718530](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46113718530)、Pages [46113718146](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46113718146) 全部成功。第四階段結案。

## 第 5 階段：蠻獸衝撞（已驗收）

- 三隻赤鬃蠻豬與 2×2 領主配置鎖定 charge；普通最多三格、領主四格、基本傷害倍率 1、撞牆額外倍率 .5，均為第八階段待調整的暫定數值，不改尖峰石域。震波型仍用階段四測試攻擊，階段六替換正式震波。
- 選擇可命中玩家的四向合法完整掃掠占位；預告保存固定方向、路徑、最大距離、全部格位及倍率。玩家移動不重瞄；結算僅縮短原有路徑，逐格檢查最新地形、其他靈獸、完整占位及玩家。單次技能首次接觸造成一次基礎傷害；後續每步持續推動，不重複基礎扣血。岩壁/邊界造成一次額外碰撞傷害並停止，其他角色阻擋只停止、不追加傷害或連鎖推動。死亡、反傷通關立即停止；保留共通攻擊後普通移動與再準備、實際擊退打斷及舊房間技能快照。
- 伺服器同步推動兩者，記錄每步共同移動事件；Canvas 基礎蓄力、速度線與撞牆火花分別由實際事件繪製，完整沙塵美術留第七階段。
- 新增七組確定性測試：配置分工、鎖定/閃避/JSON 恢復、連續推動/單次傷害/動畫、牆壁/邊界/其他單位、2×2 雙道阻擋、合法擊退打斷、反傷終局。
- 修改 public/cultivation/weapon-dungeon-rules.js、public/cultivation/tactical-rules.js、public/cultivation/tactical-animation.js、public/cultivation/tactical-skill-effects.js、tests/weapon-dungeons.test.cjs、public/module-versions.json、本文件。待 npm test、npm run test:battle、npm run check:module-versions、瀏覽器、候選版及 Pages；最新 CI 未完成前不結案、不公開萬獸險域。

### 第五階段提交及 CI 查核

- 實作提交 [8d1253e99dbb9cd35d92b6502fcdc5f43560d7b3](https://github.com/mymcworld3-droid/chjhsQAfighting/commit/8d1253e99dbb9cd35d92b6502fcdc5f43560d7b3)。2026-11-28T07:58:27.4718657Z module-versions.json 與靜態資源一致；2026-11-28T07:59:01.5894198Z # tests 3305；2026-11-28T07:59:01.5894595Z # pass 3304；2026-11-28T07:59:01.5894791Z # fail 0；2026-11-28T07:59:01.5895177Z # skipped 1。
- [Tactical browser acceptance 46123600978](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46123600978)：in_progress/未結論；[New weapon release candidate acceptance 46123600950](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46123600950)：in_progress/未結論；[Cultivation regression tests 46123600923](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46123600923)：completed/success；[pages build and deployment 46123600504](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46123600504)：completed/success。
- 本地完整工作樹不可用，以 GitHub Actions 執行驗收。七組新增測試已納入完整回歸。候選版、瀏覽器、部署與最新文件提交 CI 均須確認成功後才開始第六階段；不提前公開萬獸險域。

### 第五階段正式結案（2026-11-28）

- 8d1253e 的回歸 46123600923、候選版 46123600950、瀏覽器 46123600978、Pages 46123600504 均成功；最新文件 7f40da4 的回歸 46123682334、瀏覽器 46123682239、Pages 46123681635 皆成功。

## 第 6 階段：方形震波及靈獸 AI（已驗收）

- 重用鳴鐘圖騰的 squareRing/squareArea 幾何及 outward 方向規則：震地兩層聯集只命中一次，連環震地四個互斥外圈依序讀取當前玩家位置，每層最多一次傷害及一格合法擊退。2×2 領主以完整占位最短 Chebyshev 距離及占位中心向外推動，阻擋不重複命中，反傷或死亡立即停止。每層獨立實際事件及基礎方形動畫，未更動玩家鳴鐘圖騰。
- 新房間全部正式配置：三赤鬃蠻豬衝撞、三裂地蠻牛震地（合體/渡劫另可衝撞）、領主三技能。舊測試房間保留技能快照。萬獸仍 hidden。
- 暫定六階：普通衝撞 3/3/4/4/5/5 格，領主 4/4/5/5/6/6 格；震地 0.8+0.03*d，連環震地每層 0.45+0.03*d（d=0..5）。化神起領主每第三次合法擊退抵消一格、渡劫每第二次；合體裂地蠻牛每第四次、渡劫每第三次。只有實際位移才打斷；不適用其他副本或非推動技能。合體起領主可連續兩個各自完整預告的衝撞，之後需換招。
- 新房間於玩家回合開始、所有敵人位移完成後，逆行動順序選擇下一次鎖定預告；金丹起優先合法震波推入後續已預告衝撞線；穩定行動順序不變。每次加入預告保留四步內至少一個不在聯集危險格的可達位置。四步是暫定體力預算，不代表任何剩餘體力或主動站位都必然安全；第八階段進行完整答題成本及實戰平衡。保留 stagger，不在玩家行動中重瞄。
- 新增八組測試：震地單次/完整占位、四層結算和動畫、阻擋及閃避、擊退及反傷終局、六階與抵抗、連續衝撞限制、多種子安全格及實際閃避、震波衝撞配合；原階段五配置斷言更新為正式震地，保留其餘全部測試。
- 修改 public/cultivation/weapon-dungeon-rules.js、public/cultivation/tactical-rules.js、public/cultivation/tactical-skill-effects.js、public/cultivation/tactical-combat.js、tests/weapon-dungeons.test.cjs、public/module-versions.json、本文件。待 npm test、npm run test:battle、npm run check:module-versions、瀏覽器、候選版及 Pages，最新 CI 全通過才進入第七階段。數值暫定，美術及完整平衡留後續階段。

### 第六階段提交及 CI 查核

- 實作提交 [acc1c8fc0ffb4e61d082ff1cb023c78a5994317d](https://github.com/mymcworld3-droid/chjhsQAfighting/commit/acc1c8fc0ffb4e61d082ff1cb023c78a5994317d)，完整回歸 46124234668（job 140915133774）：3313 項、3312 通過、0 失敗、1 跳過，靜態資源版本一致；八組新增測試均成功。
- [New weapon release candidate acceptance 46124234634](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46124234634)：in_progress/未結論；[Tactical browser acceptance 46124234657](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46124234657)：in_progress/未結論；[Cultivation regression tests 46124234668](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46124234668)：completed/success；[pages build and deployment 46124233974](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46124233974)：completed/success。候選版已通過 10/15，失敗 0。
- 本地完整工作樹仍不可用，以 GitHub Actions 驗收。第七階段須先確認最新提交全部 CI、修復任何失敗，再完成入口浮空島素材、透明背景、沙塵與方形震波視覺、鎖定預告、共用名稱牌、手機平板適配；不得提前公開。

### 第六階段正式結案（2026-11-28）

- acc1c8f 的回歸 46124234668、候選版 46124234634（15/15）、瀏覽器 46124234657、Pages 46124233974 全數成功；b547f9b 的回歸 46124329725、瀏覽器 46124329757、Pages 46124329436 全數成功。

## 第 7 階段：美術及介面（自動化驗收通過）

- 萬獸赤砂色調、地面砂粒及砂岩細節、低伏蓄勢、踏地沙塵、衝撞尾跡、撞牆震動、方形金銅震波；以伺服器每層事件同步傷害演出，不改戰鬥規則。預告格新增方向、方形、波次及追蹤標記，均在角色下層；新增預告回歸。
- 浮空島已生成 1312×1199 RGBA PNG（透明 Alpha 0–255），但本地 GitHub DNS 不可用且 GitHub 連接器只接收 base64 字串、無法直接接收生成檔案，尚未提交原圖。保持既有安全 fallback，不建立破圖路徑；須補上 public/assets/dungeons/beast-wilds.png、atlasArt 對應、資源版本及原圖風格/透明度驗收才可結案。未公開萬獸險域，不提前開始第八階段。
- 修改 public/cultivation/tactical-threat-visuals.js、public/cultivation/tactical-renderer.js、public/cultivation/tactical-animation.js、public/cultivation/tactical-skill-effects.js、tests/tactical-threat-visuals.test.cjs、靜態版本及進度文件。待 npm test、npm run test:battle、npm run check:module-versions、Chromium、候選版及 Pages。

- 介面補強：入口目錄以伺服器回傳為準，初始僅顯示非 hidden 項目，可信開發路由仍可顯示萬獸。沿用共用名稱牌，手機雙島排列、沙地場景、鎖定形狀、格數、層數與抗性資訊。新增五種視窗的開發入口與難度頁實際 Chromium 測試。正式 PNG 尚未接入，暫用既有 fallback；不得將 fallback 的驗收宣稱為正式素材驗收。

### 第七階段原始美術接入（2026-11-28）

- 803bb22 戰場美術及 fdcda07 介面實作；fdcda07 完整回歸 46125038414（3314 項、3313 通過、0 失敗、1 跳過）、候選版 46125038333、Chromium 46125038352、合作副本 46125038382、Pages 46125038256 均成功。
- 原圖透過私人 Drive 暫存檔完整轉入 GitHub blob 127e3712190a0674638cdd66e7bdf4cba64fd175，本地 git hash-object 相同；原始 SHA-256 fb3155ca077f469f94a2a98c36c81bc5a2230f5bbbb6eeb686b28a0940468818、1952364 bytes、1312×1199 RGBA，未縮圖或轉碼。新增 public/assets/dungeons/beast-wilds.png 與 atlasArt，沿用原共用名稱牌，更新 module-versions.json。
- 真實 Chromium 新增入口及難度頁的原始圖路徑斷言、解碼尺寸、完整透明/不透明像素檢查；保留五種視窗及原有公開 HTTP 拒絕測試。待最新 CI 全數成功才正式結案；萬獸險域仍 hidden，不提前開始第八階段。

### 第七階段 CI 結案（2026-11-28）

- 實際原圖接入提交 [beeb69e18b4c123d6d196cc2cf79e150706d2445](https://github.com/mymcworld3-droid/chjhsQAfighting/commit/beeb69e18b4c123d6d196cc2cf79e150706d2445)。同一 SHA 的完整回歸 [46130040051](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46130040051) 成功：3314 項、3313 通過、0 失敗、1 跳過，靜態版本一致；真實瀏覽器 [46130040114](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46130040114)、候選版 [46130040100](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46130040100)（15/15，含合作與戰術 Chromium）、Pages [46130039485](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46130039485) 均成功。原圖透明度、解碼尺寸、入口/難度頁及五種視窗已通過自動化驗收。前面待上傳/fallback 的紀錄為歷史狀態，不再適用。未獨立人工目視比較原圖風格；第九階段須保留實際視覺驗收。萬獸仍隱藏。

## 第 8 階段：實戰平衡（8A 基線已提交，未完成驗收）

- 讀取 V4、進度、美術三份規格及 AGENTS.md；正式公開目錄 RELEASE_NEW_WEAPONS=true，十二把武器。沿用 scripts/lib/tactical-balance.cjs 的 production R.create/R.apply/R.answer 及既有十二分片 CI，未刪除原 Stage 19 的試煉或石域案例。
- 提交 [f2bda522f60a217960f6be8f5eda2a6393964aa3](https://github.com/mymcworld3-droid/chjhsQAfighting/commit/f2bda522f60a217960f6be8f5eda2a6393964aa3)，修改 scripts/accept-new-weapon-balance.cjs；新增 12 單武器與 8 代表雙武器配置 × 2 副本 × 6 階 × 3 種子 × 2 答題正確率 = 1440 個基線案例，固定攻擊 200、生命 1000、技能等級 1、精煉 0；70%/100% 為答對概率而非保證每場實際比例。此為同條件比較，非全玩家養成梯度或最優策略。原 Stage 19 報告 rows 保留，v4.rows 記錄新增逐場資料。
- 新增紀錄：勝負原因、回合、答題與答對/錯題、體力/移動/技能準備消耗、實際敵方 HP 減少、己方操作間淨 HP 減少/恢復（不是逐段毛傷害）、實際擊退與打斷、離開預告格、結束回合仍在預告及當時可達安全格狀態、施放各技能次數。安全格診斷以當前體力及預告聯集為準，不能單憑無安全格就宣稱整個回合無解；石域追蹤會隨移動重算。仍需核對特殊技能確實被策略使用，並對召劍獨立飛劍移動、連環震波及雙武器特殊協同補專項實戰；通過既有規則測試不等同通過平衡。
- 權威掉落池靜態盤點（manual-rules.js + weapon-dungeon-rewards.cjs）：煉氣劍為流風/折光，築基劍為御靈/織界，金丹劍為八方/歲輪；煉氣圖騰為玄嶽/鳴鐘，築基圖騰為伏虎/蜃影，金丹圖騰為龍象/星隕。元嬰、化神、合體、渡劫兩流派均空池。因此依當階30%、低階20%、無武器50%規則，兩副本六階實際武器掉落概率均為50/50/20/0/0/0%。不新增武器、不重抽、不調整概率。新增對每副本難度逐一枚舉 0..99 抽選值並呼叫真實 Rewards.roll，檢驗空池不重抽及流派隔離；執行結果待 CI。
- 測試指令：node scripts/accept-new-weapon-balance.cjs <shard> 12 /tmp/stage19-balance-<shard>.json；既有 workflow 上傳同名 artifact（新增 v4 欄位）。完整回歸及靜態版本由既有 workflow 執行。
- 本次查核 f2bda52 的候選版 [46130703492](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46130703492)、瀏覽器 [46130703519](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46130703519)、回歸 [46130703569](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46130703569)、Pages [46130702062](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46130702062) 尚在執行、無結論。本地 git ls-remote DNS 失敗，無法取得完整工作樹，因此不可宣稱 1440 場已完成。未改任何戰鬥數值（尚無完整可重現的 V4 基線，不做無證據調整），未公開萬獸險域。
- 下一批 8B：先取得十二分片實際逐場資料、驗證 1440 案例完整性及 CI，分副本/難度/武器/正確率匯總勝率、回合、答題、體力、傷害、失敗原因及特殊技能覆蓋，補強專項策略與養成梯度，定位數值問題後逐項調整並以相同種子重跑對照；全部必要驗收通過才進入第九階段。

### 第八階段 B：基線收集與統計修正（部分完成，2026-11-28）

- 已重新讀取 V4、進度及美術文件。f2bda52 的回歸 46130703569 成功；候選版 46130703492 的 candidate-regression、合作及 tactical 瀏覽器均成功，平衡分片 0/1/2/3/4/8/9/11 成功，5/6/7/10 未結論，未見失敗。012a20e 的回歸 46130759823、瀏覽器 46130759809、Pages 46130759762 全部成功。舊 Pages 被後續部署取代而取消，不視為成功。
- 已從成功分片 job log 提取 936/1440 場 V4_BALANCE JSON，逐分片核對預期行數、全局鍵（武器組合/副本/難度/種子/答對概率）無重複。提交 [c06f9c4a99b4d982c8232b18757913475448f238](https://github.com/mymcworld3-droid/chjhsQAfighting/commit/c06f9c4a99b4d982c8232b18757913475448f238)：docs/balance/weapon-dungeons-v4/baseline-f2bda52/ 的 shard-*.json 以 columns/rows 無損保存逐場欄位，summary.json 記錄來源 job ID、全場/勝場均值、分副本/難度/配置/答題概率/交叉組別、失敗原因與技能使用次數。其餘 504 場未取得，不能宣稱完整驗收。
- 部分數據（每副本 468 場）：尖峰 438 勝（93.59%）、平均 7.1 回合、14.1 題、48.6 體力、186.5 操作間淨 HP 減少、6.5 強制位移、1.5 離開預告格；萬獸 450 勝（96.15%）、5.6 回合、11.2 題、39.1 體力、184.0 HP 減少、5.6 位移、3.4 離開預告格。48 場失敗均為 HP 耗盡。渡劫尖峰 57/78、萬獸 70/78；萬獸更短且更多閃避，但尚未證明整體戰術難度更高。玄嶽單武器 60/72 勝、龍象與御靈各 72/72；蜃影+玄嶽 60/72、蜃影+龍象及蜃影+鳴鐘各 72/72。此部分樣本未涵蓋所有配置，不能直接改正式數值。
- 發現原 audit 將打斷定義為 intent 變 null，但 production interruptMonster 會建立 kind:stagger，因此原 interrupts 全零無效；保留原始歷史資料，不能重寫假數據。提交 [d540cd71d4372c4f2753eba518ee4ba610f76e90](https://github.com/mymcworld3-droid/chjhsQAfighting/commit/d540cd71d4372c4f2753eba518ee4ba610f76e90) 修正玩家同回合成功位移、先前有預告、存活、stagger 轉換判定，新增正反例測試。原基線策略及三種種子不變，重跑 1440 場。
- 同一提交新增 480 場配對養成梯度（技能 5/精煉 5；seed a × 兩答對概率 × 20 配置 × 12 副本難度）及 48 場獨立飛劍策略（御靈與折光+御靈，seed a × 兩概率 × 12 難度）。飛劍策略獨立於原基線，每回合至多選擇一次經正式 R.apply 預演確實造成敵方 HP 損失的合法 sword-move；不是保證最優策略，實際覆蓋待數據。新增 swordMoves/swordMovementSpent/swordMoveHitActions 欄位。保留原 Stage19 cases、原基線與全部既有測試。已觀測部分基線 flight-summon 64 次、bell-echo 681 次；此為施放次數，不代表所有特殊協同均成功，需補實際雙武器同場施放與逐層震波命中/召劍回擊/蜃影複製/歲輪織界等專項證據。沒有更改任何 production 戰鬥或公開旗標。
- 修改 scripts/accept-new-weapon-balance.cjs、scripts/lib/tactical-balance.cjs、tests/tactical-balance.test.cjs；命令 node --test tests/tactical-balance.test.cjs 及既有 candidate 12 分片。d540cd7 回歸 46131094532、瀏覽器 46131094506、候選版 46131094551、Pages 46131093670 尚未完成。c06f9c4 回歸 46131036038 成功，瀏覽器 46131036055 尚未結論，Pages 46131035222 被後續部署取消。未確認最新 CI，不結案。
- 下一批 8B 續作：收集原剩餘分片（5/6/7/10），重建完整 summary；核對 d540cd7 及最新 main CI，修復失敗並收集修正後 1440+480+48 場，按配對鍵比較原/修正策略及養成，補全特殊技能實戰專項。依完整數據調整萬獸與尖峰敵方數值、以相同種子重測，記錄調整前後效果；原數值暫時保留，萬獸險域仍 hidden，不提前進入第九階段。
