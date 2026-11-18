# 多人副本 · 第 0～1 階段（私人房間基礎）

此階段只交付獨立的多人副本私人房間 API 與前端請求函式，尚未推出副本入口頁面、準備狀態、地圖、即時戰鬥及公開招募。後續階段才能在遊戲畫面中操作。

- 伺服器：`POST /api/dungeon/room`，須使用主帳號 Firebase A Bearer token。
- 動作：`create`、`join-code`（body: `roomCode`）、`get`（`roomId`）、`reconnect`、`leave`（`roomId`）。
- 前端：`public/cultivation/dungeon-room.js` 暴露五個同名功能的英文函式，可於後續組隊畫面使用。
- 副本房間採獨立 `dungeonRooms`、`dungeonRoomCodes`、`dungeonRoomMemberships`（Firebase C/raidRepository），不共用舊團本的 `raidRooms`，沒有入場券或戰鬥獎勵操作。
- 玩家顯示名稱取自 Firebase A 玩家資料。房碼六位大寫字母及數字，隨機安全生成；在 C 資料庫以代碼文件預留，於交易中避免重複房碼。
- 每名玩家至多一個有效副本房間；重複建立/加入請求不產生第二個座位；最多四人；私人房詳情只有已驗證成員可讀；隊長離開自動交接；最後一人離開會關閉房碼。
- 等待室硬性期限暫定兩小時。之後心跳/重連階段會再設計狀態與過期延續。房間內的 `ready` 目前只是預留欄位，不接受準備或開戰指令。
- 讀取房間不直接建立/更改玩家存檔，也不讀寫舊團本票券。房間資料、成員、房碼及成員索引由 Firebase C 交易更新。
- 單人允許開房。後續第 2～4 階段才接公開招募、隊伍 UI、正式準備及即時同步。

驗證：`node --test tests/dungeon-room-api.test.cjs`、`npm test`、`npm run check:module-versions`。
