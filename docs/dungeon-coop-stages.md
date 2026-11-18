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
