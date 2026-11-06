# 《問道》AI 題庫：Google Drive 儲存與補題

此功能僅影響一般問道的 **自動出題** 及 **專注練習**；自訂 JSON 題庫維持原始題目，不生成 AI 題庫、不額外 AI 審核，也不會在檔案失效時默默切換成 AI。

## 位置與啟用

AI 題庫唯一指定 Google Drive 目錄：

https://drive.google.com/drive/folders/1Z8TgddizbBKYA2h1Ij6nPqXjhGUAVTqF

Drive 中每題一份 `aiq_<scope-hash>_<question-hash>.json`，已通過一次獨立審核才上傳。原始 Prompt 位於 `server.js` 的 `generationPrompt` 和 `fast-quiz-prompt.cjs`，本次不修改。

**部署環境需另外設定 Google Drive API 認證。ChatGPT 已連線的 Google Drive 不會自動授權 Render 主機讀寫。**

建議在 Google Cloud 設定具備 Drive scope（`https://www.googleapis.com/auth/drive`）的 OAuth 連線，取得長期 refresh token，並放入 Render 的 Secret Environment Variables：

```
AI_QUESTION_BANK_ENABLED=1
AI_QUESTION_BANK_DRIVE_FOLDER_ID=1Z8TgddizbBKYA2h1Ij6nPqXjhGUAVTqF
AI_QUESTION_BANK_GOOGLE_CLIENT_ID=...
AI_QUESTION_BANK_GOOGLE_CLIENT_SECRET=...
AI_QUESTION_BANK_GOOGLE_REFRESH_TOKEN=...
```

也支援 `AI_QUESTION_BANK_SERVICE_ACCOUNT_JSON`；若未提供會嘗試 Firebase A 的 service account，但必須授予該帳號指定資料夾編輯權，而且一般個人 My Drive 的服務帳號可能遇到配額限制。Google Drive API 必須在使用的 Cloud 專案啟用。**絕對不要將私鑰、refresh token 或 client secret 寫入 GitHub。**

啟用前後，`.env.example` 的預設值 `AI_QUESTION_BANK_ENABLED=0` 保證普通 AI 出題不受未配置的 Drive 影響。


### 單一憑證包（建議排除 Render 舊值混用時使用）

如果 Cloud Shell 已使用 \`~/drive_oauth_result.json\` 成功向 Google 交換 access token，
但 Render 使用三個分開的欄位仍發生 \`HTTP 401 invalid_client\`，
可改為只新增 **一個** Render 環境變數 \`AI_QUESTION_BANK_GOOGLE_OAUTH_B64\`。

在 Google Cloud Shell 執行（此指令會印出**可逆 Base64 編碼的全部私密憑證**，切勿截圖、貼至聊天或 commit）：

\`\`\`bash
python3 - <<'PY'
import base64, json
from pathlib import Path
data = json.loads((Path.home() / 'drive_oauth_result.json').read_text())
required = {key: data[key] for key in ('client_id','client_secret','refresh_token')}
encoded = base64.b64encode(json.dumps(required, separators=(',',':')).encode()).decode()
print(encoded)
PY
\`\`\`

將輸出的一整行貼入 Render 的 \`AI_QUESTION_BANK_GOOGLE_OAUTH_B64\`，
選擇 **Save and deploy** 或 **Save, rebuild, and deploy**。
應在 Render Logs 看到 \`[AI bank] OAuth source: AI_QUESTION_BANK_GOOGLE_OAUTH_B64\`。
當 bundle 有效時，伺服器忽略舊的三個 OAuth 欄位，避免混用不同 OAuth Clients；
如果 bundle 格式不合法，會安全停用 AI 題庫、回退既有即時出題並提供不含秘密的錯誤訊息。
Base64 **不是加密**，仍必須視為 secret；成功後可移除 Render 舊三欄位並
清理 Cloud Shell 終端機顯示紀錄。

## 供題規則

1. **自訂題庫**：依原本 /banks 的 JSON 選擇題目；絕不額外產生題庫，不審核已匯入題目。
2. **專注練習**：由伺服器檢查玩家目前選擇的細觀念、考法、用途、難度、課程版本，優先讀取對應的 Google Drive 已核准題目。
3. **自動模式**：隨機選科目與範圍；可共用同科目、同程度、同完整主題名稱、同難度的題目。未確認相同的觀念不跨範圍借題。
4. 若沒有適用的題目，**原本出題 Prompt** 照常生成當次題目（不強制等 Google Drive）；新題在背景進行 **一次** 獨立審核。審核通過才上傳到 Google Drive。
5. 抽到已核准的 AI 題時直接顯示，不再送 AI 審核。若同條件可用且未答過的題數少於 4，額外觸發一次背景補題；背景補題使用同一個原本的生成 Prompt，加一次獨立審核，通過再上傳。
6. 完成中的題目不被替換；原本本機未答題佇列仍生效。已出過或相似題依原本機制過濾。
7. 不需要 AI 題庫、Drive 沒權限、無法連線時，保留既有的即時 AI 出題，不將未審核題目寫進題庫。

## 品質與限制

原本的程式檢查（正解唯一、TeX 公式、數值與解析一致性、避免重複）照常執行，這些是 deterministic validation，**不是第二次 AI 審核**。

目前補題是單一 Node 伺服器內的非同步工作，使用同一用途的任務去重、最多同時 2 件和每執行個體每小時 24 件限制。Render 重啟時，尚未完成的補題可能中斷，但下一位玩家觸發缺題時會重試。跨執行個體的全域工作鎖、持久化補題佇列、增量匯入和管理員人工覆核可作為後續強化。

AI 題庫索引以 Drive 同一資料夾內的 JSON 檔案為準，伺服器快取 2 分鐘。沒有啟用 Drive 認證就不會建立任何檔案。

## 回歸測試

`npm test` 會執行 `tests/ai-question-bank.test.cjs`，檢查使用範圍、審核狀態、Drive 寫入、去重及無認證關閉行為。啟用前還需要部署端實際測試：OAuth 是否有權限寫入目標資料夾、讀取 Drive JSON、同時玩家補題與自訂題庫隔離。
