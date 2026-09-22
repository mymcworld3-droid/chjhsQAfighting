# A → BD／C 安全分流：啟用前檢查與非破壞性遷移

> **現況（2026-09-22）：已加入可選的玩家登入後自動搬移與 BD/C 首次個人資料建立，但 Render 的 `FIREBASE_AUTO_MIGRATE_ON_START` 預設為 `0`，正式洞天與鬥法模組仍讀寫 A。尚未執行真實搬移、正式切換或驗證跨庫獎勵。網頁 SDK 的 `apiKey` 並不具備管理員權限。**

## 三個專案與保留資料

| 專案 | ID | 遷移後用途 |
|---|---|---|
| A | `question-learning` | Firebase 登入、`users`、玩家背包和獎勵、`dongtianPlays`、遊玩歷史 `exam_logs`、好友邀請 |
| BD | `xiuxian-dongtian-bd` | 洞天索引 `dongtianIndex`、完整洞天 `dongtians`、題目審核 `dongtianReports`；之後視需要另放公開圖鑑 |
| C | `xiuxian-battle` | 將來新建的鬥法房間 `rooms`；**既有 A 房間先結算，不跨專案硬搬活躍房間** |

公開圖鑑目前包含程式內建及 A 的 `gameConfig` 設定；它們不是這次洞天遷移的範圍，現階段不應宣稱已移到 BD。

## 1. 將三個服務帳戶放入真正的後端環境變數

在 Firebase Console **A、BD、C 各自的「專案設定 → 服務帳戶」**取得供伺服器使用的憑證；或者在部署環境以具備對應權限的服務身分取得。若使用這個專案提供的 JSON 初始化器，須分別設定完整服務帳戶 JSON：

- `FIREBASE_A_SERVICE_ACCOUNT_JSON`
- `FIREBASE_BD_SERVICE_ACCOUNT_JSON`
- `FIREBASE_C_SERVICE_ACCOUNT_JSON`

每一項 JSON 必須對應正確的 `project_id`。把它們放在提供 `server.js` 的後端服務之**秘密環境變數**（或執行遷移的機器的未追蹤 `.env`），**不要**放進 `public/`、GitHub、聊天訊息、前端環境變數或測試截圖。服務帳戶具備高權限，只應用於受信任環境。

後端會註冊 `POST /api/firebase-project-tokens`：
1. 先驗證 A 的 ID Token，包括它的專案歸屬與撤銷狀態；
2. 驗證通過後為指定的 BD 或 C 簽發各自 Custom Token；
3. 瀏覽器使用 `ensureSecondaryFirebaseAuth('BD')` 或 `ensureSecondaryFirebaseAuth('C')` 登入相應的 Firebase Auth；
4. 主帳號登出／切換時會清除不相符的 BD/C 瀏覽器登入。

若憑證未設定，API 回應 503；**不會因此開放 Firestore 安全規則，也不會自動把正式讀寫轉往新庫**。

## 2. 先備份並安排暫停洞天寫入

必須停用**新建、刪除、題目修復、封印及更新洞天統計**等會修改 `dongtianIndex`／`dongtians`／`dongtianReports` 的操作，並讓現有洞天通關結算完成，再執行複製。僅修改 Firestore Security Rules 擋不住 Admin SDK 寫入。不可在正式玩家持續寫入時將一次複製當成一致快照。

Firebase 官方的代管匯出／匯入可跨專案，但需要兩邊啟用計費，並另設索引／權限。也可使用本專案的程式逐筆複製；本工具**不會刪除 A**，但會依資料量產生讀／寫用量。若需完整可恢復備份，先使用官方匯出或另外保存獨立備份，不能把 BD 的副本視作完整備份。

## 3. 先預覽，再真正複製，再驗證

在具有 Node.js、已安裝相依套件、且具備 A/BD 伺服器憑證的受信任環境執行：

```bash
npm install
npm run migrate:dongtian
# 確認來源／目的地數量及帳號/文件 ID，暫停相關寫入後：
npm run migrate:dongtian -- --execute
npm run migrate:dongtian -- --verify-only
```

**預設為唯讀預覽**；`--execute` 只複製 BD 缺少的文件，文件 ID 與原內容不變。若 BD 有同 ID 不同內容、來源在搬運中改變、或 BD 有不屬於 A 的文件，工具中止而**不覆蓋／刪除**。執行後再次逐筆比較資料；只要報錯就暫緩切換。若複製途中失敗，停寫後可重跑，已一致的文件會跳過。

**保留 `dongtianPlays` 在 A：**它與金幣／修為獎勵使用同一筆交易。直接整份搬去 BD 或直接全域替換 `getFirestore(getApp())`，都會破壞現有首次通關的原子結算。

## 4. 後續正式切換的必要條件

在**經測試的 Firestore Security Rules、索引及跨庫獎勵端點**均完成之前，不要把 `public/cultivation/dongtian.js` 或 `battle-mode-v2.js` 的預設 DB 改成 BD/C。

- **BD：**洞天索引、內容、題目回報與修復要使用 BD；遊玩紀錄／金幣／修為仍在 A。跨庫的完成次數與獎勵須使用可重試且防重複的後端流程，不能企圖在單一前端 Firestore 交易更新 A/BD。
- **C：**新建、配對、即時房間、回合在 C；好友名冊與邀請仍在 A。鬥法房間與 A 的玩家獎勵也不能在同一筆 Firestore 交易更新，必須改成有 A 專案唯一獎勵收據的受信任伺服器結算。
- **帳號刪除與名稱同步：**`account-delete.js` 和 `identity-system.js` 現仍只操作 A 的洞天資料；切換之前需要擴充跨庫清理／同步。
- **安全測試：**至少驗證不同玩家無法修改對方洞天或房間，不能冒領獎勵，重新登入、離線與失敗重試不會重複發獎，並核對遷移前後的文件總數。
- **正式切換：**先完成 BD 測試，再讓新的鬥法房間進 C；A 舊房間保留至自然結算／失效。切換時所有玩家必須使用同一版本，不可以部分玩家找 A 房間、另一部分找 C。

以上條件尚未完成前，保留 A 的既有路徑，是**有意避免資料遺失或錯誤結算的預設值**。


## 5. 登入時自動搬移與首次建立玩家資料（可選；預設關閉）

伺服器提供兩個需要 A 專案有效身分權杖的端點：

- `POST /api/game-startup-migration`：第一次登入觸發**一個**有 A Firestore 共用租約的 A→BD 洞天資料複製；其餘玩家僅讀取共用狀態。複製完成後在 A 的 `systemMigrations/dongtian-a-to-bd-v1` 紀錄比對成功，狀態為 `ready`。失敗會回報錯誤並保留 A 的來源文件，絕不以部分結果解鎖。
- `POST /api/game-startup-player`：僅在全站標記 `ready + verified` 後，用已驗證的 A UID 讀取 A 的 `users/{uid}`，分別在 BD、C 以同 UID 建立 `playerProfiles/{uid}`。已有正確格式的文件會跳過，不重複寫入；其中一個專案暫時失敗可重新執行。這裡只同步名稱／頭像，以及 C 的相框／性別，不同步 email、好友、背包、金幣、靈石、修為、管理員旗標。

網頁用現有全屏啟動畫面等待上述結果，**不能把玩家端 JS 當成有管理員權限的遷移工具**。若 Render 無法回應、憑證失效或首次資料建立失敗，會維持遮罩與重新整理按鈕。服務端 `FIREBASE_AUTO_MIGRATE_ON_START=0` 時回傳 `legacy`，為保留既有 A 遊戲，網頁直接維持舊路徑，不宣稱已遷移。

### Render 啟用順序

1. 先確保包含本次端點的 Render 後端已部署，並將三組 Firebase 服務帳戶 JSON 放入 Render **秘密環境變數**。不要把私鑰放在 GitHub 的 `public/`。
2. 對 A 做正式備份；停止 A 的洞天新增、修復、封印、通關統計等寫入，讓舊玩家完成正在執行的交易。**只擋新訪客並不能停止已在遊戲內的舊分頁。** 若無法確認停寫，請使用先前的人工預覽與遷移程序，而不要開啟自動遷移。
3. 將 Render 的 `FIREBASE_AUTO_MIGRATE_ON_START` 由 `0` 設為 `1`，重新部署後以測試帳號開啟遊戲。第一個通過驗證的玩家會請求伺服器進行複製；其他訪客只輪詢，成功確認後各自建立 BD/C 個人資料。
4. 於 A 檢查 `systemMigrations/dongtian-a-to-bd-v1` 為 `ready` 且 `verified: true`，核對 BD 索引與內容及 C/BD 測試玩家的 `playerProfiles`；確認 Render 日誌沒有衝突或寫入錯誤。
5. **不要因為此標記顯示 ready 就刪除 A 或全域切換洞天／鬥法。** 目前 `dongtian.js` 和 `battle-mode-v2.js` 仍需改寫跨專案結算並完成安全規則、索引與帳號刪除清理，才能正式讓 BD/C 作為權威資料庫。

自動搬移期間不會刪除 A，也不會將玩家的完整文件複製到 BD/C。因分別建立兩個玩家檔案不可能跨庫原子提交，失敗採可重試、未全部建立前不放行的流程。
