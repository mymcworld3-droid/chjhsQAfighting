# 仙盟好友私訊

已支援 Render 後端＋Supabase PostgreSQL。切換與驗證程序見 [PostgreSQL 搬移指南](supabase-friend-chat.md)。下列 BD 說明適用於 `FRIEND_CHAT_STORAGE=firestore`，這仍是未設定時的預設值。

## 功能
仙盟 → 好友 → 私訊，開啟好友聊天彈窗。每次顯示最近 60 則私人訊息。未讀好友私訊會使仙盟導覽、好友分頁和發訊好友的按鈕亮紅點。全服聊天的新訊息只使「全服聊天」分頁亮紅點，不能傳遞至導覽紅點。

前景分頁每 12 秒檢查一次私人收件匣，返回前景立即更新。**這不是關閉瀏覽器仍能收到的推播通知。**

## 資料庫與隱私
- Firebase A：`users/{uid}.friends`，檢查雙向好友與登入憑證。
- Firebase BD：`allianceFriendChats/{sha256(UID pair)}` 與 `messages/{id}`，儲存訊息和個別玩家未讀數。訊息不存到 A。
- 客戶端沒有 BD 私訊直接讀寫程式碼。後端四個端點為 `/api/alliance-chat/inbox`、`thread`、`send`、`read`。
- 每次存取都驗證 Firebase A 的 ID token 與雙向好友關係。請求無法偽造發訊人。
- 文字最多 400 字；前端使用 `textContent`，不解讀 HTML／JS／LaTeX。每 UID 發訊至少間隔 1.5 秒（限流為單機記憶體）。
- Firebase BD 必須具備 Render 伺服器環境變數 `FIREBASE_BD_SERVICE_ACCOUNT_JSON`。缺少設定就回報錯誤，不回退使用 A。

**部署時必須確認 BD 安全規則**，拒絕瀏覽器直接讀寫 `allianceFriendChats` 及其 `messages` 子集合，只有後端 Admin SDK 代理。可將此 match 加入現有 BD 的 Firestore rules：

```firestore
match /allianceFriendChats/{threadId} {
  allow read, write: if false;
  match /messages/{messageId} { allow read, write: if false; }
}
```

**不要覆蓋原有洞天權限規則。** 此專案目前未提供 BD 規則的自動部署檔，須先在 Firebase Console 或運維配置中完成設定。

## 測試重點
1. A、B 雙向好友，A 傳訊後 B 仙盟導覽亮紅點；A 不亮自己的未讀提醒。
2. B 在私聊彈窗閱讀時，僅該好友已讀數歸零；新的未見訊息不會被舊讀取回報覆蓋。
3. 全服新訊息只亮全服聊天分頁按鈕，導覽保持不亮；進入全服頁後清除該提醒。
4. 刪除好友關係、切換帳號或未登入時不能再讀寫別人私訊。
5. 發送 HTML、超長文字、過快連發均不會執行任意程式或繞過伺服器驗證。
6. Firebase BD 無法使用時，只讓好友私聊顯示故障，不影響其餘遊戲功能。
