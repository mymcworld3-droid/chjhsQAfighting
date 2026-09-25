# 管理員帳號目錄

## 資料來源與使用方式

遊戲登入時為玩家建立 `users/{uid}` 文件。管理員頁的「帳號管理」改由 Render 後端 `POST /api/admin/accounts` 驗證 A 專案 ID Token 與 `users/{管理員 UID}.isAdmin` 後，再透過 Firebase Admin SDK 讀取這個集合；瀏覽器不再直接 `getDocs(users)`。可搜尋角色名稱、Email、UID、好友碼，依最後活躍時間排序，每頁顯示 20 筆。點開帳號時才由後端讀取該玩家詳情，並在伺服器端先遮蔽疑似密碼、Token、私鑰等欄位。

舊帳號若沒有 `createdAt`，註冊時間顯示「未記錄」；不可將 `lastActive` 誤認為註冊時間。這個目錄顯示「已在遊戲建立 users 文件的帳號」，不是 Firebase Authentication 使用者總名單。僅存在 Firebase Authentication、尚未進入遊戲的帳號，需要另行透過具備 Firebase Admin SDK 權限的後端列舉。

## Firestore 權限（部署前須檢查）

頁面會檢查登入狀態、目前角色的 `isAdmin`，且每次讀取前重新檢查 `users/{管理員 UID}` 的管理員標記。然而**客戶端檢查不是安全規則**：不能僅靠隱藏管理頁防止玩家透過 Firestore SDK 直接讀取其他玩家的 Email 或資料。

請在實際 Firebase 專案確認安全規則。管理員身份判定可使用下列規則函式，並限制敏感資料的 `get` / `list`：

```javascript
function isAdminUser() {
  return request.auth != null
    && exists(/databases/$(database)/documents/users/$(request.auth.uid))
    && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true;
}
```

**不要直接把 users 的 list 規則改成只允許管理員**，目前排行榜、社交等遊戲功能仍會查詢 `users`，直接封鎖可能令它們失效。正式上線前應將其他玩家可公開的資料移至獨立的 public profile / leaderboard 集合，並為 users 的私人資料讀取建立相應限制；同時防止玩家自行寫入或更改 `isAdmin`。權限規則須在 Firebase 控制台或部署管線單獨套用；更新 GitHub 前端程式不會自動修改 Firebase 規則。


## WebChannel `Listen stream transport errored` 與帳號管理

瀏覽器仍有聊天、邀請、系統指令、五仙榜與鬥法等 Firestore `onSnapshot` 即時監聽，因此網路切換、代理、瀏覽器暫停分頁時，Firebase SDK 仍可能輸出 `WebChannelConnection RPC 'Listen' ... transport errored` 並自行重連。這行訊息本身不是帳號目錄的讀取方式。帳號管理已改走後端 HTTP API，所以帳號清單／詳情失敗時應以 `/api/admin/accounts` 的 HTTP 狀態與畫面訊息判斷，不再把 WebChannel 警告當成帳號目錄失敗原因。
