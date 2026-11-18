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
