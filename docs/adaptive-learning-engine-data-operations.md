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

## 外部帳號生命週期與保留補充
- ADAPTIVE_LEARNING_ENGINE_LIFECYCLE_ENABLED=1、STORAGE_REQUIRED=1 才運作；關閉 Beta 或 legacy rollback 不影響清除。維護期間暫停，恢復後從 D1 durable checkpoint 續跑。10 分鐘租約避免多實例同時掃描；每分鐘一個 bounded page。Firebase A Admin getUser 只有明確 auth/user-not-found 才視為外部刪除；禁用、權限錯誤、暫時斷線或限流不可視為刪除。現有 fence 是已開始清除的證據，即使 Auth 尚存亦重掃其私有資料。
- 使用專用測試帳號及隔離 D1 演練：從 Auth 刪除測試帳號（不走遊戲 UI），等待完整掃描並核對七個集合及他人資料；停止服務再啟動驗證 checkpoint；故障注入驗證不誤刪；不得以正式玩家作測試。不允許以直接刪 canonical user 推論 Auth 已刪。外部管理工具若直接刪 Auth，對帳會處理；若只刪 legacy profile 而不刪 Auth，需由原有帳號維運流程完成，不自動推斷應刪除仍有效帳號。
- 保留策略：學習範圍、作答、掌握度、回報保留至玩家清除或合法保留期限；尚未引入個人照片或原始上傳暫存。暫定 terminal job/queue 30 天上限，須在第 19 階段設計並驗收過期、引用、冪等 tombstone，當前尚未啟用 TTL。共同來源依授權與撤回規則，第 12 階段實作；不得包含個資。備份暫定最長 30 天、實際服務方案與法規須正式核對，不宣稱已設定。
- 刪除 fence 僅儲存 hashed key、schemaVersion、blocked、complete。雜湊仍屬假名化資料；暫不自動刪除，因無法在缺乏備份/重放證據時安全決定回收時間。正式驗收需證明備份最大年齡、所有寫入重新驗證、工作最大有效期、UID 不重用，再制定回收條件並記錄。不得任意清除 fence。對帳 checkpoint 不儲存原始 UID（cursor 為文件雜湊鍵）。
- 恢復時保持 maintenance，保留或重放較新的 fence，先執行完整對帳及核對刪除者資料為零，再解除維護。SQLite 測試模擬還原刪除前私有文件但保留較新 fence，證明禁止存取並重新清除；不代表正式 D1 備份已還原。若無可驗證的較新 fence 備份，不得開放恢復後的 Beta。
