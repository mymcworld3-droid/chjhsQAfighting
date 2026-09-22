# A → BD／C 安全分流：啟用前檢查與非破壞性遷移

> **現況（2026-09-22）：已建立後端身分交換端點、三專案 Admin 初始化器，以及 A→BD 洞天內容遷移與驗證工具。正式洞天／鬥法模組仍讀寫 A；尚未執行真實遷移，也尚未切換 C 房間。填入 Web SDK 的 `apiKey` 並不提供伺服器管理權限。**

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
