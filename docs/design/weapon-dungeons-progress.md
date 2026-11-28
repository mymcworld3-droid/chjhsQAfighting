# 單人武器副本 V4 開發進度

規格：[weapon-dungeons-v4.md](weapon-dungeons-v4.md)。萬獸險域尚未開放。

## 第 1 階段：共通連續行動機制（程式已實作，待 CI 驗收）

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
