# 跨分支部署一致性與快取防護（2026-11）

本套件目前同步安裝於 `main`、`feature/cultivation-reboot`、`simple-quiz-game`。從這些分支建立的新分支應繼承這套防護。

## 症狀與預防

1. **部署目標分支錯誤：** GitHub 更新某個分支，並不代表 Render 綁定另一分支的網站會更新。每個 Render 服務必須在 Settings 檢查正確的 Branch，並開啟 Auto-Deploy。多個預覽分支若要同時上線，必須使用各自的 Render 服務、Preview 環境或可識別的不同 URL。
2. **舊遊戲畫面殘留：** `public/sw.js` 已改為不快取任何請求，安裝後會移除既有 `xiuxian-*` CacheStorage 並自行解除註冊。舊 `public/index.html` 也不再註冊它。已安裝舊版 SW 的瀏覽器，首次切換後可能需要多一次重新整理；此為一次性遷移。
3. **HTTP 快取未驗證：** `deployment-guard.cjs` 對首頁、HTML、SW、版本清單回傳 `Cache-Control: no-store`；JS、CSS、JSON、圖片改為 `no-cache, must-revalidate`（可儲存，但每次須驗證新舊）。不會干預 `/api/generate-quiz` 等一般 API 的處理。
4. **不知道網站的實際版本：** `/api/deploy-info` 回報目前服務執行中的 `branch`、`commit`、`revision`。頁面左下角顯示分支與短版號，定期核對更新；發現新版本時通知玩家自行重新載入，不會中斷當前答題。若 `EXPECTED_GIT_BRANCH` 與 Render 實際分支不符，顯示警告並寫入伺服器紀錄。
5. **忘記更新版本清單：** `npm install`、`npm start`、`npm run dev` 都會自動執行 `scripts/build-module-versions.cjs`。GitHub Actions 對**所有分支**執行檢查及回歸測試，不再只限指定舊分支。

## Render 每個服務建議設定

- Repository: `mymcworld3-droid/chjhsQAfighting`
- Branch: 該服務真正要顯示的分支（每個服務各別指定）
- Auto-Deploy: 開啟
- Build Command: `npm install`（或 `npm ci`）
- Start Command: `npm start`
- Environment: 建議設定 `EXPECTED_GIT_BRANCH=main`；其他分支服務填各自分支名稱。
- 遇到舊快取，可先以 Render **Clear build cache & deploy** 排除建置層殘留；不要把 Render build cache 與瀏覽器快取混為一談。

**重要：**修改這些 GitHub 檔案不會自行修改 Render 帳號中的 Branch / Auto-Deploy / Start Command 設定；仍應在 Render 服務頁確認。不能讓同一個固定 URL 同時指向多個分支。

## 如何核對是否更新

```bash
# 回傳 Render 當前執行中的分支與完整 git commit（不要只看 GitHub 分支）
curl -fsS https://<YOUR-SERVICE>.onrender.com/api/deploy-info

# 首頁及 Service Worker 應有 Cache-Control: no-store
curl -I https://<YOUR-SERVICE>.onrender.com/
curl -I https://<YOUR-SERVICE>.onrender.com/sw.js
```

把 `/api/deploy-info` 的 `commit` 與 Render Deploys 的最後成功 commit 比對，再與 GitHub 該服務指定分支的 HEAD 比對。如果 GitHub HEAD 不同，先排查 Render Auto-Deploy、部署失敗或服務綁定錯分支。若 SHA 相同但頁面異常，檢查 DevTools Network、Service Workers、Console 與是否有代理/CDN 額外快取。

## 維護規範

- `server.js` 必須在 `registerGameStage(app)` 和 `express.static` **之前**呼叫 `registerDeploymentGuard(app)`。
- 任何新首頁路由必須透過 `sendPage(...)` 注入 `deploy-guard.js`，不可重新引入快取過期的 stage/iframe 頁面映射。
- 不可在 `public/sw.js` 新增攔截 HTML/JS/CSS 的 fetch 快取，除非同時設計新的可靠版本驗證、升級遷移與跨分支測試。
- `.github/workflows/tests.yml` 必須對所有分支執行；任何新增分支應繼承此檔與防護模組。
- 若未來使用靜態 CDN、反向代理或自訂 Render Blueprint，請另行確認 CDN 快取規則與部署分支一致；伺服器的 HTTP 標頭不能單獨保證外部代理遵守。
