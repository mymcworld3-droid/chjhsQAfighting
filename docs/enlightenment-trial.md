# 悟道試煉（個人弱項補強）

## 入口與判斷
在洞府／設定的「能力圖譜 → 下一步的修煉目標」中，當單元有至少 5 題且保守估計低於 78% 時，出現「開始悟道試煉 · 5 題」。
伺服器（Firebase A）重新讀取 stats.knowledgeMap，採 Beta(2,2) 平滑估計，絕不信任前端傳來的弱項或答對數。紀錄不足或沒有符合條件的單元時，不會錯誤標記學生為弱項。

## 遊戲規則
- 每次 5 題；答對至少 4 題通過。每個臺灣日限啟動並完成一場；中途可重開視窗繼續。
- 題目使用 `/api/generate-quiz` 現有品質驗證、TeX 檢查、四選一與前題去重。科目／單元／年級由 A 資料庫中的伺服器試煉紀錄固定，不信任用戶直接傳入值；每題 `enlightenment-trial` 模式從權威紀錄簽發加密答案票證。
- 伺服器僅傳題目與四選項。正解／解析在 `/api/enlightenment/trial/answer` 核對票證後才回傳。
- 每題結果與 `stats.knowledgeMap` 在同一 Firebase A 交易更新；重送相同票證無法再次作答或累積數據。
- 通過某個單元的 **第一次** 給予 45 靈石、3 修為；該單元以後通關僅更新學習紀錄，不重複發放。
- 初次通過不同單元時累積掌握單元數，稱號階梯為 1 單元「悟道學徒」、3 單元「辨惑行者」、7 單元「明心悟道」，寫在 `enlightenmentProgress.title`；目前是學習成果稱號紀錄，尚未提供裝備稱號的全站展示功能。
- 獎勵不替代原問道收益；試煉題目不額外給問道的每題修為／靈石，避免經濟重複結算。

## 資料庫
- Firebase A: `enlightenmentTrialStates/{uid}` 為**伺服器專用**狀態，含 runId、stage、待答問題票證、當日成績；不可新增前端寫入此 collection 的權限。
- Firebase A: `users/{uid}.enlightenmentProgress` 記錄首次掌握的單元與累積稱號。
- 注意目前一般問道的 `users.stats.knowledgeMap` 是既有用戶統計，只有悟道試煉內的答案與獎勵由伺服器獨立驗證。一般問道答題統計若將來改成全權威結算，弱項診斷可直接沿用。

## API
- `GET /api/enlightenment/trial` 取得今天試煉狀態／可補強單元。
- `POST /api/enlightenment/trial/start` 建立或回復今日試煉。
- `POST /api/generate-quiz` with `quizMode: enlightenment-trial` 取得當前題目；同一題多次呼叫得到同一張票證。
- `POST /api/enlightenment/trial/answer` 驗證答案並原子保存進度與獎勵。

## 後續
「今日宗門委託」「每週累積目標」「公共隊伍招募」在 Issue #110 追蹤，尚未實作。
