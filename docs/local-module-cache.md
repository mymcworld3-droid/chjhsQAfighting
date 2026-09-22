# 本機模組快取與版本管理

本專案使用 `public/sw.js`（Service Worker）及 `public/module-versions.json` 對 JS、CSS、HTML、題庫索引、角色圖片等同源靜態資源進行逐檔版本快取。首次載入後，JS/CSS 在遊戲功能全部就緒後以最多三個並行請求預存；大型圖片和題庫只在需要時儲存，避免首次開啟時下載數十 MB 的圖片。

再次開啟已受 Service Worker 控制的頁面時，只向同源網站請求小型 `module-versions.json`；每個已快取檔案以 Git blob SHA-1 作為版本號。版本相同直接讀瀏覽器 CacheStorage，版本不同才重新下載該檔案。版本表失去網路連線時使用最後一份已儲存的版本。

**任何人修改 `public/` 下的靜態檔案後，必須執行 `npm run build:module-versions` 並一起提交更新後的 `public/module-versions.json`。** `npm run check:module-versions` 和 `npm test` 都會檢查版本表是否落後；部署前請確認 CI 通過。更新 Service Worker 本身不需要額外收錄至版本表，瀏覽器使用原生 Service Worker 更新機制。若使用 GitHub API 直接修改主分支而不能執行 Node 指令，須按與生成指令相同的規則重建版本表，不得保留舊版號。

本機版本快取**不儲存玩家帳號、Firebase 驗證、房間狀態、交易餘額或戰鬥結算**。不會攔截 Firebase／外部 API。瀏覽器可能因私人模式、容量不足或使用者清除網站資料而刪除快取；首次下載與新資源更新仍須網路，外部 CDN 元件也仍依賴其 HTTP 快取與連線。請勿將本機快取視為完全離線遊戲。

測試：`npm test`，主要涵蓋版本一致性、相同檔案不重複下載、只更新改版檔案、離線已有模組的回退以及 Firebase 請求不進入快取。
