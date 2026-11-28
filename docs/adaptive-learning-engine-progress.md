# 自適應學習引擎 Beta — 開發進度與架構基線

規格：V1.0，`docs/adaptive-learning-engine-beta.md`（完整 324 行，Git blob `6b29dad7bd791e962718be32c08202840cd695b4`）。
目標分支：main。基準提交：`8614dff06518962901e123a010dbfddc5d37a453`（2026-11-28）。
階段 0｜最新 main 盤點與架構基線：**passed**。階段 1｜Beta 入口及功能開關：**passed**。階段 2A｜共用資料契約與隔離基礎：**passed**。當前階段 2B｜隱私清除、資料層及回滾：**blocked**（程式 CI 全綠；使用者指定 Render 服務不在目前授權工作區，實際部署驗收未完成）。最新通過完整階段：1。
本文件與測試修正為同一提交；提交 SHA 由 `git log -1 --format=%H -- docs/adaptive-learning-engine-progress.md` 或 GitHub 檔案歷史取得，不在提交內容內自我引用雜湊。Beta 僅完成獨立開發預覽入口；正式環境未啟用。

## 0A. 實際程式盤點與重用清單

以下是固定基準 SHA 的 Git tree（2566 entries，未截斷）、AGENTS.md、package.json、CI、相關原始檔案及文件的盤點。不是照設計規格假定模組已存在。

| 領域 | 現有程式及能力 | Beta 缺口與處理方向 |
|---|---|---|
| 入口與 UI | public/index.html（page-learning、page-quiz、既有 focused 選項）；public/main.js（載入及開關慣例）；public/main-legacy.js（單人出題、預取及答題）；public/cultivation/home-wireframe.js（學習入口）；public/cultivation/gameplay-page.js（歷練導覽）；public/styles/learning-page.css | index.html 的現行文字是「專注練習 (自訂單元)」（約 L1183），page-learning 靜態清單目前僅每日英文單字。搜尋「專注學習」只回傳新規格，尚無證據證明它是獨立靜態卡片。第 1 階段應先核對實際呈現與既有入口，將 Beta 放在對應專注學習入口之後，不擅自新建全域導覽，也不將 Beta 變成舊 sourceMode 的未支援值。 |
| 範圍與教材 | public/cultivation/curriculum-scope.js（年級、科目、版本及冊次延遲載入、章節勾選及 focusedUnits）；curriculum-catalog.cjs（validateScope、scopeConcepts、scopePrompt、questionIssue）；curriculum-data/books/、concept-registry/、public/curriculum-data/index.json、public/cultivation/curriculum-range-rules.js；docs/grade11-curriculum-versions.md | 優先重用有來源及版本的資料、穩定 ID 與既有跨版本規則；缺真實網路證據的細觀念仍須待驗證。新增自然語言、跨冊消歧、來源定位、confirmed/uncertain/excluded、個人 revision；不把現有 AI 拆解當出版社官方證據。 |
| 適性學習 V1 | adaptive-learning-api.cjs（/api/adaptive-learning/plan、lesson；registry 優先，AI 分析與暫定 fallback、adaptiveScopePlans、cache/pending、帳號及 focusedUnits 驗證）；public/cultivation/adaptive-learning-rules.js（POLICY、MIX 6 補強/2 複習/2 挑戰，1/3/7 天、三難度）；public/cultivation/adaptive-learning.js（stats.adaptiveLearningV1、提示/答題、outbox）；docs/adaptive-learning.md | 已有背景適性學習，不是新 Beta。保留既有政策與舊模式行為；Beta 獨立 scope revisions、五級難度及 40/30/20/10 配額，重用純函式與安全 UI，不將舊計畫當 verified 或把新掌握度覆蓋 V1。 |
| 真人參考 | quiz-references.cjs 讀取 question-references/index.json，selectReferences 及 referencePrompt 兩層使用 human-reference-policy.cjs；curriculum-data/human-reference-provenance.json 的 approvals 目前為 0；docs/human-reference-provenance.md、AGENTS.md | 有歷史候選檔不代表有可用真人參考。嚴禁 AI 簽核人類原題、改寫匯入或繞過 gate。Beta 必須真實檢索且不依靠預建題庫；依法可使用的抽象題型分析獨立保存，不把 AI 分析當批准的原題，也不得直接輸送未批准舊題原文。若需要完整原題重用，依既有政策由真人批准；權利不明則跳過或只使用合法抽象結構，無來源須標明。 |
| 出題與排程 | server.js /api/generate-quiz（生成、CurriculumCatalog、referencesFor、taskPlan、adaptiveContext、scopeExclusions、題型/近期骨架及題庫選擇）；quiz-generation-tasks.cjs；fast-quiz-prompt.cjs；quiz-answer-prompt.cjs；ai-router.js | 沿用題型與台灣學科提示詞，不讓模型決定整個範圍；增加 Beta 專屬考點排程、網路來源及 provenance、多題型 schema。 |
| 品質與答案 | question-format.cjs、question-quality.cjs、numeric-calculation-guard.cjs（有界算術解析，不 eval）、server.js reviewCandidate（validIndices、範圍、相似度）、question-report-api.cjs | 既有 reviewCandidate 雖要求先解題但同一請求內仍提供標示答案及解析；不是嚴格盲解。server.js 的 independentReview 在部分 legacy OpenAI-only 路徑可為 null。Beta 必須獨立 fail-closed，不移植此例外，另加盲解、全部多選正解比對、深度與可讀性 rubric。舊模式不在本階段變更。 |
| 已審核 AI 題庫 | ai-question-bank.cjs（Drive OAuth、scopeCode、fingerprint、compatible、publish）；docs/ai-drive-question-bank.md；bank-catalog.cjs、public/banks/ | 可重用合法且版本相符的已審核原創題；不得冒充真人。Drive 既有配置與實際 OAuth 可用性未確認；補題現有單實例記憶體工作並非持久佇列。 |
| 並行與暫存 | quiz-generation-tasks.cjs、quiz-spare-pool.cjs（server-only Map、TTL 8 分鐘、每範圍 4 題）、public/solo-question-cache.js（local storage、結構相似度）；public/main-legacy.js 預取迴圈 | 重用去重、限量、併發策略；Beta 需持久化 job/lease/owner/revision、原子領題、失敗降級，不以瀏覽器存活或記憶體快取當持久工作。 |
| 學習足跡及回報 | adaptive-learning.js、adaptive-learning-rules.js、quiz-history-view.js、solo-learning-rules.js（獎勵）、quiz-scope-exclusions.cjs（/api/quiz/scope-exclusions）、public/cultivation/quiz-scope-exclusion.js、question-report-api.cjs（/api/verify-report、awardOnce）、study-question-bridge.js、question-presentation.js | 重用呈現、身份、歷史與冪等設計；Beta 的超綱修正需新 revision、撤銷及舊題清理，錯題不計弱點；不得新增獎勵或改舊模式。 |
| 資料層及部署 | Node/Express server.js；server-repositories.cjs；firebase-admin-projects.cjs；d1-store.cjs；cloudflare/d1/src/worker.mjs 與 migrations；public/data-store.js、public/cultivation/data/project-repository.js；docs/cloudflare-d1-setup.md、docs/ai-drive-question-bank.md | 文件描述 Render 後端、Firestore 或 Cloudflare D1 gateway、GitHub Pages 前端；實際正式 backend/worker/secret 狀態未確認。沿 repository abstraction 設計相容交易及持久 job；沒有確認常駐 worker 就不得假定可用。 |

### 依賴圖（現況與後續隔離）

```text
既有 focusedUnits / curriculum-scope → curriculum-catalog
  → adaptive-learning-api → adaptive-learning-rules / adaptiveScopePlans
  → server.js generate-quiz → task plan + quiz-references/human-reference-policy
  → ai-router → format/quality/scope/review → spare pool / AI bank / client quiz
  → adaptive-learning.js / stats.adaptiveLearningV1 / report API
新 Beta（尚未實作）：
  獨立入口 → scope parser / curriculum resolver / revision store
  → web SearchProvider / safe FetchProvider / reference patterns
  → scheduler → generator → independent blind solve + quality gate
  → durable queue → authenticated serve/answer → feedback & scope revision
  共用：auth/repository/catalog/presentation/pure validation；舊流程不替換。
```

### 網路搜尋與部署能力（第 0 階段結論）

- ai-router.js 實際讀到 Gemini REST generateContent（contents/generationConfig）、OpenAI-compatible chat/completions（messages），路由具模型/timeout/validate 設定；未見真實搜尋工具參數或搜尋結果證據處理。現有 `.env.example` 宣告 Gemini/OpenAI 相容 provider 及 Firebase/D1 連線欄位，未見專用搜尋服務欄位。不能把生成 API 或本聊天室的網路工具算成遊戲部署已具備 web search。
- GitHub 已讀寫授權。正式 Render 搜尋 API 憑證、模型搜尋能力、實際出站網路與合法來源擷取均**未驗證**；未讀取或輸出秘密值。第 3 階段需選擇實際合法 provider，驗證服務及憑證是否可用；缺配置時列阻塞，不用 mock 充當上線結果。第 0 階段不發真人題、不匯入任何來源。
- 入口候選的實際瀏覽器畫面、正式資料庫後端和工作執行型態仍待相應階段驗證。規格的品質目標均未實測。
- 隔離決策：不修改 AGENTS.md 或 human-reference-policy，不新增 feature flag、不修改現有遊戲資料及玩法。第 1 階段才新增預設關閉的獨立入口及開關，正式第 26 階段才可開放。

## 0B. 基準測試與既存 CI 回歸

基準 CI：
- Cultivation regression tests [46147986611](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46147986611)，Node 24，`npm install --no-audit --no-fund`、`npm run check:module-versions`、`node --test --test-reporter=tap --test-timeout=60000 tests/*.test.cjs`。module versions 步驟已走完，測試 3323，3321 pass、1 fail、1 其餘（以原始 TAP summary 為準）。失敗位於 tests/weapon-dungeons.test.cjs:602，公開萬獸險域進度回傳非 undefined。前一提交 c918fd4 的同類 workflow 亦失敗；不將其誤認為 Beta 改動造成。
- Tactical browser acceptance [46147986695](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46147986695)：success。
- Pages build and deployment [46147986032](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46147986032)：success；基準 commit check-runs 的 Workers Builds: qingyun-d1-gateway 亦 success。
- 前一提交的 Dungeon co-op browser acceptance [46135990210](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46135990210)：success，非本 SHA 的新增驗收。
- 本地執行環境：Node v22.16.0，git ls-remote 無法解析 github.com，沒有本地專案 clone，因此沒有聲稱執行本地 Node 回歸測試；以 GitHub Actions Node 24 的真實結果作本階段驗收。不得將靜態核對當作測試通過。

已定位既存錯誤：public/cultivation/weapon-dungeon-rules.js 的 WILD_ID 已 hidden:false，docs/weapon-dungeons.md 明確記錄萬獸險域正式開放，tactical-combat-api.cjs:513–530 的 weaponDungeonState 僅過濾未公開副本。原測試先斷言 p.byDungeon 正確，下一行卻要求相同條件再讀為 undefined，與公開契約矛盾。修正最後的過時隱藏斷言，改為檢查普通 API 重讀仍保留完整 byDungeon、石域 legacy 進度及票券不變、可見萬獸險域清關與解鎖值一致、六階 locked flags 正確；保留所有既有重送、通關、前階解鎖、票券斷言，不更改產品規則或刪測試。需由新 CI 驗證。

本次變更檔案：
- docs/adaptive-learning-engine-progress.md（本盤點/交接紀錄）。
- tests/weapon-dungeons.test.cjs（0A 基準回歸測試契約修正，僅測試）。

## 後續驗收及進度

| 階段 | 狀態 |
|---|---|
| 0 | passed — 124e2e2 基準 CI 全部成功 |
| 1 | passed — 917be25 全部 23 項 CI checks 成功，四種 Chromium 尺寸通過 |
| 2A | passed — 6017cd0 21 checks 全部成功 |
| 2B | blocked — 380e741 全部 22 checks 通過；指定服務 chjhsqafighting-2 未列於目前 Render 連線；真實 Firestore/D1 及隔離演練未驗證 |
| 3–26 | not_started |

接續時先讀完整規格與本文件，核對最新 main 的 CI。若仍有失敗，修正本階段阻塞，不降低驗收。若本次測試修正的 CI 通過，記錄真實 run URL、測試數與提交 SHA，再開始第 1 階段。未確認正式搜尋服務不等於現有搜尋已啟用；第 3 階段需完成真實驗證。

## 第 0 階段最終驗收（2026-11-28）

提交 `124e2e21cc50a839c359e2f745935a4cfd30f52d`：
- 回歸 [46150632032](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46150632032)：success；3323 tests、3322 pass、0 fail、0 cancelled、1 skipped/其他（依 TAP）。
- 戰鬥瀏覽器 [46150632059](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46150632059)：success。
- Pages [46150631534](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46150631534)：success。
- 新武器候選驗收 [46150632056](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46150632056)：success；所有 21 個 check-runs（含 Worker）均 completed/success。第 0 階段通過。

## 第 1 階段｜入口及功能開關

基準 SHA：`124e2e21cc50a839c359e2f745935a4cfd30f52d`。實際確認專注入口是洞府 → 範圍設定 → 範圍研修所的「專注練習 (自訂單元)」，由 scope-fullscreen.js 移動 set-source-mode 所在 block，沒有名為「專注學習」的獨立卡片。因此採既有選單正下方的獨立按鈕，沿用研修所配色與原生 dialog；不插入未支援的 sourceMode、不新增全域導覽、不變更草稿或舊儲存行為。只有 page-settings 開啟的研修所提供預覽，不在戰鬥或答題入口啟用。

- `adaptive-learning-engine-beta-api.cjs` + server.js：獨立 GET /api/adaptive-learning-engine-beta/status，沿用 verifyMainIdentity，no-store、缺身份/配置/錯誤 fail closed；無資料寫入、無題目發放。環境開關 ADAPTIVE_LEARNING_ENGINE_BETA=1 且 NODE_ENV 為 development/test 才可預覽，正式 release 常數 false，直到第 26 階段才可按驗收調整。.env.example 預設 0，不改正式部署設定。
- public/index.html、public/cultivation/scope-fullscreen.js、public/cultivation/adaptive-learning-engine-beta.js、public/styles/curriculum-studio.css：靜態預設隱藏，從設定研修所按需載入；伺服器同意後才顯示；每次點擊重新驗證、前景定期刷新及失敗隱藏，關閉安全返回既有範圍、不保存新資料，帳號切換不接受遲到回應。未提供正式出題，顯示實際開發預覽狀態。module-versions 同步更新。
- tests/adaptive-learning-engine-beta.test.cjs：預設/正式關閉、驗證權限、停用、失效與舊模式契約。
- scripts/test-adaptive-learning-engine-beta-browser.cjs 及 tactical-browser workflow：真實 Chromium，以隔離 fixture 身份與宿主頁、實際入口 HTML/CSS、前端 module 和後端 handler 驗證手機/平板直橫式、關閉及 Escape、帳號切換、舊模式與選擇保留。不是正式網站全流程或真實帳號驗收。
- 測試命令：`node --test tests/adaptive-learning-engine-beta.test.cjs`（包含於完整回歸）、`npm run check:module-versions`、`node scripts/test-adaptive-learning-engine-beta-browser.cjs`（CI）。目前本地尚無完整 checkout；本提交 CI 實測結果待確認，不標 passed。
- 尚未驗證正式搜尋與憑證、正式瀏覽器真實帳號及完整學習流程（後續階段）。不改正式開關，不實作第 2 階段。CI 通過後才記錄第 1 階段 passed 並進第 2 階段。

## 第 1 階段最終驗收（2026-11-28）
基準 `917be256e5e33b8554ecbb50af8506b3a7baf34e`。完整回歸 [46152230445](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46152230445)：3328 tests、3327 pass、0 fail、1 skipped。實際 Chromium [46152230500](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46152230500) 日誌明列 Adaptive Beta preview passed 360x640、640x360、768x1024、1024x768。另 [新武器](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46152230513)、[參考題稽核](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46152230438)、[合作副本](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46152230459)、[Pages](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46152230173) 與 Worker 全部成功（23 checks）。第 1 階段 passed。

## 第 2A 階段｜資料契約與伺服器隔離基礎
基準 `917be256e5e33b8554ecbb50af8506b3a7baf34e`。第 2 階段拆 A/B：先建立嚴格資料契約及 server-only repository，下一子階段確認實際資料層存取規則與帳號刪除/回滾；不跳至第 3 階段。
- 新增 adaptive-learning-engine-beta-contract.cjs：13 種 v1 schema（edition, section, concept, scope, source, reference, question, review, job, queue, attempt, mastery, report），未知欄位/版本 fail closed，單選、多選、數值、來源證據、觀念版本、範圍及掌握度基本一致性。schema 通過不代表教材或真人來源已確認。舊 q/correct/wrong/exp 轉為 pending candidate，不沿用舊核准、不改舊資料。
- 新增 adaptive-learning-engine-beta-store.cjs：獨立 adaptiveEngineBetaV1_* 文件集合；私有鍵依驗證 owner + record ID 雜湊，scope 每次 append immutable revision + head 原子更新；拒絕跨帳號、舊 revision 工作、未確認考點、不允許玩家讀 shared 題目。shared 候選只准 server-only append；暫不支援批准/正式發題/queue 寫入/作答記帳，避免偽造未實作安全流程。不註冊新資料路由，不從正式玩家建立資料。
- d1-browser-api.cjs：Beta 集合及任何未來版本前綴在通用瀏覽器 API 一律拒絕，包含管理員、query/doc/watch/交易讀寫；buildTarget 在資料庫查詢前拒絕，不洩漏存在性。沿用現有 D1/Firestore transaction 介面，不改舊資料結構與既有 API。
- tests/adaptive-learning-engine-beta-contract.test.cjs：13 schema roundtrip、錯誤格式/版本、舊題轉換、兩帳號相同 scope ID、交易/版本、D1 SQLite 實際 adapter fixture、通用 API 阻擋，未審核題不能進 queue。全為 synthetic fixture，不作真實教材/真人來源。
- 測試命令：node --test tests/adaptive-learning-engine-beta-contract.test.cjs（完整 CI glob 自動包含）、npm run check:module-versions、既有完整回歸及瀏覽器 workflow。本地未執行完整 checkout；新 CI 待確認。
- 遷移/回滾：D1 使用既有 documents 通用結構，無 DDL/批次搬遷；舊 users、focusedUnits、adaptiveLearningV1、舊題庫不被重寫。未知版本拒絕並保留原資料，日後新增版本須以明確轉換及測試處理；關閉 Beta 即停止新路由，先保留合法 Beta 資料，不自動逆向覆蓋 legacy。第 2B 補可驗證的匯出、清除與回滾演練，禁止對真實玩家啟用持久寫入直至確認。
- 阻塞與後續：專案只有 firestore-c.rules，未找到 A 專案實際生效的 Firestore Rules；不能從 D1 的 API 拒絕推斷 Firestore 亦安全。既有 public/account-delete.js 的帳號刪除沒有 Beta 集合清除。第 2B 需整合經認證的資料清除、確認 Firestore A/D1 後端隔離及保留期限/停用測試；正式搜尋服務仍屬第 3 階段。正式 Beta 保持 release-locked；本階段沒有啟用新資料路由。CI 完成後仍需先完成 2B，才能標記第 2 階段 passed。

## 第 2A 階段最終驗收（2026-11-28）
基準 `6017cd0f1332a6dc1d94850f8c65ca9baed8e63c`。完整回歸 [46155720131](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46155720131)：3347 tests、3346 pass、0 fail、1 skipped。另 [戰鬥瀏覽器](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46155720104)、[武器候選](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46155720107)、[Pages](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46155718915) 與 Worker 全部成功（21 checks）。第 2A 通過。

## 第 2B 階段｜帳號清除、權限、遷移回滾
- Firestore A 正式 Rules 未能取得，不能宣稱已驗證或直接覆寫既有 Rules。改採 D1 A 專用 Beta 儲存：production factory 必須明確 D1 + STORAGE_REQUIRED=1，底層只接受 D1Store A（唯一例外為明確標示的隔離記憶體測試 fixture）。沒有 Beta 資料讀寫 HTTP 路由；唯一新增 POST 是經身份驗證的本人清除。原有 Firestore A 遊戲資料不搬遷、不更動。若既有遊戲仍使用 Firestore，不啟用 Beta 持久化。
- purgeOwnerBatch：先提交獨立 hashed deletion fence，全部 private read/append transaction 檢查 fence；再逐集合按 ownerId 查詢、有限批次交易清除 scope/head/job/queue/attempt/mastery/report，重試直到完整；不影響其他玩家或 shared collection。fence 僅保存 schemaVersion、blocked、complete 與雜湊鍵，不存原 UID 或學習內容；屬最小化的假名化安全標記，保留防止遲到工作復活已刪資料。尚未建立經 Auth 刪除確認後的保留期限與自動回收，後續需納入維運驗收，不宣稱所有 metadata 皆抹除。
- delete-my-data 由已驗證 A token 推導 owner，拒絕 body UID；驗證撤銷及 account provider，已綁定要求最近 5 分鐘認證，未綁定匿名沿用原有一次確認政策。Beta 關閉時仍能清除。客戶端保留原有確認及 Google reauth，清除完成後才刪 canonical user/Auth；失敗保留帳號可重試。啟用 STORAGE_REQUIRED 後通用 D1 canonical user 刪除亦須交易核對 complete fence，包括管理員；未啟用前保留舊行為。若 D1 憑證缺失但已要求 D1，fail closed；部署前 Firestore-only 且從未允許 Beta 持久化時可以回傳 not-configured。不可在啟用後清除 STORAGE_REQUIRED 或 D1 憑證來繞過清除。
- legacy Firestore→D1 CLI 與 admin migration 拒絕 reserved Beta 前綴來源或 snapshot；既有嚴格 final 對帳保留。禁止將未知 Firestore 文件當可信 Beta 資料匯入。新增 docs/adaptive-learning-engine-data-operations.md 說明版本、回滾及核驗流程。
- 測試包含 D1 SQLite 實際 adapter fixture 的分頁、重送、跨帳號、舊版讀寫、rollback backend、fence、權限；前端 VM 測試保留原有刪除流程與新增失敗情境。正式資料庫未執行刪除、匯入或回滾；測試資料均 synthetic。正式 Firestore Rules、D1 部署憑證、實際資料保留/備份清除仍待核驗；直接 Firebase Auth 刪除或其他管理服務的刪除事件尚無生命週期 hook，正式持久寫入前必須補完或取得等效受控清除證據，不能以 fixture 代替正式驗收。
- 本提交 CI 未確認；維持第 2B in_progress，不提前進入第 3 階段。正式 Beta release flag 仍 false。

## 第 2B 補強｜外部帳號生命週期與回滾（2026-11-28）
基準 `705a243bb5f773d963858ba9f22564daa54b37bd`。已核對 [完整回歸 46157574019](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46157574019)：3356 tests、3355 pass、0 fail、1 skipped。參考題稽核 46157574046、Pages 46157573388、Worker success；開始補強時 tactical 46157574009、candidate 46157574138 尚 in_progress，須再查最終狀態。
- 新增 adaptive-learning-engine-beta-lifecycle.cjs：server-only、有持久 D1 checkpoint 與 10 分鐘 lease，每次掃描一個集合至多 10 筆（測試可調 1–20），每 60 秒續接。使用 Firebase Admin A getUser；只有明確 auth/user-not-found 或已有合法 deletion fence 才清除。禁用帳號、暫時網路、權限、配額錯誤不推斷帳號已刪；錯誤保留 checkpoint，下次重試，不記錄個資。所有七個 private collections 都輪巡。並非即時 Firebase trigger；實際清理延遲取決於資料規模、服務持續運作及配額，部署前須量測。
- server.js 啟動 opt-in lifecycle；STORAGE_REQUIRED=1 與 LIFECYCLE_ENABLED=1 才排程，maintenance 停止；Beta release 仍鎖定、正式 flag 不改。production persistence factory 要求 lifecycle enabled；私有 repository 每次 read/append 重新驗證身份，既有 handle 不能代替重新認證。
- fence 在恢復舊資料時仍阻止讀寫，對帳會再次清除；purge 開始時清除完成標記重設，完成後重新標記。fence 暫保留為無原 UID 的最小假名化安全標記，不能宣稱無限期保留已獲法律核准；在備份最長保留期、最大 lease/replay horizon、Auth 不重用 UID/失效條件未確認前不自動回收。補充資料保留表與恢復演練操作。未實作自動刪除學習紀錄或無條件 job TTL，避免破壞未來冪等；第 19 階段需設計 terminal job/queue 安全 TTL，正式上線前第 25 階段驗收備份和保留。
- 新增 tests/adaptive-learning-engine-beta-lifecycle.test.cjs 六項 SQLite D1 fixture：外部 Auth 刪除、暫時故障、lease、restore replay、retained handle、開關與維護。命令 node --test tests/adaptive-learning-engine-beta-lifecycle.test.cjs tests/adaptive-learning-engine-beta-privacy.test.cjs tests/adaptive-learning-engine-beta-contract.test.cjs；完整 CI glob 自動執行。本次尚未取得新 CI 結果。
- 部署阻塞：Render 連線可列工作區但 service 查詢明確要求使用者確認 workspace，未自行選取；Firebase A 正式 Rules 及 D1 實際部署憑證/隔離沒有可授權驗證途徑。沒有修改正式環境、刪除真實資料或執行正式 restore。需有部署授權、有效 Rules 與只讀/隔離測試環境，驗證真實 Auth deletion、D1 權限、備份與回復，才可記錄第 2 階段 passed。第 3 階段未開始。禁止用本地 fixture 或正式 flag 未開啟替代上述驗收。

- 提交前重查 705a243：tactical browser 46157574009 已 success；candidate 46157574138 尚有 4 個 balance jobs 執行中，沒有已知失敗，仍待全部結束。

## 第 2B 部署查核與唯讀驗收工具（2026-11-28）
基準 `75eac3559aa7f6ba3a19e596abf8b26a4da28b6f`。完整回歸 [46157959330](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46157959330) 實際日誌：3362 tests、3361 pass、0 fail、1 skipped；新增六項生命週期測試均 ok。基準 check-runs 本次提交前查核：17/22 success；其餘 candidate-balance (5):in_progress、candidate-balance (6):in_progress、candidate-balance (10):in_progress、candidate-balance (7):in_progress、mobile-battle:in_progress。未完成檢查不得計通過。
- 已取得使用者確認的 Render 工作區，僅 list/get service 及 list deploys。唯一對應 repository 的服務 chjhsQAlegend（srv-dat3u3rncjis73d13mt0）設定 stamina-battle、billing suspended、autoDeploy=no，2026-11-19 最近兩次 build_failed；並非目前 main 的可用後端。工作區沒有對應此 repo 的 main 服務。未讀取環境變數秘密、未重新啟用或部署、未改帳務或資料。GitHub Actions secrets/environments/deployments metadata 查詢不可取得；不從中推論憑證是否存在。
- 新增 scripts/audit-adaptive-beta-deployment.cjs：必須顯式 --read-only；使用現有伺服器憑證向固定 Firebase Rules REST GET 端點取得 A 預設資料庫生效 release/ruleset，核對 project/resource 並只輸出規則內容 SHA-256 與 reserved collection 數；D1 先以無憑證固定 aggregate SELECT 驗證 401，再以服務憑證同一查詢核對 A/BD/C 筆數，不傳送 UID、讀取玩家內容或執行寫入。禁止重導向，限制 HTTP timeout。錯誤輸出僅受控狀態，不回傳私密錯誤/規則原文/密鑰。即使 readOnlyChecksPassed=true，stage2Approval 仍為 false；此工具不能替代 Rules 語意評估、Auth 外部刪除與實際隔離 restore。
- 新增 tests/adaptive-learning-engine-beta-deployment-audit.test.cjs 四項測試：固定唯讀請求及不洩漏、未授權閘道停止、異常 namespace、錯專案/URL/無憑證。使用 synthetic fixture，不是正式驗收；測試命令 node --test tests/adaptive-learning-engine-beta-deployment-audit.test.cjs（納入完整 CI）；本次新測試尚未執行完成。
- 目前明確阻塞：需指定實際承載 main 的後端或隔離 staging 執行環境，並有 A Rules 讀取權限及 D1 測試憑證。正式 Rules 語意、外部 Auth 刪除、D1 真實回復/備份保留仍未驗收。正式 Beta 關閉，未啟動第 3 階段。既有遊戲功能未修改，無正式玩家破壞性測試。

## 第 2B 程式驗收完成、指定部署服務查核（2026-11-28）
基準 `380e7412017a297fd2e342730cddacd53db98679`。完整回歸 [46158268594](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46158268594)：3366 tests、3365 pass、0 fail、1 skipped、0 cancelled；唯讀部署 audit 新增四項測試（TAP 48–51）全部 ok。基準 commit 22/22 check-runs completed/success；[手機/戰鬥瀏覽器 46158268606](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46158268606)、[新武器候選 46158268612](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46158268612)、[Pages 46158268521](https://github.com/mymcworld3-droid/chjhsQAfighting/actions/runs/46158268521)、Worker check 均 success。無已知程式測試失敗。
- 使用者指定真實 Render 服務名稱 chjhsqafighting-2；重新查已確認的 Render 工作區（含 preview），共 19 個服務，該名稱沒有出現在回傳清單，repo 相符者仍為先前舊 stamina-battle 服務 chjhsQAlegend。不能將舊服務 suspended 狀態套到指定服務。對推定公開網址 https://chjhsqafighting-2.onrender.com/api/data-config 與 /api/adaptive-learning-engine-beta/status 的唯讀存取均不可取得；不能由此判定真實服務停機。瀏覽器工具無 originating browser context，Render connector 無 server shell/exec 能力。未讀秘密或正式玩家資料，未變更部署。
- 唯讀 audit 已通過 fixture CI，仍未在正確服務執行。解除阻塞：取得正確 Render 服務 dashboard URL / srv- ID 並確認連線帳號具有其讀取權限；或由已授權維運者在正確部署版本之 shell 執行 node scripts/audit-adaptive-beta-deployment.cjs --read-only，提供工具輸出的無密鑰 JSON 與部署 SHA。不要貼上環境變數或服務帳號憑證。之後另驗證有效 Rules 的重疊 allow 語意及隔離 Auth/D1 清除、備份回復與保留期限。唯讀輸出不是完整安全驗收。
- 本次僅更新進度/維運文件，不修改已通過的產品程式或測試。第 2B 程式驗收完成，正式環境仍 blocked；第 3 階段尚未開始，正式 release flag 維持 false。不可為取得綠燈而縮減必要驗收。
