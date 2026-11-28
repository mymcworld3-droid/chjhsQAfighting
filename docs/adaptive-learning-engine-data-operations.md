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

## 唯讀部署診斷（第 2B）
在已獲授權的正確後端部署/隔離環境、已具備現有服務端憑證時執行：
```bash
node scripts/audit-adaptive-beta-deployment.cjs --read-only
```
不新增或改變正式帳務、部署、規則或資料。CLI 讀取 Firebase Rules API 的 default Firestore release 與 ruleset（官方 API：https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/get 與 https://firebase.google.com/docs/reference/rules/rest/v1/projects.rulesets/get），只回報規則 SHA-256、保留前綴集合數。D1 僅送固定 aggregate SELECT（不取得任何玩家記錄內容），先確認無 token 得 401 再進行已授權查詢。拒絕重導向與非 HTTPS，禁止將 API 憑證或規則原文貼到聊天/GitHub。缺權限或不可連線回報 unavailable；readOnlyChecksPassed 僅為有限探測成功，不代表 Firestore 規則語意完整安全（需檢查重疊 allow）、實際 Auth 刪除、回滾或正式備份保留已通過，stage2Approval 永遠 false。需另外在隔離帳號及 D1 資料庫完成具證據的測試。Render 查核目前對應服務 suspended 且為 stamina-battle，不能用其作 main 驗收；勿為繼續開發自行恢復帳務或改分支。

### 指定 Render 服務的接續方式
使用者已指定 chjhsqafighting-2 為現有後端；目前 connector 回傳清單不含此服務，不應將 chjhsQAlegend 視為其替代。請由 Render Dashboard 開啟指定服務，取得服務 URL 或 srv- ID，確認正確工作區與授權連線，核對部署 commit SHA。在可用且獲授權的 shell 中執行上述唯讀 CLI（若部署尚未包含此檔，勿擅自為驗收觸發部署或改設定）。只需提供無憑證的 JSON 報告與 commit SHA，禁止提供 API key、Firebase 私鑰、D1 token。若方案不支援 shell，可使用具同等合法憑證與隔離環境的維運端執行；不建立公開診斷端點、不將密鑰移入 GitHub。正式規則語意與隔離刪除/還原另需驗證，程式 CI 全綠不代表正式部署驗收已完成。

### 指定服務 ID 的查核結果（2026-11-28）
正確服務 ID 已取得：srv-dbvai3rl550s7397ic9g，指定部署 dep-dc5ee48u01pc738fad3g。現有 Render 連線三項直接查詢均 404，不需重複提供 ID。請先確認 Render 連線帳號及可存取工作區，或以有權限的服務 shell 執行現有唯讀診斷。不得將 404 當作部署停機證據，不得用舊服務替代。無可用 shell 時保留阻塞，不新增公開診斷 API、不傳送私鑰，不改正式部署。只讀報告不等同隔離演練驗收。

### Render 連線已恢復（2026-11-29）
指定服務可讀，repo 與 main 分支核對一致；live 部署 917be25（第 1 階段），自動部署關閉、Free 方案。第 2 階段 CLI 尚未部署。先取得另行部署授權或獨立測試環境，保持 Beta 關閉；不因唯讀查核自行部署或升級方案。現有連線不支援直接執行遠端 shell，部署完成後亦須有合法執行環境及實際證據。避免重新詢問服務識別資訊。正式資料不可作破壞性測試；隔離演練與 Rules 語意查核仍不可省略。


### 驗收順序修訂（2026-11-29）
使用者取消本輪 Render 部署；第 2B 程式驗收與正式部署驗收拆開，第 25 階段補做正式部署 SHA、唯讀診斷、Rules 語意、D1 實際權限、獨立測試帳號外部刪除、實際備份還原、保留期限與 fence 回收證據。以上全部仍未驗證，任何一項未完成均禁止第 26 階段公開 Beta。不觸發 Render 部署、不改正式環境、方案及玩家資料。第 3 階段真實搜尋須在獨立開發環境 opt-in 驗證；不把搜尋憑證加入 repo 或輸出至聊天。


### 第 3B 真實網路驗收（獨立 CI）
在 GitHub Actions 的 Adaptive Beta live network diagnostics 工作流程執行公開文件診斷和 Brave 真實搜尋診斷。若需搜尋憑證，使用者自行於 GitHub repository Settings → Secrets and variables → Actions 設定 `BRAVE_SEARCH_API_KEY`（不要貼到聊天、repo、日誌）；或於獨立開發環境以既有安全憑證執行 CLI。此操作不需 Render 部署、不改正式玩家資料。工作流程只讀，單次搜尋可能消耗 provider 配額；無 key 不送出搜尋。固定來源成功僅證明擷取傳輸，不能代替搜尋到的來源、版權/真人審核。工作流程缺憑證或網路錯誤時需保留 blocked 證據，不要刪除或放寬安全測試。正式網路及部署驗收在第 25 階段仍必須重做。
