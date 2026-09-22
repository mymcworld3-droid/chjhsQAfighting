# Firebase A / BD / C 專案設定 — 只需貼上 Web SDK 設定

目前程式使用 Firebase Web SDK **10.7.1**（從 `www.gstatic.com/firebasejs` 載入），不必安裝套件、貼入整段 `<script>` 或上傳 SDK 檔案。

## 三個專案

| 代號 | 用途 | 設定位置 |
|---|---|---|
| A | 既有 `question-learning`：登入、玩家、金幣、修為、裝備、獎勵 | 原有 `public/main-legacy.js`，**不要更動** |
| BD | 洞天與公開圖鑑（規劃） | `public/firebase-projects-config.js` 內的 `BD: { ... }` |
| C | 鬥法房間（規劃） | `public/firebase-projects-config.js` 內的 `C: { ... }` |

**注意：目前只建立連線設定與初始化器，尚未啟用 BD／C 的實際資料分流。** 直接填入設定並不代表資料已搬移或驗證已完成。網站繼續讀取 A，不會因空白的新資料庫讓現有玩家資料消失。

## 你需要做的步驟

1. 在 [Firebase Console](https://console.firebase.google.com/) 建立 BD、C 兩個專案，各建立一個 Firestore `(default)` 資料庫；選擇正確位置，請勿使用「允許任何人讀寫」的規則。
2. 分別進入 BD、C → **專案設定 → 你的應用程式 → Web（`</>`）**，註冊網頁應用程式並找到畫面顯示的 `firebaseConfig`。
3. 開啟 [public/firebase-projects-config.js](../public/firebase-projects-config.js)，點 GitHub 的鉛筆編輯；把 **BD 的 `firebaseConfig` 欄位值**貼在 `BD: { ... }`，把 C 的貼在 `C: { ... }`。最少需要 `apiKey`、`authDomain`、`projectId`、`appId`。有提供的 `storageBucket`、`messagingSenderId` 也照貼。請確保 A／BD／C 的 `projectId` 各不相同。
4. 不要貼 `import`、`initializeApp` 或 `const app = ...` 那些 Firebase Console 產生的周邊程式，這個專案已經有 SDK 和初始化器。只填入物件中的欄位值即可。
5. 儲存並提交設定檔後，**更新靜態版本表**：在有 Node.js 的本機執行 `npm run build:module-versions`，一併提交 `public/module-versions.json`。若之後交由 AI 修改也可以請它同步更新。檢查 `npm run check:module-versions && npm test`。

### 可以直接套用的填寫格式

```js
export const firebaseProjectConfigs = {
  BD: {
    apiKey: 'BD 的 apiKey',
    authDomain: 'BD 的 authDomain',
    projectId: 'BD 的 projectId',
    storageBucket: 'BD 的 storageBucket',
    messagingSenderId: 'BD 的 messagingSenderId',
    appId: 'BD 的 appId',
  },
  C: {
    apiKey: 'C 的 apiKey',
    authDomain: 'C 的 authDomain',
    projectId: 'C 的 projectId',
    storageBucket: 'C 的 storageBucket',
    messagingSenderId: 'C 的 messagingSenderId',
    appId: 'C 的 appId',
  },
};
```

只填一個 `apiKey` **不足以**區分和初始化兩個 Firebase 專案，請複製完整 `firebaseConfig` 中的對應值。Web SDK 設定是可公開的用戶端識別資訊，不是 Firebase Admin 的服務帳戶私鑰；**不要在此檔案提交私鑰、API 服務端密碼或 Custom Token 簽章金鑰**。

## 後續正式啟用（需要另外處理）

程式已提供 `public/cultivation/firebase-projects.js`：
`getFirebaseProjectServices('A' | 'BD' | 'C')` 可取得個別 App、Auth 和 Firestore，`firebaseProjectStatus()` 可回報哪些專案已填完設定（不輸出 API Key）。

**但玩家在 A 登入不會自動在 BD、C 登入。** 正式啟用前需要：後端驗證 A 的 ID Token、替 BD/C 簽發 Custom Token、設定兩庫的 Security Rules／索引、完整遷移既有文件及檢查跨專案獎勵一致性。後端服務帳戶應存放在安全的伺服器環境變數或秘密管理服務，不能放入此公開倉庫。

等驗證與資料遷移完成後，才針對洞天／鬥法房間集合逐步切換。別把 `users`、發獎與交易結算的寫入直接改去 BD/C，也不要先刪 A 的舊資料。
