# 自適應學習引擎 Beta — 開發進度與架構基線

規格：V1.0，`docs/adaptive-learning-engine-beta.md`（完整 324 行，Git blob `6b29dad7bd791e962718be32c08202840cd695b4`）。
目標分支：main。基準提交：`8614dff06518962901e123a010dbfddc5d37a453`（2026-11-28）。
階段 0｜最新 main 盤點與架構基線：**passed**。當前階段 1｜Beta 入口及功能開關：**in_progress**，待本提交 CI。最新通過階段：0。
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
| 1 | in_progress — 已提交入口、伺服器開關、隔離 shell 與驗收測試；待新 CI |
| 2–26 | not_started |

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
