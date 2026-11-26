# 教材版本與參考題庫改版進度

更新日期：2026-11-26（臺灣時間）。原始需求見 [改版計畫 V1](curriculum-reference-upgrade-plan.md)。

## 本輪範圍與成果

依使用者最後指示，先集中高二數學 A／B、物理、化學的教材分版與章節補全。已接入兩家出版社的官方公開目次；詳細逐冊來源、年份與待補狀態見 [高二教材清單](grade11-curriculum-versions.md)。原27階段計畫尚未全部完成。

- 保存28筆官方書籍紀錄，24冊有完整公開目次，可在範圍選單選擇93章／單元、304節次或官方單元。龍騰4A、4B、物理V、化學V缺完整目次，保留為待補而不開放。
- 翰林3A／3B為115學年度、4A／4B為114學年度。物理、化學逐冊保留實際年份；龍騰未標學年度則保留未知。數學A／B各用自己的目次，不混用。
- 物理、化學選修冊次依各校排課，自行選I–V，不強制套入高二上下學期。此入口不代表每所學校高二都教完五冊。
- 章節頁恢復出版社與學期／冊次選擇；保留三步操作、既有複習版、自訂與跨科範圍。資料按年級／科目延遲載入101個目錄分片，客戶端不掃描參考題檔。
- 分享、匯入、出題、背景備題與暫存保存冊次及年份；舊範圍、舊分享碼與舊雜湊仍相容。既有學習統計不以新ID覆蓋；只有已確認的標準觀念加上跨版本統計。
- 四個已核對範圍的觀念為平面內積、空間內積、平面正射影、二維柯西，保持分離。舊題庫其餘觀念先保存為候選，不冒稱已完成學習深度審核。
- 參考題由3313增至3326道，578份題庫皆至少五道結構候選題；新增13題，並替換一道重複焦點題。結構檢查合格不等於獨立內容審核合格。
- 同觀念參考題延伸到一般單人、教室、戰術、副本及試煉塔流程。只在教材資料通過驗證後移除節號，再精確查找同年級名稱或已確認別名；沒有對應題時不跨觀念補位。玩家排除規則逐題過濾，不再因一條規則停用全部參考題。

## 開放資格與尚未完成項目

教材的 `scopeSelectionStatus: verified-toc` 表示目次已核對、可以選範圍；`releaseStatus: blocked` 則保留原計畫對正式內容資格的門檻。24冊可選教材全部尚未取得「逐觀念學習深度＋每觀念五道獨立內容審核題」的整冊資格。不得將本輪宣稱為全部題庫補全或27階段驗收完成。

`curriculum-data/reference-reviews.json` 的獨立內容審核紀錄仍為0；目前3326道題均只能計為結構候選。待補的出版社包含三民、泰宇、南一等，本輪沒有複製其他版本冒充。國小、國中及其餘高中科目的全面來源重查與參考題補齊不屬本輪完成範圍。

## 實作與自動檢查

| 項目 | 實作 |
| --- | --- |
| 標準觀念與候選轉接 | `concept-registry/curated.json`、`legacy-candidates.json`、`index.json` |
| 逐冊來源資料 | `curriculum-data/books/`、`sources.json` |
| 建置與延遲載入 | `scripts/build-curriculum-catalog.cjs`、`public/curriculum-data/` |
| 伺服器範圍核對 | `curriculum-catalog.cjs`；核對出版社、冊次、年份、細項及觀念ID，拒絕偽造或不屬本冊的細項 |
| 題庫與資格盤點 | [盤點報告](curriculum-inventory.md)、[覆蓋率報告](curriculum-coverage.md)及同名JSON |
| 新版兼容與範圍防護 | `tests/curriculum-catalog.test.cjs`，包含24冊逐節分享往返、待補冊次禁止選用、數學分流及平面／空間邊界 |
| 瀏覽器驗收入口 | `scripts/test-curriculum-browser.cjs`，本地靜態測試頁，無Firebase與付費AI呼叫 |

已同步至本輪檢查到的遠端main `8e2262d`，保留其他工作新增的秘境、武器掉落與突破修改。完整 `npm test`：**3070／3070通過**；目錄重建、盤點、覆蓋率及靜態版本檢查均通過。

瀏覽器實機驗收尚未完成：本環境缺可執行Chromium，安裝下載遭403，雲端瀏覽器無法連到本地測試頁。未將靜態或單元測試視為跨裝置瀏覽器通過。沒有可用AI憑證，因此本輪未進行真實付費AI出題抽樣。

## 重現命令

```sh
npm run build:curriculum
npm run audit:curriculum
npm run audit:curriculum-coverage
npm run build:module-versions
npm run check:curriculum-catalog
npm run check:curriculum-inventory
npm run check:curriculum-coverage
npm run check:module-versions
npm test
```

覆蓋率稽核將正式內容資格、目次查證與獨立審核分開計算，失效索引、重複ID、範圍映射或不合格的正式發布都會使檢查失敗。題目審核記錄必須綁定內容雜湊，修改題目後舊審核不可繼續計數。
