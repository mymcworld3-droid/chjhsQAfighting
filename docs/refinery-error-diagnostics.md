# 煉器推演與開爐錯誤分類

「法寶推演暫時無法完成」原本同時涵蓋生成、格式、驗證和存檔權限錯誤。現在以獨立錯誤碼及失敗階段回報，不將所有失敗都歸因於 AI 或 D1 額度。

| 類別 | 錯誤碼 | 典型原因與處置 |
| --- | --- | --- |
| 素材／設定 | `refinery-input` | 素材不是 2～8 個、圖鑑缺少素材、效果上下限設定不合法；調整後再試。 |
| 本命法寶限制 | `refinery-refinement` | 四詞條、屬性上限、無法保留並逐項提升；更換素材或調整設定。 |
| 生成服務未設定 | `refinery-ai-config` | 沒有可用服務設定；需管理員處理。 |
| 上游驗證 | `refinery-ai-auth` | 供應商 401／403、金鑰或模型權限問題；需管理員處理。 |
| 模型／請求限制 | `refinery-ai-model`、`refinery-ai-request`、`refinery-ai-blocked` | 模型 404、不支援模型、400／422 請求格式或輸入長度限制、內容攔截；檢查設定或調整指導。 |
| 上游額度／頻率 | `refinery-ai-quota` | 供應商 429 或額度限制；與 D1 額度不同。 |
| 上游逾時／連線／異常 | `refinery-ai-timeout`、`refinery-ai-network`、`refinery-ai-service` | 單一服務逾時、連線中斷或 5xx。每次失敗記錄供應商、模型、HTTP 狀態與耗時。 |
| JSON／法寶內容 | `refinery-ai-json`、`refinery-ai-artifact` | 非 JSON、JSON 不完整，或缺少有效名稱／效果。路由器可嘗試下一個已設定服務。 |
| 多服務不同原因 | `refinery-ai-mixed` | 各供應商失敗原因不同；保留各次分類，不只顯示最後一次錯誤。 |
| 瀏覽器與本站連線 | `refinery-api-network`、`refinery-api-timeout` | 無法連線或整個請求超過三分鐘；逾時涵蓋回應本文讀取。 |
| 本站回傳／部署 | `refinery-api-invalid-response`、`refinery-api-response`、`refinery-api-access`、`refinery-api-route`、`refinery-request-size` | 非 JSON 錯誤頁、未分類 HTTP 錯誤、401／403、404、413；保留 HTTP 狀態。 |
| 登入 | `refinery-session` | 登入過期或帳號切換，重新登入並同步。 |
| 存檔權限 | `refinery-save-permission` | 圖鑑、配方或背包存檔被拒絕；不能靠連續重試解決。 |
| 資料用量 | `refinery-data-quota` | D1 quota／資料服務 `resource-exhausted`；等待額度恢復。 |
| 資料服務中斷 | `refinery-data-unavailable` | 讀取或提交不可用；提交階段先同步確認結果。 |
| 交易衝突／任務狀態 | `refinery-conflict`、`refinery-job` | 多分頁操作、已領取、任務被替換或尚未到期；先同步。 |
| 圖片補製 | `refinery-image` | 法寶與配方已入袋，僅補圖失敗，不回滾或重新發獎。 |
| 畫面同步 | `refinery-client-sync` | 資料庫交易已成功，之後的本機圖鑑或畫面更新失敗；提示已入袋並重新整理。 |
| 未知原因 | `refinery-unknown` | 保留階段與追蹤資訊，交由管理員查詢，不臆測成連線問題。 |

## 失敗階段與領取狀態

`request-preparation` → `request-validation` → `generation` → `artifact-validation` → `catalog-read`／`catalog-validation` → `catalog-commit`。已知配方使用 `inventory-commit`。圖片為獨立的 `image` 階段，附加指導審核失敗仍沿用已驗證的成品，不單獨導致開爐失敗。

生成失敗或明確拒絕存檔時，保留原煉製任務；材料已在開始煉製時扣除，重試開爐不再次扣除。生成成功的候選在本分頁記憶體快取，提交失敗後重試可重用，不另外生成。

若提交回應中斷，不能只憑錯誤判定是否已入袋，畫面會提示「結果尚待同步」。先確認任務與背包，不重新投入材料；交易仍以資料庫內的任務 ID 檢查及原子更新避免重複發獎。此診斷改動不放寬 D1 圖鑑寫入權限：一般玩家新配方被拒的既有流程衝突，會明確顯示為 `catalog-commit`／`refinery-save-permission`，需由後續伺服器領取流程修正。

## 錯誤回報

失敗彈窗持續顯示分類、保留／待確認狀態與建議操作，可展開詳情、複製 JSON 回報。Debugger 及 Render 日誌使用同一份分類；生成請求帶有追蹤編號，方便對照瀏覽器與伺服器。

回報包含錯誤碼、原始錯誤碼、階段、HTTP 狀態、請求與任務 ID、端點、耗時、各服務嘗試分類和時間。回報不包含 API 金鑰、Authorization、完整提示詞或整份圖鑑；上游原始錯誤不直接傳給玩家。紀錄只走既有日誌與本機複製功能，不新增資料庫寫入、錯誤上傳 API 或定時輪詢。
