# 第一階段：Render ＋ Supabase PostgreSQL 好友私訊

## 已實作的範圍

現有 `/api/alliance-chat/inbox|thread|send|read` 可切換至 PostgreSQL。前端介面與 API 格式不變，不必安裝前端 Supabase SDK。Firebase A 仍負責 ID token 與即時雙向好友驗證；全服聊天、答題紀錄、背包、貨幣、交易尚未搬移。切換後，私訊的會話、訊息、未讀數與跨後端實例的發送冷卻皆存在 PostgreSQL，不再使用 Firebase BD 聊天集合。好友驗證仍會讀取 Firebase A，不能宣稱 Firestore 用量歸零。

Supabase 專案：`chjhs-qa-fighting`，ref `bdngxkniaugruvlrjzoc`，新加坡。私有 schema `game_private`，三張表均已啟用 RLS，拒絕 `anon`、`authenticated`，未提供瀏覽器直接存取。原始 Firebase UID／訊息 ID 使用 `text`，不重新產生身分。資料庫不存登入密碼或 Firebase ID token。

## Render 連線設定

1. 在 Supabase 的 SQL Editor 建立專用登入角色，使用密碼管理器產生密碼，僅授予現有 `game_chat_backend` 角色。不要使用 `postgres` 管理員作為應用程式長期帳號。以下密碼為佔位內容，必須替換：

   ```sql
   create role game_chat_render login password '<GENERATE_A_STRONG_PASSWORD>';
   grant game_chat_backend to game_chat_render;
   ```

2. 在 Supabase **Connect → Session pooler** 複製 PostgreSQL 連線資訊。將帳號改為專用角色（pooler 通常為 `game_chat_render.<project-ref>`），保留該面板提供的 host、port、database。密碼若有特殊符號須 URL encode；不要猜測 pooler hostname。
3. 在 Render secret environment 設定 `SUPABASE_DB_URL`，切勿填入瀏覽器設定或提交 Git。連線固定驗證 TLS；若需要 Supabase CA，將官方下載的憑證設定成 Render secret file，並以 `SUPABASE_DB_CA_FILE` 指向該檔案。不得以關閉 TLS 驗證解決憑證錯誤。
4. 初期保留 `FRIEND_CHAT_STORAGE=firestore`、`FRIEND_CHAT_READ_ONLY=0`。連線池每程序最多 4 條連線，查詢與連線皆有 10 秒逾時。正式切換必須依下一節執行。

初始 DDL 已透過 Supabase 工具套用，Git 中 migration 已依工具回傳的遠端版本 `20261017003239` 對齊。連結既有專案後先核對 migration history；新空白專案可直接套用 Git 中的 migration。

## 停寫、搬移、核對、切換

以下命令在可信任的後端管理環境執行，需設定 BD 服務帳號和目標 `SUPABASE_DB_URL`。腳本會載入本機 `.env`；該檔不可提交。Render 機密設定無法由此 GitHub 程式修改代為完成。

1. 確認 BD 的 Firestore 規則已拒絕瀏覽器直接寫入 `allianceFriendChats` 與子集合。備份來源。設定所有 Render 實例 `FRIEND_CHAT_READ_ONLY=1` 並完成部署、等待舊實例停止；同時停止其他聊天寫入腳本。這也凍結已讀回報，避免複製途中未讀數改變。停寫時仍可讀取聊天。
2. 檢視來源／目標差異（**會產生一次性 Firestore 讀取費用**）：

   ```sh
   npm run migrate:friend-chat
   ```

3. 在確認來源已停寫後執行：

   ```sh
   npm run migrate:friend-chat -- --execute --source-frozen
   npm run migrate:friend-chat -- --verify-only
   ```

   每頁最多 200 筆；逐一比對會話欄位、訊息 ID、寄件人、全文與毫秒時間，另檢查筆數和多餘資料。保留原始資料且不刪除、不覆寫目標既有內容。中斷後可重跑；不同內容或多餘資料會阻止核對通過，必須人工查明原因。日誌只輸出計數，不輸出私訊內容。搬移完會自動再完整核對一次；正式切換前再執行一次 `--verify-only`。大量資料宜安排低峰時段，避免反覆 dry run。
4. 核對全數通過後，在所有 Render 實例設定 `FRIEND_CHAT_STORAGE=postgres`，保持 `FRIEND_CHAT_READ_ONLY=1` 完成部署，先用兩個雙向好友帳號確認舊訊息、未讀數與時間正確。
5. 解除停寫 `FRIEND_CHAT_READ_ONLY=0` 並部署。驗證雙向傳訊、仙盟紅點、閱讀後清除未讀、解除好友後無法再看私訊，並監測後端錯誤及 BD 聊天集合的讀寫量。

腳本無法自動保證外部所有寫入者均已停用；`--source-frozen` 是操作者對此狀態的明確確認。正式環境沒有自動搬移／雙寫，以免兩庫的已讀狀態分歧。PostgreSQL 故障時回報錯誤，不會靜默寫回 BD。

## 回復與後續

- **解除停寫前**可切回 `FRIEND_CHAT_STORAGE=firestore`。來源仍完整保留。
- **PostgreSQL 已接受新訊息後**，BD 即為舊副本。此時不可直接切回；需先凍結所有聊天寫入，再修復 PostgreSQL 或另行執行經核對的反向搬移。本階段沒有自動反向搬移工具。
- 維持相同固定 ID 並先搬獨立功能，可以避免重複領取資源。下一階段需盤點一般答題／對戰／秘境／閉關的 `exam_logs` 寫入與獎勵交易，將紀錄儲存與貨幣結算分離後，再做單獨的遷移。背包、貨幣與交易應最後處理，保留完整交易帳與冪等結算鍵。

## 驗證

`npm test` 包含 provider 隔離、登入／好友授權、停寫與不回退測試。GitHub Actions 使用 PostgreSQL 17 容器實際執行 DDL、並發傳訊、跨會話冷卻、已讀競態、交易失敗回滾、匿名權限拒絕與搬移重跑／衝突測試。本機若未設定 `TEST_CHAT_DATABASE_URL` 則僅略過此真實資料庫測試；該變數必須指向可拋棄、尚無 `game_private` schema 的測試庫，測試會拒絕重用既有 schema。
