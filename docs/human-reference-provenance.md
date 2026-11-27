# 人類原始命題參考庫：來源稽核與隔離政策

自 2026-11-27 起，只有經真實人類審核、合法使用且題幹與選項忠實保留的原始人類命題，才可用於 AI 出題參考。課程目次、來源自述、學測題號、AI 改寫、內容結構測試都不構成原題證據。

## 舊庫隔離

凍結 legacy baseline 記錄修正前所有題庫 Git blob SHA；不等同批准。原始資料保留以便追查，不刪除學習歷史。線上選題及 prompt 兩層驗證批准清單，空清單時不傳入任何舊候選題。沒有參考題仍可使用原本的課綱及獨立出題檢查生成一般練習題；不得宣稱其使用已核實人類參考題。新政策版本隔開先前的 AI 備題版本。

## 查證及匯入

1. 取得可查證的原始正式考試、教師或其他合法人類來源。依法令舉行的考試原題與第三方編寫的詳解、閱讀文章、圖像等附帶素材分開檢視權利；不假設所有公開網頁可自由重製。
2. 確認來源機構或作者、原始文件網址、考試年份/題號或精確定位、合法使用依據。保留原始題幹、選項及正解；僅無損的排版/LaTeX 轉錄可接受。現有單選題格式無法忠實容納的題型暫不匯入，不得由 AI 補選項或轉換題型。AI 可協助搜尋與標註，但不得創造、改編或簽核參考題。
3. 真實人類審核者比對原文、原始選項、答案及權利證據後，於 curriculum-data/human-reference-provenance.json 增加 approval；referenceHash 是完整 reference JSON 的 SHA-256（Node JSON.stringify）。必須填 file、referenceId、referenceHash、status=approved、authorship=human-original、method=human-original-source-comparison、originalTextAndOptionsMatched=true、answerVerified=true、sourceRightsVerified=true、sourceType、sourceTitle、sourceAuthorOrInstitution、originalSourceUrl、originalQuestionNumberOrLocator、rightsBasis、rightsEvidence、reviewer、reviewEvidence、reviewedAt。不得用虛構值或把 AI 寫成審核人。sourceType/rightsBasis 的允許值見 human-reference-policy.cjs。內容獨立審核另依既有 reference-reviews.json 登錄，不可混用。
4. 修改舊庫檔案時，該檔案仍未核實的舊候選題必須先移出正式題庫（保留舊 commit 或獨立不被讀取的檔案），不可重新登錄 baseline。新增檔案不得含未批准題目。原庫暫時不足就保留缺口，不用 AI 補滿。
5. 執行 node scripts/audit-human-reference-provenance.cjs reference-provenance-report.json，報告逐題列出來源、分類、hash、隔離狀態，並統計各科。node --test tests/quiz-references.test.cjs 亦執行全庫稽核。既有 reference-question-audit workflow 執行此測試。人工證據真實性仍需要人類覆核，程式不能證明作者身份或授權本身。

## 分類

self-or-generated 與 adapted 是標籤辨識，不是對實際作者的確定判決；exam-claimed-unverified、other-human-source-claimed-unverified、unverified-other、missing-source 都是未核實；只有 verified-human-original 可用。不得由 AI 僅憑標記批次核准。

原始資料查證及取得授權未完成前，不得在競賽文件宣稱題庫全部為人類原題。
