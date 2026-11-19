# 多人副本：第 0～2 階段（房間、公開招募、好友邀請）

本階段提供獨立的副本隊伍服務與好友邀請通知。**第 3 階段才新增正式組隊、準備及出發介面**；目前尚無副本地圖、即時戰鬥、獎勵或啟動副本指令。

- 驗證：所有 `POST /api/dungeon/room` 動作使用主帳號 Firebase A 的登入票證，副本房間資料存在 Firebase C，與舊 `raidRooms`、`tacticalBattleRooms` 分離。
- 私人房間：`create`（預設私人）／`join-code`／`get`／`reconnect`／`leave`，六碼房碼只有隊員才看得到。
- 公開招募：`create` 可指定 `visibility:"public"`；`set-visibility` 僅房主可切換；`list-public` 只呈現未過期、尚未滿四人、有效房主仍在隊伍內的等待中公開房間。公開資料不包含房碼、UID 或隊員詳細資料。
- 公開加入：`join-public` 透過房間 ID 入隊，交易內再次檢查公開狀態、剩餘名額與過期時間。即使知道私人房間 ID 也不能藉此加入。
- 快速組隊：`quick` 優先加入人數較多的公開隊伍；無可加入隊伍則建立公開房。已在有效隊伍中的玩家直接返回原房間（不擅自公開私人房）。
- 好友邀請：`inviteDungeonFriends(room, friendUids)` 使用現有 `/api/invitations/send`，伺服器重新驗證邀請者為目前有效房主、房碼正確、房間尚有名額，只向已確認為好友的接收者推送；接受時呼叫 `join-code` 再次驗證。舊主頁邀請通知已支援「合作副本邀請」與加入事件。
- 伺服器的好友通知沿用既有短時佇列（目前 2 分鐘），跨多個 Render instance 的長期可靠通知與正式房間即時同步仍屬後續第 4 階段。
- 預留 `ready` 欄位但不啟用 `start`；第 3 階段新增正式遊戲內隊伍、準備介面，第 4 階段新增持續同步。
- 副本不消耗舊團本入場券，不寫入舊戰場紀錄，也不發放獎勵。

驗收：`node --test tests/dungeon-room-api.test.cjs tests/dungeon-public-recruitment.test.cjs tests/dungeon-friend-invitations.test.cjs`、`npm test`、`npm run check:module-versions`。

## 第 3 階段：集結與隊長管理

- 已加入 `ready`、`kick`、`disband`、`start`、`cancel-start` 的伺服器權威操作。僅隊員可以準備；踢人、解散及集結／取消集結僅隊長操作。相同準備值、重複開始與取消不重複增加版本。
- `start` 會在全隊準備後，將房間狀態從 `waiting` 轉為 `assembled`。這只是**集結完成**，不代表已進入未實作的探索地圖；可由隊長 `cancel-start` 回到等待室，重新要求全員準備。集結中不接受新玩家加入。
- 隊員在集結中仍可離開，剩餘隊伍重回等待室；隊長離開則轉交新隊長。解散房間在交易內撤銷各成員指向該房間的索引，並關閉房碼。
- 隊員的境界／修為由伺服器主專案可信快照推算，不依賴前端提供。
- 前端新 `public/cultivation/dungeon-lobby.js` 提供宗門「合作副本」入口、獨立集結畫面、隊員資訊與準備狀態、隊長管理、六碼複製與好友邀請、公開列表與快速組隊。暫以五秒間隔同步已開啟的等待室；第四階段會接正式即時串流。
- 額外修正既有問道試煉 Canvas 的長按原生選取／藍色反白及 iOS callout；`touch-action:none` 只限制戰場互動區域，問答文字及輸入框仍可正常選取。

## 第 4 階段：可靠的跨裝置即時同步與在線狀態

- `POST /api/dungeon/room` 新增 `subscribe`（帶 Firebase A 授權標頭的 SSE 長連線）及 `heartbeat`（僅隊員可回報）。`dungeon-room-stream.cjs` 使用 Firebase C `onSnapshot` 觀察權威房間文件，支援不同 Render 執行個體／不同裝置共同接收狀態；不依賴單一 Node 進程記憶體。
- 初次訂閱先驗證隊員及未過期狀態，再傳送經過同一 `publicRoom` 投影的資料。串流以遞增 `revision` 去重；被踢、房間關閉或過期立即回傳 403／410 並終止，防止已失去資格的玩家繼續讀取。
- 房間串流每 15 秒發 keepalive、最高 1 MB 等候寫入、每 4 分鐘關閉重新驗證 Firebase A token；斷線由客戶端以退避重新連接。房間狀態透過 HTTPS POST，不把登入憑證放到 URL 或本地儲存。
- 心跳約每 20 秒送出，伺服器設 12 秒最小寫入間隔。由伺服器記錄 `heartbeatAtMs`，超過 60 秒無更新在介面顯示「離線」，但**不因暫時離線把玩家踢出或清除準備狀態**。
- 當已建立的隊伍剩餘存活時間低於 30 分鐘，心跳在同一 Firestore 交易續期房間及六碼房碼至兩小時（先確認代碼仍屬於這個房間）。
- 前端以串流為優先，不再在正常連線時每五秒讀取房間。離線時才使用有退避的驗證 GET 補查；隱藏／離開頁面會關閉串流，重新回到頁面會重新建立訂閱。
- 每個回應只可更新自己已加入的房間；用 `revision` 擋掉落後的 HTTP 回覆與過期串流封包，不讓舊準備狀態蓋掉新的狀態。切換帳號或退出畫面關閉訂閱。
- 介面顯示「即時同步／重新連線中」及各隊員「在線／離線」，長時間無心跳只影響顯示，不影響誰能操作；先前階段的私人／公開／隊長權限維持由伺服器決定。
- **本階段仍未開放副本地圖或戰鬥**。伺服器 `start` 只代表集結完成的 `assembled` 狀態，將於下一批地圖階段接入實際進場。

測試：`node --test tests/dungeon-*.test.cjs`、`npm test`、`npm run check:module-versions`。

## 第 5 階段：種子碼副本地圖 v1（生成與驗證）

此階段僅交付**伺服器權威地圖資料**，第 6 階段才加入 Canvas 地圖檢視與拖移縮放，第 7 階段再加入玩家移動及障礙碰撞。**目前按下「確認集結出發」仍僅進入 assembled 隊伍狀態，沒有啟用戰鬥或獎勵。**

### 地圖與資料契約

- 純演算法 `dungeon-map-generator.cjs`：`generateDungeonLayout(seed)` 產生 `layoutVersion:1` 的可重現地圖；在 Node.js 與不同 Render instance 上同種子必然得到相同的 JSON。禁止修改 v1 的已發布生成規則；未來新增變化應開新版本。
- 建立副本房間時由**伺服器**產生密碼學隨機的 24 碼十六進位 `mapSeed`，與 `mapVersion` 一起持久化於 Firebase C `dungeonRooms`。玩家不能指定／覆寫種子。邀請碼與地圖種子碼互相獨立。
- `POST /api/dungeon/room` 的 `get-map`（body 僅需要 `roomId`），必須使用 Firebase A 登入 Token，且需要實際在該個未關閉、未過期的房間中。當玩家被踢、退出、房間解散或逾時，均不再開放讀取。
- 此路徑不寫入地圖文件，也不消耗舊團本票券、體力或獎勵。多人玩家、斷線重連與不同後端 instance 可透過儲存的 `mapSeed` 重新取得完全一致的藍圖；舊版本已建立、沒有 `mapSeed` 的等待中房間以 `legacy:<roomId>` 派生固定種子，毋須遷移資料。
- `publicRoom`／SSE 房間快照與公開招募列表**不透露** `mapSeed`；地圖內容只在隊員授權讀取時傳回。前端 `getDungeonMap(roomId)` 對應此 API，未在瀏覽器自行產生或覆寫地圖。
- 地圖 `tiles` 為 row-major 長度 `width*height`：`0` 為不可通行牆面、`1` 為通道地面、`2` 為較開闊的地面；地圖四周必為牆，所有可通行格構成**同一個 4-方向連通分量**。
- 11～12 × 9～10 個邏輯地格經放大形成約 **47～51 × 39～43** 的實際格網。生成器以隨機化深度優先迷宮樹抽取**非自交、蜿蜒主路線**（至少 5 個轉彎），另添 **2～4 條實際接通且有盡頭的支線**，預留不規則空地與至少 2 格寬的通道。
- 地圖包含 `spawn`、四個不同的 `spawnPads`、`mainRoute`、`branches[]`（`entrance`／`end`／`route`）、`deepest`、`guardianSite`、`portalSite`、`biome` 與 `layoutId`。`guardianSite` 位在主線最深端，支線出口不會比它更深；`portalSite` 在最深端前方四格，供後續階段使用。
- 四種地貌名稱：青竹幽徑／殘碑古道／霜嶺石窟／雲隱荒澤。現階段是**生成資料與地貌主題**，不是已完成美術或遊戲場景。

### 驗收

- `tests/dungeon-map-generator.test.cjs`：1,200 個種子碼的決定性、支線數量、轉彎數、牆邊界、主支線逐格連通、四人出生點、唯一連通分量、支線深度、地貌多樣性及不可變版本。
- `tests/dungeon-map-api.test.cjs`：伺服器種子保存、請求端不能自訂種子、四名隊員／兩個 server instance 的地圖完全相同、未授權拒絕、集結後不更動、解散後不可讀、舊房間無種子時的穩定 fallback。
- 專用 CI `Dungeon co-op synchronization acceptance` 會一併檢查 `dungeon-map-generator.cjs` 語法並執行所有 `tests/dungeon-*.test.cjs`。

## 第 6 階段：副本地圖視覺與鏡頭（預覽模式）

- 繼續使用第 5 階段的同一個 `get-map` 授權 API；前端不自行產生地圖、不儲存種子、不改寫房間或玩家位置。
- 宗門「合作副本」等待室新增「檢視地圖」按鈕，隊伍集結完成時會在各隊員已開啟的組隊介面自動進入讀取地圖的展示頁。重新連線時若房間仍為 `assembled` 也能恢復預覽；玩家關閉預覽後不會被同一狀態連續強制彈回。
- `dungeon-map-camera.js` 提供視窗符合比例的相機，支援滑鼠滾輪／觸控雙指縮放（`1～6×`）、單指與滑鼠拖曳、按鈕縮放、全圖、定位四個預留出生點、方向鍵與橫直式／視窗尺寸變換。Zoom 使用指標座標錨點，地圖不允許完全滑出畫面。
- `dungeon-map-painter.js` 使用既有 `tiles` 地圖資料繪製通道、岩壁、空地紋理、四種色調不同的地貌，並標註出生點、守護者、傳送陣及四個隊員預留位置；路線提示可由使用者開關。右上角縮圖會顯示鏡頭在整張地圖中的位置。
- `dungeon-map-view.js` 是獨立的全畫面展示視窗，包含可點擊的地圖控制、鍵盤替代操作、有效隊員身分檢查、尺寸觀測與載入錯誤重試。地圖呈現透過 `requestAnimationFrame` 排程，不重複建立永久動畫迴圈；關閉時清理動畫、觀察器與操作狀態。手機地圖 Canvas 停用系統長按反白，不影響答題輸入。
- **本階段是「地圖預覽」，並沒有開始探索、移動、靈獸、獎勵或角色同步。** 第七階段才把四名玩家的伺服器權威位置與體力及碰撞接上，此時定位只跟隨玩家的*預留出生點*，不是假裝玩家已經移動。
- `tests/dungeon-map-camera.test.cjs` 對不同螢幕比例、縮放與視角限制、resize 和 map 不可變性進行檢查；`tests/dungeon-map-view.test.cjs` 對四種地貌、縮圖及功能接線進行測試。

## 第 7 階段：伺服器權威的多人步進探索

本階段將第六階段的地圖預覽接上**實際四人獨立移動**。仍沿用集結後的 `status: assembled`，不提前新增尚未完成的敵人 AI、攻擊、答題充能或獎勵。

### 狀態與移動權限

- `start` 通過全隊準備驗證後，在**同一個 Firebase C 交易**中，按加入順序把四位隊員放到各自的 `map.spawnPads`，設定每人 `position:{x,y}`、`explorationStamina:100`、`moveSeq:0`；也支援舊房間沒有地圖種子碼的固定版型。
- 只有 `assembled` 狀態下、真實登入的隊員才可呼叫 `POST /api/dungeon/room` 的 `action:"move"`，提供 `roomId`、`dx`、`dy`、`step`。`dx,dy` 必須是整數且 `|dx|+|dy|=1`（上下左右一格）；不接受由瀏覽器提供終點、位置或剩餘體力。
- `dungeon-movement.cjs` 使用**伺服器保存的地圖種子碼**再生同一張地圖，逐步核對位置與地圖 `tiles`，拒絕斜走、瞬移、出界與撞牆。通行的每一格消耗 **1 點副本探索體力**；撞牆或錯誤請求不扣體力也不改寫房間。
- `moveSeq` 由每位玩家各自遞增，Firestore 交易驗證 `step===moveSeq+1` 才能接受；同一個上一筆指令若完全相同可重送且**不再扣體力**，過時／跳號／不同方向的指令會拒絕。不同裝置、不同 Render 執行個體同時發送，也只能以成功交易的結果為準。
- 玩家彼此**不會阻擋通道**：允許共同站在同一個格子，Canvas 會把重疊的隊員圖示稍微錯開，避免合作副本中的卡位或阻擋。每人的位置、體力與 `moveSeq` 相互獨立。
- 每個成功移動更新房間 `revision` 和該隊員的資料，經第四階段 Firestore `onSnapshot` SSE 即時同步到其他隊員。斷線重連可以從伺服器恢復當前位置及探索體力，前端只送方向指令，不樂觀修改地圖狀態。
- 若隊伍尚未完成集結、房間過期、玩家已被踢／離開、體力耗盡或撞牆，伺服器會回覆錯誤且不移動。已有人成功走出第一步時不允許隊長單純「取消集結」，避免進度被隱性倒帶；隊員仍可退出，剩下的人返回等待室並在再次集結時開始新的探索。
- 本階段的 **100 點探索體力是暫定副本專用值**，並非玩家原有一般體力、舊團本票券或問道試煉的能量，也不會寫入主玩家帳戶。答題補充探索體力將在後續的「獨立答題與充能」階段接入，現階段耗盡時會停止移動，不會假裝能充能。

### 介面

- `dungeon-map-view.js` 加入手機／平板的四方向按鈕、`W/A/S/D` 鍵盤步進控制，以及目前探索體力／格子位置 HUD。方向鍵仍可平移視角；地圖仍支援原本的拖曳、雙指縮放、定位、路線切換與全域縮圖。
- 成功第一步後預設放大並跟隨自己的**實際伺服器位置**；觸控拖曳和滾輪操作鏡頭仍不消耗探索體力。地圖及縮圖上的隊友標記使用同一份 Firebase 房間狀態，每人可以獨立移動。
- 玩家點擊移動後在伺服器確認前停用重複操作。409 錯誤會重新讀取權威房間，避免同一個玩家在不同裝置上使用舊 `moveSeq`；房間更新會依前一階段的單調 `revision` 規則，回饋給等待室與地圖。
- 集結後等待室顯示「進入探索」，不再宣稱無法移動；任何人成功移動後，不再顯示可取消探索的按鈕（只有完成集結但尚未有人走動時可返回等待室）。

### 驗證

- `tests/dungeon-movement.test.cjs`：檢查一千兩百張地圖上的四人出生點、上下左右移動、重複封包、撞牆、不合法座標／序號與體力耗盡。
- `tests/dungeon-room-movement.test.cjs`：檢查多人在兩個伺服器執行個體上的位置／體力一致性、獨立併發、斷線重連、不扣舊團本票券、離開與過期權限。
- `scripts/test-dungeon-map-browser.cjs`：保留兩個 Chromium 頁面模擬雙玩家進房、集結、觸控縮放及手機桌面版型，新增雙方可獨立移動且各扣一格的行為驗收。
- 專項自動測試命令：`node --test tests/dungeon-*.test.cjs` 與 `npm run check:module-versions`。 

## 第 8 階段：伺服器權威即時戰場時鐘

### 時間資料與交易一致性

- `dungeon-battle-clock.cjs` 定義不可變版號 `CLOCK_VERSION=1` 及 `TICK_MS=1000`。**不使用玩家端時鐘計算戰鬥結果**。隊長集結成功時，在保存四個出生點的同一 Firebase C 交易中寫入 `battleStartedAtMs`（伺服器時戳）、`battleAppliedTick=0`、`battleAppliedAtMs` 及版本。
- 所有隊員看見的 `room.battleClock` 由 `publicRoom` 按同一個起始時間及**回應端當前伺服器時間**計算，包含 `version`、`tickMs`、`startedAtMs`、`serverNowMs`、`elapsedMs`、`tick`、`appliedTick` 及 `nextTickAtMs`。等待室與已關閉的房間不回傳進行中的時鐘。
- `elapsedMs` 與當前邏輯 `tick` 由已過的實際伺服器時間推導；即使所有玩家暫時離開畫面或 Render instance 重新啟動，也**不重置或暫停**。玩家回來後無須以客戶端補送舊的每一秒；伺服器根據起點計算當前 tick 並恢復。
- `battleAppliedTick` 為**已提交的節拍游標**，和即時計算的 `tick` 分開。簽名 `POST /api/dungeon/room` 的 `action:"clock"` 會在同一 Firestore 交易檢查房間仍有效且使用者仍為隊員，僅於 tick 增加時提交 `battleAppliedTick`、`battleAppliedAtMs` 和 `revision`。同一 tick 在多台伺服器競爭時只會提交一次，沒有新 tick 不寫入；任何客戶端提供的時間、tick、暫停參數皆忽略。
- `subscribe` SSE 連線在集結中每秒由伺服器觸發一次有節流的 transaction 嘗試；透過 Firebase C `onSnapshot` 將新 revision 傳給所有裝置；停止訂閱／斷線／房間失效便清理 timer。當沒有任何連線時，不進行無謂的每秒資料庫寫入，但邏輯時鐘仍依伺服器時間推進；重新訂閱、移動、心跳或 `clock` 請求都能追上已過秒數。
- 移動和心跳會在既有 Firestore 寫入交易內同步補上應有的 tick，避免玩家無法訂閱時先移動而時鐘落後。多人位置、體力、題目資料、入場票券不被時鐘修改。原有 `get`／`reconnect` 只用權威時間顯示，不額外收費或強迫寫入。
- 舊的已集結房間若沒有 `battleStartedAtMs`，使用既有 `assembledAtMs` 作為穩定的起點，不強制遷移；取消集結並重新集結時才開啟新時鐘。計時與線上心跳不同：玩家離線不會讓戰場暫停。

### 玩家畫面與後續承接

- `dungeon-map-view.js` 的上方 HUD 顯示 `戰場時鐘 mm:ss · Tn`。畫面每 250 毫秒更新文字，僅用 `performance.now()` 推估兩次伺服器快照間的視覺秒數，**不把瀏覽器時間寫回伺服器**。切換視窗、鏡頭拖曳、移動、打字或關閉地圖不影響伺服器時鐘；SSE 重連會依新的伺服器資料重新校準。關閉地圖清除專屬 timer。
- 本階段**尚未新增靈獸 AI、傷害／攻擊、答題充能**。第 9 階段才讓敵人的位置及行動與 `battleAppliedTick` 共同納入伺服器交易；有客戶端連線時自動推進，無客戶端連線時的歷史 tick 將由未來 AI 模組決定如何補跑。此階段只負責可靠的時間、權限、事件發送及顯示，不偽稱 NPC 已自行活動。
- 專項測試 `tests/dungeon-battle-clock.test.cjs`、`tests/dungeon-battle-clock-api.test.cjs`、`tests/dungeon-clock-stream.test.cjs` 驗證時間計算、舊房間、伺服器爭用、重連補時、取消集結及 SSE 資源清理；雙玩家 Chromium 測試加入雙方時鐘在**無移動時也會前進**且同一節拍附近同步的驗收。
