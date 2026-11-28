# 自適應學習引擎 Beta — V1 資料與維運契約

## 邊界與部署前檢查
- Beta 資料只在 D1 namespace A 的 adaptiveEngineBetaV1_* 集合，與 legacy users、focusedUnits、stats.adaptiveLearningV1 分開。禁止在 Firestore A/BD/C 建立同名前綴的可信 Beta 資料。通用 D1 browser API 禁止任何 adaptiveEngineBeta 前綴，即使 admin。後端才可使用 service credential；不得把 credential 交給前端。
- Firestore A 實際 Rules 不在 repo，未宣稱正式 Rules 安全；不新增會覆蓋其他功能的完整 Rules。正式管理員需以實際部署權限檢查 reserved collections 不存在、客戶端不可讀寫、Admin SDK 權限受限。若要以 Firestore 儲存 Beta，必須另行設計及驗收，禁止 fallback。
- 在任何正式 Beta 持久寫入之前，確認 GAME_DATA_BACKEND=d1、D1 Worker namespace A、服務端身份驗證、完整回歸與 ADAPTIVE_LEARNING_ENGINE_STORAGE_REQUIRED=1；保留該 sticky 設定與 D1 憑證至全部資料安全移除。正式 release 另由第 26 階段控制。當前沒有正式個人資料寫入路由。
- 未啟用前的 Firestore-only 部署沒有 Beta 資料，無須建立新資料庫；若已要求 D1 但缺憑證，不得回報清除成功。D1 中所有個人集合需納入 PRIVATE_COLLECTIONS；新增版本前同步清除、授權與索引測試。

## 版本與遷移
V1 為初始獨立集合，不需要搬移 legacy 或 DDL。舊題僅可透過 fromLegacyQuestion 轉為 pending candidate；原資料不變，禁止複製 approval、答案曝光。未來 V2 採新集合、明確轉換、逐筆核對 schema/owner/版本與引用；先在隔離資料庫測 dry-run、寫入、重送、壞資料拒絕及回滾。不得就地覆蓋未知版本或讓轉換自行核准題目。
原有 Firestore→D1 遷移維持完整 path 對帳，reserved Beta 來源必須停機人工稽核，不可透過 legacy CLI 或 admin migration 匯入；切勿為通過對帳而刪除 Beta 資料。已持久化後不得重新執行舊全量 Firestore 覆寫或將 D1 資料倒回 legacy。

## 帳號清除與保留
本人清除 endpoint 先驗證 A token 及綁定帳號近期認證，不接受 owner payload；建立交易 fence，再以 ownerId 分頁刪除 7 個個人集合，全部掃描完成才標示 complete；STORAGE_REQUIRED=1 時，D1 browser API 交易必須驗證 complete fence 才能刪除 canonical user。每批 50，滿批表示仍需重試；客戶端確認 complete 後才進入既有角色與 Auth 刪除。網路錯誤、權限或資料庫錯誤可重試，不報成功。其他玩家及合法抽象共用題型不刪除；共用資料不得保存個人資訊。fence 雜湊鍵屬假名化安全 metadata，保留以阻止延遲寫入；沒有原始 UID/內容/答案。未完成 Auth 刪除的帳號可重試清除但不可繼續 Beta 寫入。正式上線前須確認備份/日誌保留期限、fence 回收條件與帳號刪除涵蓋全部新資料版本，補上直接 Firebase Auth 刪除及外部管理工具的生命週期清除 hook（或等效經驗證的受控刪除與對帳機制）；備份恢復後先重放刪除 fence，不得復活已刪資料。

## 回滾演練
1. 關閉 ADAPTIVE_LEARNING_ENGINE_BETA，保留 schema 及清除 endpoint；停止未來 worker、等 lease 失效。不改 legacy sourceMode、學習足跡、獎勵。
2. 保留私有且加密的 D1 備份（僅管理服務可取；不提交 Git），記錄 schema/版本、集合計數、合法保留期限。真實備份與恢復只能經部署授權執行，本階段不觸碰正式資料。
3. 如需 rollback legacy backend，維持 STORAGE_REQUIRED=1 與同一 D1 gateway，Beta 新寫入拒絕，但原 D1 清除仍可執行。切勿把 D1 帳號資料直接切回過時 Firestore；既有遊戲資料回滾依 docs/cloudflare-d1-setup.md，Beta 不授權整站資料遷移。
4. 回到 D1 時核對原資料、已刪帳號 fence、scope revision、schema、其他帳號資料與 legacy 不變，再依正式 release gate 開放。CI fixture 演練採 SQLite D1 adapter，正式部署演練另須核實。不得藉由還原將已刪帳號復活。
