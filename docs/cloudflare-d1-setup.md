# 青雲問道：Cloudflare D1 初始化與搬遷

目前交付的是可測試、預設關閉的搬遷程式。**建立空白 D1 不等於舊資料已搬好；必須完成匯出、匯入、核對及切換。** 本文件沒有假定已登入你的 Cloudflare 帳號。

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

第一行只建立電腦裡的測試資料庫；**第二行才會初始化 Cloudflare 正式資料庫**。看到待執行的 migrations 時確認執行。

驗證：

```bash
npx wrangler@4 d1 execute qingyun-game-prod --remote --config cloudflare/d1/wrangler.jsonc --command="SELECT name,type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name;"
```

應看見 documents、document_versions、collection_versions、d1_version_guard，以及 players、caves 等 view。此時 `players` 沒有玩家是正常的，舊資料尚未匯入。

後台也可進入資料庫 → Console 執行上面 SELECT；若只使用後台建表，依序貼上 `0001_document_store.sql` 和 `0002_query_indexes.sql`。建議使用 migrations 指令，才能保留版本紀錄。

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

在執行搬遷工具的電腦上，把同樣的密鑰／服務帳戶放進本機 `.env`（不提交 Git），以便讀來源、寫 D1。

若 `FRIEND_CHAT_STORAGE=postgres` 已啟用，私訊原本就在 PostgreSQL，並非 Firebase 資料；本工具不搬 PostgreSQL。保留它的設定即可。仍用 Firestore 私訊時，切換後原私訊 API 會使用 BD 的 D1 存取層。

## 7. 正式搬資料：先停止所有舊來源寫入

1. 保存 A／BD／C 三個專案各自目前的 Firestore Rules，供回復使用。
2. Render 所有執行個體設 `GAME_DATA_MAINTENANCE=1`，重新部署，等待舊執行個體完全退出，確認 API 回傳維護狀態。維護模式也不啟動團本背景排程。
3. 關閉舊版 A→BD 自動搬遷：`FIREBASE_AUTO_MIGRATE_ON_START=0`。
4. 停止任何其他會寫這三個專案的管理腳本／服務，等待既有寫入結束。
5. 在三個 Firestore 專案發佈暫時的全封鎖規則，阻止尚未更新的瀏覽器繼續直接寫入。維護期間會暫停遊戲。

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

Admin SDK 會繞過 Rules，所以只改規則還不夠，Render 與其他服務也必須停寫。登入服務不受 Firestore Rules 影響。

匯出到一個**全新**的私人資料夾，例如：

```bash
npm run migrate:d1 -- --export --source-frozen --directory=.d1-migration/final-20261019
```

工具會盤點三個專案的所有集合與子集合，產生 `snapshot.ndjson` 與 `manifest.json`，保存 UID、文件路徑、時間戳記秒／奈秒及每筆 SHA-256。父文件不存在而子集合仍有資料的情況也會處理。會產生 Firestore 讀取量；來源配額用盡時應先等恢復，勿把未完成的匯出拿去切換。

匯出中斷時 `complete` 不會標為 true；請保留失敗資料夾供檢查，改用新的資料夾重做。這些檔案包含玩家私有資料，已加入 Git 忽略；請另做自己的安全備份。

## 8. 匯入 D1，再核對

確認 D1 是準備切換、尚未提供正式寫入的獨立目標：

```bash
npm run migrate:d1 -- --import --target-frozen --directory=.d1-migration/final-20261019
npm run migrate:d1 -- --verify-only --directory=.d1-migration/final-20261019
```

匯入只新增缺少資料：相同資料略過、不同資料停止，不會默默覆蓋。遇到網路中斷可重新執行匯入，相同文件會略過。

核對需要看到 `verified: true`，且 matched 與匯出 documents 筆數相符。工具核對每筆內容 SHA-256，還會檢查目標是否多出匯出中沒有的文件。核對前不可讓測試玩家寫入正式目標，否則目標多出資料會被指出。

Cloudflare Console 可查看：

```sql
SELECT * FROM collection_inventory ORDER BY namespace,collection_path;
SELECT uid,display_name,cultivation,gold FROM players LIMIT 20;
SELECT namespace,id,status FROM battle_rooms LIMIT 20;
```

不要在 Console 直接改背包或獎勵；直接修改會繞過版本表，破壞交易一致性。日後所有正式寫入都要透過本存取層。

## 9. 切換正式網站

只有 frozen snapshot 核對成功後，才在 Render 改成：

```dotenv
GAME_DATA_BACKEND=d1
GAME_DATA_MAINTENANCE=0
FIREBASE_AUTO_MIGRATE_ON_START=0
```

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

- **切換前**：來源沒有被搬遷工具刪除或覆寫；先停匯入，保留維護，排查後重跑。不需要刪 Firebase。
- **D1 尚未接受任何新寫入**：可以先把 Render 維持維護、設回 firestore，再恢復原 Firestore Rules，最後解除維護。
- **D1 已接受玩家新寫入**：不要直接把開關切回 firestore，否則玩家會回到舊進度。先停止寫入並備份 D1，制定增量回灌／恢復方案後再決定。此工具不提供自動反向回灌。
- **出現 401**：檢查 Render 的 D1_SERVICE_TOKEN 是否與 Worker SERVICE_TOKEN 相同，以及 Firebase 登入是否有效。
- **出現 D1 gateway unavailable**：檢查 Worker 部署、DB binding、migrations、密鑰與配額。正式資料庫仍不能靜默退回舊來源。
- **verified 失敗**：依 namespace/path 找出差異，確認凍結完整；不要用覆蓋所有目標資料來繞過核對。

## 官方文件

- 初始化、DB binding、後台操作：https://developers.cloudflare.com/d1/get-started/
- SQL migrations：https://developers.cloudflare.com/d1/reference/migrations/
- D1 batch 原子性：https://developers.cloudflare.com/d1/worker-api/d1-database/
- 配額計費：https://developers.cloudflare.com/d1/platform/pricing/
- 限制：https://developers.cloudflare.com/d1/platform/limits/
