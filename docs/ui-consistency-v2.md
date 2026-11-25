# 共用介面第二版：第 14–20 階段

本次承接 main 已有的第 1–13 階段，整合實際啟用的戰棋、武器修煉、單人副本、仙盟及教師介面。共用顯示元件接收既有帳號與房間資料，操作、權限及獎勵仍由原控制器與伺服器決定。

## 實作對照

| 階段 | 範圍 | 共用來源及使用處 |
| --- | --- | --- |
| 14 | B01–B04 生命與操作 | `battle-presentation.js` 統一 DOM／Canvas 生命比例、千分位數字、玩家／靈獸顏色和提示；試煉及武器副本繼續使用同一個 `tactical-combat.js` 的左側體力圓弧、右側技能滑軌與限制判定。 |
| 15 | B05–B07 情報與回饋 | 沿用 `tactical-beast-inspector.js` 與 `tactical-renderer.js` 的情報、移動／攻擊範圍及繪製順序；生命顯示接入共用元件；普通／暴擊／護盾／治療／體力的跳字使用同一格式，擊退及打斷沿用伺服器事件。 |
| 16 | B08、B09、W04 經驗與結算 | `tactical-manual-xp-feedback.js`、`tactical-manual-recap.js` 與修煉頁共用 `weapon-presentation.js` 的圖片、等級、持有數量及熟練度。同步中不假造已確認的進度；滿級固定顯示完成。試煉與副本共用結算統計及既有獎勵卡片，各自的目標、按鈕和收據保留。 |
| 17 | W01–W03、W05 武器與技能 | 收藏、裝備、修煉焦點、戰鬥換裝與掉落改用同一個六武器圖像來源；完整、小型與掉落展示共用身分資料。`skillMarkup` 統一技能圖像、名稱、等級、體力、射程及描述結構，保留各場景實際傷害與消耗。境界標記區分角色、武器與副本難度。 |
| 18 | W06、W07 演出與難度 | 武器主題演出共用 `daily-meditation-rewards.js` 的帳號／收據防重播機制；保留各武器主題特效與音效。`difficultyState` 共用六階難度的鎖定、可挑戰、通關及進行中顯示。 |
| 19 | S01–S06 仙盟與教師 | `community-presentation.js` 共用玩家身分、邀請標頭、狀態與統計；好友、排行榜和資料卡繼續使用既有頭像／UID 資料來源。聊天保留安全文字插入與範圍分享卡片，時間格式與輸入樣式共用。`question-editor-presentation.js` 供班級和教師洞天共用題幹、選項、答案、解析、預覽及題號導覽。 |
| 20 | 清理與驗證 | 移除重複的武器圖片 URL 宣告與已取代的局部計算；保留相容舊存檔的功法、管理及資料轉換程式。更新啟動版本與靜態模組版本清單，完成下述驗證。 |

教師洞天現在採用與班級編輯器相同的題號側欄，小螢幕改為橫向題號列。切題、排序、刪除前先收集所有欄位，非目前題目仍留在表單中；儲存時若其他題目缺欄位，先顯示該題再提示。發布確認、教師資格、版本核對及舊成績均沿用原流程。

目前班級透過加入碼加入，沒有另行建立接受／拒絕邀請流程。好友邀請使用共用標頭及狀態，接受／拒絕仍呼叫原 API。圖表與範圍繪製已共用的部分直接沿用。

## 驗證紀錄

- `node --test --test-reporter=tap --test-timeout=60000 tests/*.test.cjs`：3,009 項。包含新增的生命 DOM／Canvas 一致性、事件語意、六武器圖片、未知／滿級熟練度、技能及數量、社交文字安全、編輯器欄位契約、跨帳號收據防重播測試。
- `npm run audit:code`：檢查 JavaScript 語法、JSON 及瀏覽器模組連結。
- `npm run check:module-versions` 與 `git diff --check`：資源版本一致，無空白錯誤。
- `scripts/check-ui-consistency.cjs`：390×844 手機直式、844×390 手機橫式、820×1180 平板、1440×900 桌面；每種尺寸操作武器換裝、教師切題／排序／隱藏欄位驗證／儲存、實際戰場繪製、六階副本選單及 Esc 關閉，共產生 16 張截圖。換裝後既有武器圖片節點保持不變，避免重新閃爍。
- `scripts/check-classroom-ui.cjs`：本機教師審核、草稿、AI 生成、預覽發布；學生加入、續答、批改、訂正；報表匯出、版面、帳號隔離與仙盟分頁。

測試中另發現舊團本票證篡改測試偶爾失敗：直接替換 Base64URL 尾字元可能解碼成原位元組。改為翻轉驗證標籤的一個位元，確保每次都測到實際篡改；伺服器票證格式與驗證程式未變。

瀏覽器驗證使用實際前端模組和本機資料／API 測試替身，沒有登入正式帳號或更動玩家資料。正式站的登入後完整遊戲流程、真實網路延遲與跨裝置同步尚未人工驗收，不能視為已完成正式環境驗收。

## 重跑瀏覽器檢查

需事先安裝 Playwright（或 `playwright-core`）及 Chromium；兩個檢查程式均接受以下環境變數：

```sh
CHROMIUM_PATH=/path/to/chromium PLAYWRIGHT_MODULE=/path/to/playwright-core node scripts/check-ui-consistency.cjs
CHROMIUM_PATH=/path/to/chromium PLAYWRIGHT_MODULE=/path/to/playwright-core node scripts/check-classroom-ui.cjs
```

第一個檢查的截圖預設寫到系統暫存目錄 `qingyun-v2-ui`；可用 `UI_SCREENSHOT_DIR` 指定目錄。測試頁在 `tests/fixtures/ui-consistency.html`，不包含於公開網站入口。

## 功能及資料邊界

`QA_TACTICAL_BATTLE_ENABLED=true`、`QA_WEAPON_SYSTEM_ENABLED=false`、`QA_MANUAL_TRAINING_ONLY=true`、`QA_COOP_DUNGEON_ENABLED=false`、`QA_LEGACY_CULTIVATION_DISABLED=true` 保持原設定。此處的武器修煉沿用現行功法／武器資料介面，不啟用舊武器系統。

本次不調整伺服器規則、獎勵數量、經驗公式、技能解鎖、傷害平衡、副本券、通關條件或資料庫結構；保留六階難度與既有停用功能狀態。
