# 2026-10-20 程式稽核

## 結論與範圍

這次對所有專案程式進行語法檢查，檢查 JSON、瀏覽器本機模組連結、依賴已知弱點，並人工追查資料權限、交易、串流、快取頁面恢復、HTML 插入及 AI 錯誤處理。全量自動檢查不等於逐行人工證明，也不代表不存在所有錯誤。

- 424 個 JavaScript／CommonJS／ES module 檔案：語法全部通過，含本次新增的稽核指令與回歸測試。
- 19 個 JSON：全部可解析。原本另外 9 個 `.json` 實際為 Word OOXML 文件，已保持位元內容不變，改為 `.docx` 保存。
- 151 個瀏覽器模組：本機靜態匯入的路徑與 export 連結全部通過；外部 SDK 使用 stub，不執行模組、登入或連線。
- 1,612 項測試：全部通過。
- 清空並依鎖定檔重新安裝依賴後重跑測試；`npm audit --omit=dev` 已知弱點由 8 項中度降為 0。
- 本機實際啟動 Express：一般模式首頁 200、未登入資料／管理 API 401；維護模式首頁及遊戲資料 API 503、data-config 200，未登入管理搬遷 API 401。
- 實際 HTTP 讀取 `/api/banks` 列出的 2 個題庫，都能成功解析 JSON。
- 靜態資源版本清單已重新產生，維護畫面、雙人 HTTP 串流、獎勵冪等、交易衝突及權限測試均納入全量測試。

## 已修正

| 問題 | 影響 | 修正與驗證 |
| --- | --- | --- |
| 名稱、頭像框／商品 CSS 與圖片欄位、好友分數直接插入 HTML | 可被惡意儲存值打斷屬性或插入標籤；非字串也可能造成介面例外 | 統一轉字串與 HTML 跳脫；以含引號、事件屬性及 SVG 的輸入測試 |
| AI 供應商原始錯誤可能包含 API key | 原始 URL、header 或錯誤 body 可能進入日誌及 HTTP 錯誤 | 在文字及多模態 router 內遮蔽原 key、URL 編碼 key、Bearer 及敏感 header 值；實際錯誤路徑回歸測試 |
| 快取上一頁的 `pagehide` 永久取消資料監聽 | Safari／瀏覽器返回頁面後，狀態可能停止更新 | bfcache 暫停，`pageshow` 恢復；一般離頁仍清理，切換帳號不恢復舊訂閱 |
| 初始驗證／讀取期間連線已中斷，仍建立 SSE 監聽 | 產生無人接收的資料輪詢與多餘費用 | 資料串流及團本串流檢查 aborted／destroyed／writableEnded；模擬驗證期間關閉 |
| 快取初始回呼及錯誤回呼拋錯未攔截 | 非同步未處理例外可能中斷程序或後續訂閱者 | 個別回呼隔離；測試一個訂閱者拋錯仍不影響其他訂閱者 |
| 無效 SQL binding 混入共同讀取批次 | 一個錯誤查詢可能讓同批其他正常使用者讀取失敗 | 在排入前驗證 binding 型別、有限數值及大小；正常與錯誤請求同批測試 |
| Gemini 成功後仍保留 timeout 計時器 | 每次成功請求留下無用計時器 | 共用 `withDeadline` 並在 finally 清理；成功清理及逾時路徑測試 |
| 團本串流部分封包無大小界線 | 異常長資料可能持續占用記憶體 | 加上 4,000,000 字元界線，超限取消 reader；測試取消與狀態碼 |
| uuid 間接依賴的緩衝區邊界弱點 | npm audit 的 8 項警示來自此共同依賴鏈 | 固定相容 CommonJS 的 11.1.1；測試 google-gax、gaxios、teeny-request 所使用的 v4，以及修補後 v5 邊界；維持 Firebase Admin 13 與原 runtime 要求 |
| 9 份 Word 檔誤用 `.json` 副檔名 | 被題庫選單列出，但 `response.json()` 必然失敗 | 原始內容不變，改回 `.docx`；題庫端點不再列入，未自動捏造題目或答案 |

依賴弱點來源：[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)。掃描結果只代表當次資料庫已知的弱點。

## 尚未解決的重要架構風險

### 1. 玩家進度與部分經濟狀態仍信任客戶端

`d1-browser-api.cjs` 的一般使用者分支目前容許本人寫入自身角色文件，保護管理員欄位、UID 與 email，但不會驗證所有靈石、修為、材料及票券變更是否來自合法遊戲事件。`main-legacy.js`、煉器、部分成長功能也仍使用這個模式。玩家可繞過正常 UI 提交自身進度。

這是已確認的權限模型風險。直接全面禁止會讓現有答題獎勵、製作及成長存檔失效；本次沒有用一條通用封鎖規則掩蓋它。後續應將事件與消耗交給伺服器驗證，限制角色 API 可寫欄位，並保護初始化／刪除重建流程。已在伺服器結算的團本、契器及任務也需要配合收緊通用角色寫入權限。

### 2. 鬥法仍由房間成員提交主要戰況

`d1-browser-api.cjs` 的 `rooms` 更新規則確認參戰 UID 未被替換後，允許成員更新房間狀態。`battle-mode-v2.js` 在瀏覽器生成並提交題目、作答正確與結算結果；`battle-reward-api.cjs` 雖有重複領取防護，仍依賴此房間紀錄。這無法抵抗刻意修改請求的玩家。

需要將答題驗證、傷害／勝負與獎勵證據移到伺服器，再讓瀏覽器訂閱結果。這與「雙方共同開題」可以整合，但本次並未實作這項改造。

### 3. 公開 AI 端點缺少統一的用量防濫用機制

部分生成／審核 API 容許未附遊戲憑證的請求，未見統一的身分配額或頻率限制。即使憑證不再出現在錯誤中，仍可能被用來消耗上游 API 額度。需要配合匿名登入、預取與多 API 並行，設計不阻斷正常教室共用網路的限制。

## 尚未驗證的環境行為

沒有使用正式玩家資料、消耗正式票券、真實呼叫 AI 或對正式環境進行攻擊／負載測試。正式環境的雙人實機操作、弱網、手機瀏覽器快取恢復、實際憑證撤銷與 Render 部署後行為仍需驗證。外部 Firebase SDK 匯出、CDN 狀態及視覺排版無法只憑本機連結檢查保證。

## 重跑方式

```sh
npm ci --ignore-scripts --omit=dev
npm run audit:code
npm test
npm run check:module-versions
npm audit --omit=dev
```

`npm run audit:code -- --json` 會輸出逐檔清單。所有語法與模組連結檢查均不執行遊戲程式，亦不接觸資料庫或 AI。

## 逐檔自動檢查清單

下列程式均通過語法檢查，`public/` 下 JavaScript 同時通過本機模組連結檢查；JSON 均通過解析。清單不表示每個檔案均已逐行人工稽核。

### 伺服器與共用模組

- `ability-coach-api.cjs`
- `admin-account-api.cjs`
- `admin-artifact-delete-api.cjs`
- `ai-router.js`
- `alliance-friend-chat-api.cjs`
- `artifact-generation-api.js`
- `battle-reward-api.cjs`
- `cloudflare/d1/src/worker.mjs`
- `d1-admin-migration-api.cjs`
- `d1-browser-api.cjs`
- `d1-read-batcher.cjs`
- `d1-store.cjs`
- `daily-meditation-api.cjs`
- `dongtian-api.js`
- `dongtian-entry-api.cjs`
- `dongtian-settlement-api.cjs`
- `enlightenment-trial-api.cjs`
- `fast-quiz-prompt.cjs`
- `firebase-admin-projects.cjs`
- `firebase-auto-migration-api.cjs`
- `firebase-player-provision-api.cjs`
- `firebase-project-auth-api.cjs`
- `game-stage.cjs`
- `identity-api.js`
- `inventory-dismantle-api.cjs`
- `invitation-api.cjs`
- `item-image-api.cjs`
- `opportunity-api.cjs`
- `player-analytics-api.cjs`
- `quest-api.cjs`
- `question-answer-integrity.cjs`
- `question-quality.cjs`
- `question-report-api.cjs`
- `quiz-answer-prompt.cjs`
- `quiz-spare-pool.cjs`
- `raid-authority.cjs`
- `raid-clock.cjs`
- `raid-loot.cjs`
- `raid-question-ticket.cjs`
- `raid-reward-api.cjs`
- `raid-room-api.cjs`
- `raid-room-stream.cjs`
- `raid-spirit-reward.cjs`
- `reward-receipt.cjs`
- `server-repositories.cjs`
- `server.js`
- `soulbound-draw-api.cjs`
- `storage-values.cjs`
- `world-immortals-cleanup-api.cjs`

### 瀏覽器模組

- `public/account-delete.js`
- `public/answer-zoom-policy.js`
- `public/app-stage-bridge.js`
- `public/cultivation-rules.js`
- `public/cultivation/ability-insights-core.js`
- `public/cultivation/ability-insights-ui.js`
- `public/cultivation/admin-account-manager.js`
- `public/cultivation/admin-artifact-delete.js`
- `public/cultivation/admin-artifact-effect-bounds.js`
- `public/cultivation/admin-artifact-manager.js`
- `public/cultivation/admin-d1-migration.js`
- `public/cultivation/admin-item-image-manager.js`
- `public/cultivation/admin-material-manager.js`
- `public/cultivation/admin-panel-collapsible.js`
- `public/cultivation/admin-player-analytics.js`
- `public/cultivation/admin-realm-sorting.js`
- `public/cultivation/admin-self-transfer.js`
- `public/cultivation/admin-single-row-layout.js`
- `public/cultivation/alliance-friend-chat.js`
- `public/cultivation/answer-gold-rules.js`
- `public/cultivation/artifact-battle-effects.js`
- `public/cultivation/artifact-catalog-sync.js`
- `public/cultivation/artifact-catalog.js`
- `public/cultivation/artifact-system.js`
- `public/cultivation/battle-combat-feedback.js`
- `public/cultivation/battle-cultivation-rules.js`
- `public/cultivation/battle-engine-v2.js`
- `public/cultivation/battle-mode-v2.js`
- `public/cultivation/battle-question-scope.js`
- `public/cultivation/battle-v3-stability-ui.js`
- `public/cultivation/combat-combo.js`
- `public/cultivation/combat-contribution.js`
- `public/cultivation/combat-power.js`
- `public/cultivation/content-capacity-layout.js`
- `public/cultivation/cultivation-combat-stats.js`
- `public/cultivation/cultivation-core-equip-warning.js`
- `public/cultivation/cultivation-core-visual.js`
- `public/cultivation/cultivation-inventory.js`
- `public/cultivation/cultivation-progression-v2.js`
- `public/cultivation/cultivation-rank-sync.js`
- `public/cultivation/cultivation-refinery-v2.js`
- `public/cultivation/cultivation-rules.js`
- `public/cultivation/cultivation-status-panel.js`
- `public/cultivation/cultivation-theme.js`
- `public/cultivation/cultivation-training-v4.js`
- `public/cultivation/curriculum-pages.js`
- `public/cultivation/curriculum-range-rules.js`
- `public/cultivation/curriculum-scope.js`
- `public/cultivation/daily-meditation-mistakes.js`
- `public/cultivation/daily-meditation-rewards.js`
- `public/cultivation/daily-meditation-rules.js`
- `public/cultivation/daily-meditation.js`
- `public/cultivation/data/battle-repository.js`
- `public/cultivation/data/dongtian-repository.js`
- `public/cultivation/data/firestore-quota-guard.js`
- `public/cultivation/data/index.js`
- `public/cultivation/data/player-repository.js`
- `public/cultivation/data/project-repository.js`
- `public/cultivation/data/raid-repository.js`
- `public/cultivation/data/reward-repository.js`
- `public/cultivation/data/room-event-stream.js`
- `public/cultivation/dongfu-settings-collapsible.js`
- `public/cultivation/dongtian-cache.js`
- `public/cultivation/dongtian-entry.js`
- `public/cultivation/dongtian.js`
- `public/cultivation/enlightenment-trial-ui.js`
- `public/cultivation/firebase-projects.js`
- `public/cultivation/first-answer-guide.js`
- `public/cultivation/first-visit-rules.js`
- `public/cultivation/first-visit.js`
- `public/cultivation/five-immortals.js`
- `public/cultivation/forge-fragments.js`
- `public/cultivation/foundation-training-page.js`
- `public/cultivation/golden-core-access-guard.js`
- `public/cultivation/golden-core-activation-feedback.js`
- `public/cultivation/golden-core-art.js`
- `public/cultivation/golden-core-battle-effects.js`
- `public/cultivation/golden-core-pity.js`
- `public/cultivation/golden-core-wash-animation.js`
- `public/cultivation/identity-system.js`
- `public/cultivation/in-app-select.js`
- `public/cultivation/inventory-dismantle.js`
- `public/cultivation/knowledge-points.js`
- `public/cultivation/market-fluid-layout.js`
- `public/cultivation/material-catalog-sync.js`
- `public/cultivation/material-catalog.js`
- `public/cultivation/material-drop-system.js`
- `public/cultivation/material-realm-ui.js`
- `public/cultivation/material-system.js`
- `public/cultivation/math-guard.js`
- `public/cultivation/nascent-growth.js`
- `public/cultivation/nascent-soul-rules.js`
- `public/cultivation/opportunity-dongtian.js`
- `public/cultivation/opportunity-rules.js`
- `public/cultivation/player-analytics-client.js`
- `public/cultivation/player-growth-feedback.js`
- `public/cultivation/player-growth-rules.js`
- `public/cultivation/player-marketplace.js`
- `public/cultivation/player-profile.js`
- `public/cultivation/profile-avatar.js`
- `public/cultivation/quest-rules.js`
- `public/cultivation/quest-system.js`
- `public/cultivation/quiz-history-view.js`
- `public/cultivation/quiz-math.js`
- `public/cultivation/raid-catalog.js`
- `public/cultivation/raid-difficulty.js`
- `public/cultivation/raid-engine.js`
- `public/cultivation/raid-loot-view.js`
- `public/cultivation/raid-mode.js`
- `public/cultivation/raid-question.js`
- `public/cultivation/raid-room.js`
- `public/cultivation/realm-breakthrough-feedback.js`
- `public/cultivation/realm-icon-motion.js`
- `public/cultivation/realm-icons.js`
- `public/cultivation/refinery-ai-jobs.js`
- `public/cultivation/refinery-economy.js`
- `public/cultivation/reverse-core-multiples.js`
- `public/cultivation/scene-transitions.js`
- `public/cultivation/scope-fullscreen.js`
- `public/cultivation/solo-cultivation-feedback.js`
- `public/cultivation/solo-learning-rules.js`
- `public/cultivation/soul-talents.js`
- `public/cultivation/soulbound-draw.js`
- `public/cultivation/soulbound-item-frame.js`
- `public/cultivation/soulbound-pool.js`
- `public/cultivation/startup-resource-preloader.js`
- `public/cultivation/story/story-backgrounds.js`
- `public/cultivation/story/story-engine.js`
- `public/cultivation/story/story-scripts.js`
- `public/cultivation/training-access-rules.js`
- `public/cultivation/training-access.js`
- `public/cultivation/training-fluid-layout.js`
- `public/cultivation/training-render-guard.js`
- `public/cultivation/training-scene-layer-art.js`
- `public/cultivation/training-scene-layouts.js`
- `public/cultivation/training-scene-map.js`
- `public/cultivation/training-scroll-fix.js`
- `public/cultivation/training-shared-shells.js`
- `public/cultivation/true-immortal.js`
- `public/cultivation/unified-inventory-grid.js`
- `public/cultivation/xiuxian-live-sync.js`
- `public/d1-codec.js`
- `public/data-store.js`
- `public/firebase-projects-config.js`
- `public/game-stage-rules.js`
- `public/game-stage.js`
- `public/main-legacy.js`
- `public/main.js`
- `public/solo-question-cache.js`
- `public/sw.js`
- `public/visual-viewport-guard.js`

### 工具腳本

- `scripts/audit-code.cjs`
- `scripts/build-module-versions.cjs`
- `scripts/capture-layout.cjs`
- `scripts/capture-raid-rewards.cjs`
- `scripts/migrate-dongtian-to-bd.cjs`
- `scripts/migrate-firestore-to-d1.cjs`
- `scripts/simulate-core-winrates.cjs`

### 測試程式

- `tests/ability-insights.test.cjs`
- `tests/account-avatar.test.cjs`
- `tests/account-delete.test.cjs`
- `tests/admin-account-api.test.cjs`
- `tests/admin-account-manager.test.cjs`
- `tests/admin-artifact-delete.test.cjs`
- `tests/admin-artifact-effect-bounds.test.cjs`
- `tests/admin-artifact-manager.test.cjs`
- `tests/admin-product-fullscreen.test.cjs`
- `tests/admin-recipe-editor.test.cjs`
- `tests/admin-single-row-layout.test.cjs`
- `tests/admin-unlimited-refinery-materials.test.cjs`
- `tests/ai-artifact-refinery.test.cjs`
- `tests/ai-router.test.cjs`
- `tests/alliance-friend-chat.test.cjs`
- `tests/anonymous-qa-login.test.cjs`
- `tests/answer-gold-rules.test.cjs`
- `tests/answer-zoom-policy.test.cjs`
- `tests/artifact-combat-effects.test.cjs`
- `tests/artifact-equipment-persistence.test.cjs`
- `tests/artifact-refinement-nesting.test.cjs`
- `tests/artifact-rename-freeze.test.cjs`
- `tests/artifact-system.test.cjs`
- `tests/battle-absolute-time.test.cjs`
- `tests/battle-avatar.test.cjs`
- `tests/battle-combat-feedback.test.cjs`
- `tests/battle-cultivation-pool.test.cjs`
- `tests/battle-matchmaking-race.test.cjs`
- `tests/battle-missing-question.test.cjs`
- `tests/battle-opening-countdown.test.cjs`
- `tests/battle-portrait-stage.test.cjs`
- `tests/battle-prefetch-combat-flow.test.cjs`
- `tests/battle-question-scope.test.cjs`
- `tests/battle-quota-backoff.test.cjs`
- `tests/battle-result-cinematic.test.cjs`
- `tests/battle-story-lock.test.cjs`
- `tests/battle-v2.test.cjs`
- `tests/battle-v3-stability-ui.test.cjs`
- `tests/battle-viewport-layout.test.cjs`
- `tests/brand-home-navigation.test.cjs`
- `tests/breakthrough-continue.test.cjs`
- `tests/breakthrough-pill-bonus.test.cjs`
- `tests/browser-module-paths.test.cjs`
- `tests/character-confirm.test.cjs`
- `tests/chinese-interface.test.cjs`
- `tests/cloud-curtain.test.cjs`
- `tests/combat-power.test.cjs`
- `tests/combat-quiz-latency.test.cjs`
- `tests/comprehensive-custom-scope.test.cjs`
- `tests/concise-scope-copy.test.cjs`
- `tests/content-capacity-layout.test.cjs`
- `tests/content-image-fallback.test.cjs`
- `tests/cross-project-settlement.test.cjs`
- `tests/cultivation-status-all-stats.test.cjs`
- `tests/cultivation-status-crit.test.cjs`
- `tests/cultivation.test.cjs`
- `tests/curriculum-chat-share.test.cjs`
- `tests/curriculum-elementary.test.cjs`
- `tests/curriculum-highschool.test.cjs`
- `tests/curriculum-pages.test.cjs`
- `tests/curriculum-range-rules.test.cjs`
- `tests/curriculum-scope.test.cjs`
- `tests/d1-admin-login-client.test.cjs`
- `tests/d1-admin-migration.test.cjs`
- `tests/d1-browser-client.test.cjs`
- `tests/d1-migration.test.cjs`
- `tests/d1-read-optimization.test.cjs`
- `tests/d1-security.test.cjs`
- `tests/d1-store.test.cjs`
- `tests/d1-worker.test.cjs`
- `tests/daily-meditation-api.test.cjs`
- `tests/daily-meditation-rewards.test.cjs`
- `tests/daily-meditation-sync.test.cjs`
- `tests/daily-meditation.test.cjs`
- `tests/debug-top-layer.test.cjs`
- `tests/deferred-extension-practice.test.cjs`
- `tests/dongfu-settings-collapsible.test.cjs`
- `tests/dongtian-answer-stall.test.cjs`
- `tests/dongtian-chat-share.test.cjs`
- `tests/dongtian-encounter-flow.test.cjs`
- `tests/dongtian-entry-api.test.cjs`
- `tests/dongtian-learning-rewards.test.cjs`
- `tests/dongtian-local-cache.test.cjs`
- `tests/dongtian-progress.test.cjs`
- `tests/dongtian-syntax.test.cjs`
- `tests/dongtian-visibility.test.cjs`
- `tests/dongtian.test.cjs`
- `tests/enlightenment-trial.test.cjs`
- `tests/firebase-c-rules.test.cjs`
- `tests/firebase-cross-project-migration.test.cjs`
- `tests/firebase-first-login.test.cjs`
- `tests/firebase-multi-project-config.test.cjs`
- `tests/firestore-quota-resilience.test.cjs`
- `tests/first-answer-guide.test.cjs`
- `tests/first-visit.test.cjs`
- `tests/five-immortals-challenge.test.cjs`
- `tests/floating-quick-actions.test.cjs`
- `tests/focused-custom-scope.test.cjs`
- `tests/forge-fragments.test.cjs`
- `tests/friend-chat-poll-usage.test.cjs`
- `tests/game-stage.test.cjs`
- `tests/golden-core-activation-feedback.test.cjs`
- `tests/golden-core-art.test.cjs`
- `tests/golden-core-equipped-state.test.cjs`
- `tests/golden-core-lore.test.cjs`
- `tests/golden-core-pity.test.cjs`
- `tests/golden-core-spirit-refund.test.cjs`
- `tests/golden-core-toggle.test.cjs`
- `tests/golden-core-wash-inline.test.cjs`
- `tests/helpers/d1-db.cjs`
- `tests/helpers/inventory-db.cjs`
- `tests/in-app-select.test.cjs`
- `tests/inventory-dismantle.test.cjs`
- `tests/invitation-server.test.cjs`
- `tests/item-image-api.test.cjs`
- `tests/knowledge-points.test.cjs`
- `tests/leaderboard-grade-gates.test.cjs`
- `tests/leaderboard.test.cjs`
- `tests/legacy-gacha-removal.test.cjs`
- `tests/legacy-realm-curve.test.cjs`
- `tests/local-module-cache.test.cjs`
- `tests/manual-story-quests.test.cjs`
- `tests/market-fluid-layout.test.cjs`
- `tests/material-catalog-complete.test.cjs`
- `tests/material-crafting.test.cjs`
- `tests/material-drop-conflict.test.cjs`
- `tests/material-drop.test.cjs`
- `tests/math-guard.test.cjs`
- `tests/nascent-growth-combo.test.cjs`
- `tests/nascent-soul-respec.test.cjs`
- `tests/nascent-soul.test.cjs`
- `tests/opportunity-dongtian.test.cjs`
- `tests/player-analytics.test.cjs`
- `tests/player-growth-feedback.test.cjs`
- `tests/player-marketplace.test.cjs`
- `tests/player-profile.test.cjs`
- `tests/polish-bundle.test.cjs`
- `tests/portrait-secondary-header.test.cjs`
- `tests/progression-gates.test.cjs`
- `tests/project-audit-regressions.test.cjs`
- `tests/quest-spotlight.test.cjs`
- `tests/quest-system.test.cjs`
- `tests/question-answer-integrity.test.cjs`
- `tests/question-helper-discussion.test.cjs`
- `tests/question-quality.test.cjs`
- `tests/question-report-click.test.cjs`
- `tests/question-report-compensation.test.cjs`
- `tests/quiz-history-view.test.cjs`
- `tests/quiz-math.test.cjs`
- `tests/quiz-parallel-providers.test.cjs`
- `tests/quiz-rich-text.test.cjs`
- `tests/quiz-spare-pool.test.cjs`
- `tests/raid-authority.test.cjs`
- `tests/raid-clock-api.test.cjs`
- `tests/raid-clock.test.cjs`
- `tests/raid-difficulty.test.cjs`
- `tests/raid-entry-access.test.cjs`
- `tests/raid-loot-client.test.cjs`
- `tests/raid-mvp.test.cjs`
- `tests/raid-party-kick.test.cjs`
- `tests/raid-public-recruitment.test.cjs`
- `tests/raid-realtime-http.test.cjs`
- `tests/raid-realtime.test.cjs`
- `tests/raid-result-refresh.test.cjs`
- `tests/raid-reward-api.test.cjs`
- `tests/raid-server-animation.test.cjs`
- `tests/raid-spirit-client.test.cjs`
- `tests/raid-spirit-reward.test.cjs`
- `tests/raid-ticket-indicators.test.cjs`
- `tests/raid-ui-and-multimode-history.test.cjs`
- `tests/raid-ui-stability.test.cjs`
- `tests/realm-balance-v3.test.cjs`
- `tests/realm-breakthrough-interaction.test.cjs`
- `tests/realm-icons.test.cjs`
- `tests/refinery-cta-background-prefetch.test.cjs`
- `tests/refinery-job-retry.test.cjs`
- `tests/refinery-method-icons.test.cjs`
- `tests/refinery-octagonal-ui.test.cjs`
- `tests/refinery-performance.test.cjs`
- `tests/refinery-preload-ui.test.cjs`
- `tests/removed-tutorials.test.cjs`
- `tests/repository-layer.test.cjs`
- `tests/reverse-core-multiples.test.cjs`
- `tests/reward-triggered-firestore-writes.test.cjs`
- `tests/scene-transitions.test.cjs`
- `tests/scope-fullscreen.test.cjs`
- `tests/sect-commissions.test.cjs`
- `tests/solo-cultivation-feedback.test.cjs`
- `tests/solo-feedback-clock.test.cjs`
- `tests/solo-learning-rewards.test.cjs`
- `tests/solo-question-cache.test.cjs`
- `tests/solo-soul-reward.test.cjs`
- `tests/soul-talent-balance.test.cjs`
- `tests/soul-talents.test.cjs`
- `tests/soulbound-artifact-rules.test.cjs`
- `tests/soulbound-draw.test.cjs`
- `tests/soulbound-page.test.cjs`
- `tests/stable-bottom-nav.test.cjs`
- `tests/startup-resource-preloader.test.cjs`
- `tests/static-index-layout.test.cjs`
- `tests/story-backgrounds.test.cjs`
- `tests/story-first-login.test.cjs`
- `tests/story-system.test.cjs`
- `tests/thunder-answer-counter.test.cjs`
- `tests/training-cloud-readiness.test.cjs`
- `tests/training-fluid-layout.test.cjs`
- `tests/training-navigation-stability.test.cjs`
- `tests/training-render-guard.test.cjs`
- `tests/training-scene-map.test.cjs`
- `tests/training-scroll-stability.test.cjs`
- `tests/training-scroll.test.cjs`
- `tests/true-immortal.test.cjs`
- `tests/unified-inventory-grid.test.cjs`
- `tests/visual-viewport-guard.test.cjs`
- `tests/weekly-quest.test.cjs`
- `tests/xianxia-bright-accents.test.cjs`
- `tests/xianxia-font-bootstrap.test.cjs`

### JSON 資料

- `docs/design/soulbound-art-prompts.json`
- `docs/golden-core-art-prompts.json`
- `package-lock.json`
- `package.json`
- `public/banks/高中/學測/國文/01-1-111學測國綜試卷.json`
- `public/banks/高中/學測/國文/01-1-112學測國文(國綜)試卷.json`
- `public/elementary_school_unit_name/core.json`
- `public/elementary_school_unit_name/math.json`
- `public/elementary_school_unit_name/other.json`
- `public/high_school_unit_name/core.json`
- `public/high_school_unit_name/humanities.json`
- `public/middle_school_unit_name/公民/civics.json`
- `public/middle_school_unit_name/國文/chinese.json`
- `public/middle_school_unit_name/地理/geogrophy.json`
- `public/middle_school_unit_name/數學/math.json`
- `public/middle_school_unit_name/歷史/history.json`
- `public/middle_school_unit_name/生物理化/science.json`
- `public/middle_school_unit_name/英文/english.json`
- `public/module-versions.json`
