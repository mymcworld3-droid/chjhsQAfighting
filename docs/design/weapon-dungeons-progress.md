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

## 第 3 階段：尖峰石域劍法（程式已實作，待 CI）

- 新開副本配置直線劍氣（5 格）、橫掃斬擊（3 格扇區）、穿刺突進（3 格、最多 2 格技能位移）、領主劍雨（4 格瞄準、曼哈頓半徑 2）；倍率暫沿用 1，未調整血量/普通移動/基礎傷害。上述射程為暫定值，最終待第八階段平衡。
- 巖獸使用橫掃及穿刺；石靈使用直線及橫掃；守衛使用穿刺及直線；領主四技。從上次已施展技能之後循環尋找合法選項，不改已預告的技能；不合法則正常追擊。
- 穿刺以完整占位逐格檢查，攻擊格為合法路徑前緣及停止點前一格；結算時只可縮短既存預告，不能穿過牆、其他單位、或偷偷延長路徑。保存路徑及技能選擇。成功擊退沿用共用打斷。
- 既有存檔未配置新技能者保留舊落石，避免更新改變既有預告或進度；新開副本使用四技。地圖、獎勵、進度及圖騰加成不改。
- 四個獨立動畫 ID，重用既有 Canvas 劍法光束、斬擊與位移，劍雨逐格落下；傷害動畫使用實際事件及格位。入口特色文字與靈獸資料同步。
- 新增六項回歸，涵蓋正式配置、四技能傷害及動畫事件、追蹤方向與遮蔽、扇形及劍雨、2×2 路徑碰撞、技能循環；保留既有測試。
- 修改：public/cultivation/tactical-rules.js、public/cultivation/weapon-dungeon-rules.js、public/cultivation/tactical-skill-effects.js、public/cultivation/tactical-animation.js、tests/weapon-dungeons.test.cjs、public/module-versions.json、本文件。
- 待 CI：npm test、npm run test:battle、npm run check:module-versions、瀏覽器及候選版驗收。未完成最新 CI 前不得宣稱第三階段正式驗收；下一階段為隱藏萬獸險域基礎建置。

- 補強：穿刺位移動畫同樣使用劍法速度線，新增四技（含穿刺）擊退打斷及實際動畫路徑辨識斷言。
