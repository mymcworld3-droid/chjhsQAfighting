# 青雲問道：Cloudflare D1 初始化與搬遷

目前程式在設定好 D1 連線後，會由管理員登入自動啟動後端搬遷；正式遊戲預設仍使用 Firestore。**建立空白 D1 不等於舊資料已搬好；必須完成自動複製、最終核對及切換。** 本文件沒有假定已登入你的 Cloudflare 帳號。

## 資料如何整理

保留原 UID 與完整文件路徑，以 `namespace` 區分來源；先保存現有遊戲的動態 JSON 結構，避免把背包、金丹、任務等欄位拆表時遺漏資料。不是只搬玩家主檔，也不會把 A 和 BD 的同名洞天混在一起。

| 來源 | 功能／代表資料 | D1 整理方式 |
| --- | --- | --- |
| A：question-learning | users、exam_logs、背包／法器／修為、products、marketListings、gameConfig | namespace=A，保留原 collection_path 與 path |
| A | 任務、閉關、抽獎、獎勵憑證、問道試煉、玩家分析 | 同上；由原有後端處理獎勵，憑證不開放前端直接修改 |
| BD：xiuxian-dongtian-bd | dongtians、dongtianIndex、dongtianReports | namespace=BD，內容與索引分開保存 |
| BD | 好友私訊及 messages 子集合 | 完整保留父子路徑，透過原有好友 API 驗證雙方身分 |
| C：xiuxian-battle | rooms、raidRooms、playerProfiles 等 | namespace=C，與 A 的舊 rooms 分開 |
| A／BD／C 其他集合 | 包含未預先列出的集合、子集合、已不存在父文件下的子集合 | 匯出工具遞迴盤點並保存，不靠固定名單挑資料 |
| Firebase Authentication | Google／匿名登入、既有帳號 UID | 保留；D1 不提供身分驗證 |
| Firebase Storage（若有使用） | 圖片、音訊、影片物件 | 不放進 D1；本次搬遷工具只處理 Firestore；之後可另外搬 R2 |

SQL 管理表與檢視：

- `documents`：正式資料。複合主鍵 `(namespace,path)`，可索引 JSON 欄位。
- `document_versions`：包含刪除記錄的版本表，阻擋舊交易覆蓋新資料。
- `collection_versions`：讓集合查詢的交易偵測新增／刪除資料。
- `d1_version_guard`：同一 SQL batch 中的版本檢查；失敗時整批回滾。
- `d1_admin_migration_jobs`／`tasks`／`documents`：管理員觸發工作的租約、佇列、逐筆核對與續傳進度。
- `collection_inventory`：按來源與集合查看筆數、大小。
- `players`、`caves`、`battle_rooms`：方便查閱的 SQL view；修改資料仍經後端。

連線是「瀏覽器 → Render 後端 → 私有 Cloudflare Worker → D1」。Worker 只接受持有服務密鑰的後端；資料庫密鑰不放在瀏覽器。

## 1. 準備專案與工具

在電腦安裝 Node.js 22 或 24 LTS，開啟終端機，進入有這份修改的專案根目錄：

```bash
cd chjhsQAfighting
npm ci
npx wrangler@4 login
```

`login` 會開啟 Cloudflare 登入／授權頁面，由你在自己的電腦完成登入。**不要把 Firebase 私鑰、Cloudflare API Token 或完整 .env 貼到聊天裡。**

若拿到的是 `changes.patch`，先在對應版本的專案根目錄執行 `git apply --check /你的路徑/changes.patch`，確認成功後再執行 `git apply /你的路徑/changes.patch`。套用失敗代表版本不同，先處理差異，勿強行覆蓋。

## 2. 建立 D1 資料庫

可選後台或終端機其中一種，不要建立兩次同名資料庫。

後台操作：

1. 打開 https://dash.cloudflare.com/ ，選擇帳戶。
2. 進入 **Storage & databases → D1 SQL database**（可用側欄搜尋 D1）。
3. 按 **Create Database**。
4. 名稱填 `qingyun-game-prod`。
5. 若可指定 Location hint，選 Asia Pacific／APAC。
6. 按 Create，複製畫面中的 **Database ID**。

終端機等效指令：

```bash
npx wrangler@4 d1 create qingyun-game-prod --location=apac
```

若詢問是否自動修改其他 Wrangler 設定，選 No，下一步自行填入專案提供的設定。正式搬遷前可先另建測試資料庫及測試 Worker，完整演練一次；演練資料庫與正式資料庫不可共用。

## 3. 填入資料庫 ID

編輯 `cloudflare/d1/wrangler.jsonc`，把 `REPLACE_WITH_YOUR_DATABASE_ID` 換成剛才的 Database ID：

```json
"d1_databases": [{
  "binding": "DB",
  "database_name": "qingyun-game-prod",
  "database_id": "貼上你的 Database ID",
  "migrations_dir": "migrations"
}]
```

`binding` 保持 `DB`；程式透過它取得資料庫。Database ID 是識別碼，不能代替服務密鑰。

## 4. 初始化資料表

在專案根目錄執行：

```bash
npx wrangler@4 d1 migrations apply qingyun-game-prod --local --config cloudflare/d1/wrangler.jsonc
npx wrangler@4 d1 migrations apply qingyun-game-prod --remote --config cloudflare/d1/wrangler.jsonc
```

第一行只建立電腦裡的測試資料庫；**第二行才會初始化 Cloudflare 正式資料庫，並包含 `0003_admin_auto_migration.sql` 的續傳資料表**。看到待執行的 migrations 時確認執行。

驗證：

```bash
npx wrangler@4 d1 execute qingyun-game-prod --remote --config cloudflare/d1/wrangler.jsonc --command="SELECT name,type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name;"
```

應看見 documents、document_versions、collection_versions、d1_version_guard，以及 players、caves 等 view。此時 `players` 沒有玩家是正常的，舊資料尚未匯入。

後台也可進入資料庫 → Console 執行上面 SELECT；若只使用後台建表，依序貼上 `0001_document_store.sql`、`0002_query_indexes.sql` 和 `0003_admin_auto_migration.sql`。建議使用 migrations 指令，才能保留版本紀錄。

## 5. 部署私有 Worker

先在電腦產生一組服務密鑰：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

把這一串保存在自己的密碼管理工具，接著部署：

```bash
npx wrangler@4 deploy --config cloudflare/d1/wrangler.jsonc
npx wrangler@4 secret put SERVICE_TOKEN --config cloudflare/d1/wrangler.jsonc
```

第二行出現提示時，貼上剛才產生的密鑰；輸入不會寫進原始碼。部署指令會顯示類似 `https://qingyun-d1-gateway.你的子網域.workers.dev` 的網址，記下來。

若瀏覽器直接打開 Worker 看到 Unauthorized，是預期結果；它只服務後端，並未公開玩家資料。

確認 Worker → Bindings 中有 `DB`，指向 `qingyun-game-prod`。若使用後台部署 Worker，請使用專案的 `cloudflare/d1/src/worker.mjs`，並在 Bindings 加 DB、在 Settings 的 Secrets 加 SERVICE_TOKEN。

## 6. 設定 Render，先保留 Firebase 模式

在 Render 的服務 → Environment 設定：

```dotenv
GAME_DATA_BACKEND=firestore
GAME_DATA_MAINTENANCE=0
D1_WORKER_URL=https://qingyun-d1-gateway.你的子網域.workers.dev
D1_SERVICE_TOKEN=與Worker的SERVICE_TOKEN完全相同
D1_POLL_MS=5000
```

保留現有三組 `FIREBASE_*_SERVICE_ACCOUNT_JSON`，以及原本 AI 等環境變數。三組 Firebase 憑證仍供既有伺服器身分服務及資料匯出使用。請先部署相容程式，這時正式玩家仍讀寫 Firestore。

自動搬遷只需在 Render 設定密鑰／服務帳戶，不必下載到電腦。只有使用文末的手動 CLI 備份時，才需要在執行工具的電腦設定本機 `.env`（不提交 Git）。

私訊與其餘遊戲資料共用文件存取層。切換 D1 後，私訊會儲存於 BD namespace，不需要另外設定聊天資料庫。

## 7. 管理員登入，自動複製全部資料

在 Render 設定好 D1_WORKER_URL、D1_SERVICE_TOKEN，並執行完全部 migrations 後，維持：

```dotenv
GAME_DATA_BACKEND=firestore
GAME_DATA_MAINTENANCE=0
D1_AUTO_MIGRATE_ON_ADMIN_LOGIN=1
D1_SOURCE_WRITES_FROZEN=0
```

用原本的管理員帳號登入網站即可。後端會驗證 Firebase A 的登入憑證，以及正式 `users/{uid}.isAdmin === true`，再自動建立一份全站共用工作。

你不需要下載所有玩家資料，也不用執行匯出／匯入指令。一般玩家登入不會啟動工作，前端只收到筆數、進度和狀態，不會收到其他玩家的完整資料。

管理員畫面右下角會顯示「D1 資料搬遷」：

- **正在複製**：後端逐批盤點 A／BD／C 全部集合，逐筆讀取文件並寫入 D1；包含未登入的玩家、答題紀錄、獎勵憑證，以及所有子集合。
- **已複製**：這只是可在線上遊玩時執行的背景複製，還不能當作最終一致快照。玩家仍讀寫 Firestore。
- **暫停**：連線或配額不足時保存進度；配額不足時每小時再檢查，恢復後續傳，避免密集重試。伺服器重啟也會接續既有工作。
- **資料差異／已停止**：D1 有不同且不是本工作所寫入的資料時，停止以免覆蓋。解決差異後可按「重新檢查並續傳」。
- **最終核對完成**：只有下一步停寫後，才可能顯示此狀態。

多位管理員登入不會重複建立工作；完成背景複製後再登入，也不會重新讀取全部資料。關閉管理員網頁不影響後端執行。

第一次仍會產生 Firestore 讀取與 D1 寫入量；資料量很大時可能需要跨日完成。所有進度存在 D1，不依賴 Render 暫存檔或瀏覽器 localStorage。

## 8. 停寫後，自動補齊與最終核對

1. 保存 A／BD／C 三個專案目前的 Firestore Rules。
2. Render 所有執行個體設 `GAME_DATA_MAINTENANCE=1`，重新部署，等待舊個體完全退出。團本背景排程也會停止。
3. 關閉舊版 A→BD 自動搬遷：`FIREBASE_AUTO_MIGRATE_ON_START=0`，停止其他會寫這三個專案的腳本／服務，等待既有工作結束。
4. 在三個 Firestore 專案發佈以下規則，阻止尚未更新的瀏覽器繼續直接寫舊資料：

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

5. 確認所有來源已停寫後，在 Render 加上：

```dotenv
GAME_DATA_MAINTENANCE=1
D1_SOURCE_WRITES_FROZEN=1
```

6. 重新部署後，後端會自動續接管理員已授權的工作，執行最終一輪；若從未登入啟動工作，請先用管理員帳號登入。維護期間仍可使用 Firebase Auth；獨立的管理員搬遷面板不依賴玩家主畫面載入成功。
7. 等待面板顯示「所有來源資料已完成最終核對，可切換 D1」。後端狀態應為 `status: ready`、`verified: true`。

最終一輪會重新盤點集合與子集合，補上背景複製後新增／修改的資料，清除**本工作先前複製、且在停寫前已於來源刪除**的 D1 暫存文件，再檢查目標完整路徑集合與文件版本。不會刪除來源 Firestore。若 D1 目標被其他服務改過，會停止，不能靠重試強行覆蓋。

Admin SDK 會繞過 Firestore Rules，所以只改 Rules 不足以停寫，Render 與其他服務也必須停止。`D1_SOURCE_WRITES_FROZEN=1` 是你確認停寫完成後才設定的標記，程式無法從這個標記判斷其他外部服務是否已停寫。

Cloudflare Console 可查閱：

```sql
SELECT * FROM collection_inventory ORDER BY namespace,collection_path;
SELECT uid,display_name,cultivation,gold FROM players LIMIT 20;
SELECT id,state,updated_at FROM d1_admin_migration_jobs;
```

不要在 Console 直接改背包或獎勵；直接修改會繞過版本表，破壞交易一致性。

## 9. 切換正式網站

只有管理員搬遷工作最終核對為 ready／verified，且來源仍維持停寫時，才在 Render 改成：

```dotenv
GAME_DATA_BACKEND=d1
GAME_DATA_MAINTENANCE=0
FIREBASE_AUTO_MIGRATE_ON_START=0
```

程式不會自行更改 Render 的 GAME_DATA_BACKEND；需要你完成這次正式切換。之後管理員登入不會再從舊 Firestore 回灌。

重新部署後：

1. 先重新整理網站，確認 `/api/data-config` 回傳 `backend: d1`。
2. 用既有帳號登入，確認角色、修為、背包、金丹、任務都在。
3. 測試答題與答題紀錄、任務／閉關／抽獎／團本獎勵各一次，重新登入確認保存。
4. 測試好友加入、私訊、全服聊天、市集上架／購買／取消。
5. 用兩個測試帳號測鬥法與團本，確認房間狀態同步。
6. 測試洞天建立、回報、修復、結算，以及管理員圖鑑功能。
7. 檢查後端日誌與 D1 Metrics。確認來源 Firestore 沒有持續的新遊戲資料寫入。

正式 Firestore 規則保持封鎖，避免未更新的舊網頁繼續寫舊資料。已開著的頁面必須重新整理；切換前後不做靜默自動降回 Firestore，避免兩邊資料分岔。

即時更新改由已驗證的後端 SSE 推送；同一 Render 個體成功寫入會喚醒共用監聽器，其他執行個體的更新由預設 5 秒一次的共用輪詢補上。取消訂閱／關閉頁面會取消連線；背景分頁暫停連線，錯誤採退避重連。這不是 D1 原生即時監聽。

## 配額與實際限制

Cloudflare 官方目前列出 Free 每日 5,000,000 rows read、100,000 rows written、帳戶總儲存 5 GB；Free 單一資料庫上限 500 MB。Worker Free 另有每日請求與 CPU 限制。

**不能把 D1 的行讀取配額直接當作同樣數量的 Firestore 文件讀取。** 查詢掃描、索引、版本表與交易保護都有額外讀寫；本方案為相容搬遷，沒有承諾固定倍數的容量增加。特別留意寫入行數，先查看真實玩家流量的 Metrics 再調整。

本版本讓資料按 namespace／collection 分區，使用部分索引、集合查詢上限 1000 筆、共用監聽器與批次 SQL。若玩家數或某查詢會超過 1000 筆，先補分頁再切換，不能把截斷結果當完整總數。單筆含 JSON 的交易打包限制 1.8 MB，過大應分拆，不能拆開一筆必須原子完成的經濟交易。

舊遊戲部分修為／背包仍由前端計算後寫入；此搬遷保留這個行為，並額外阻止自升管理員、任意修改他人、直接寫入後端獎勵憑證。**這不等於已完成伺服器權威的全面防作弊重構。**

## 失敗與回復

- **切換前**：來源沒有被搬遷工具刪除或覆寫；可設 D1_AUTO_MIGRATE_ON_ADMIN_LOGIN=0 並重新部署以暫停工作，保留維護，排查後重跑。不需要刪 Firebase。
- **D1 尚未接受任何新寫入**：可以先把 Render 維持維護、設回 firestore，再恢復原 Firestore Rules，最後解除維護。
- **D1 已接受玩家新寫入**：不要直接把開關切回 firestore，否則玩家會回到舊進度。先停止寫入並備份 D1，制定增量回灌／恢復方案後再決定。此工具不提供自動反向回灌。
- **出現 401**：檢查 Render 的 D1_SERVICE_TOKEN 是否與 Worker SERVICE_TOKEN 相同，以及 Firebase 登入是否有效。
- **出現 D1 gateway unavailable**：檢查 Worker 部署、DB binding、migrations、密鑰與配額。正式資料庫仍不能靜默退回舊來源。
- **ready／verified 失敗**：依 namespace/path 找出差異，確認凍結完整；不要用覆蓋所有目標資料來繞過核對。


## 可選：手動檔案匯出／匯入

需要離線備份或手動搬遷時，舊版 CLI 工具仍可使用。先把 `D1_AUTO_MIGRATE_ON_ADMIN_LOGIN=0`，不要同時執行自動與手動工作。

先依第 8 步凍結所有來源寫入，再執行：

```bash
npm run migrate:d1 -- --export --source-frozen --directory=.d1-migration/final-snapshot
npm run migrate:d1 -- --import --target-frozen --directory=.d1-migration/final-snapshot
npm run migrate:d1 -- --verify-only --directory=.d1-migration/final-snapshot
```

匯出資料夾必須全新。`snapshot.ndjson` 與 `manifest.json` 包含玩家私有資料，已加入 Git 忽略；請自行安全備份。工具不覆寫不同的 D1 資料，也不提供上線後的自動反向回灌。

## 官方文件

- 初始化、DB binding、後台操作：https://developers.cloudflare.com/d1/get-started/
- SQL migrations：https://developers.cloudflare.com/d1/reference/migrations/
- D1 batch 原子性：https://developers.cloudflare.com/d1/worker-api/d1-database/
- 配額計費：https://developers.cloudflare.com/d1/platform/pricing/
- 限制：https://developers.cloudflare.com/d1/platform/limits/
