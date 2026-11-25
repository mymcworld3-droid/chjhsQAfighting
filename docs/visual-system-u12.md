# 青雲問道 V2 · U12 視覺規範

以宗門現有青綠美術為基準。唯一共用基準位於 public/styles/content-format.css 的 --qy-* 變數。xianxia-quiet、interface-cleanup 與 interface-cleanup-pages 的舊變數是相容別名，不應再建立另一套主色。保留現有背景、獨立導覽美術、武器等階色、答題對錯、生命體力及危險區色彩。

| 角色 | 變數 | 色值 / 規格 |
|---|---|---|
| 墨綠底 | --qy-ink | #14241e |
| 青綠內容底 | --qy-surface | #20332a |
| 內嵌底 | --qy-inset | #192820 |
| 青玉 | --qy-jade | #a5cbb3 |
| 古金 | --qy-gold | #d2b374 |
| 米白 | --qy-paper | #f1e7d0 |
| 次要文字 | --qy-muted | #b8c6b5 |
| 間距 | --qy-space-1…5 | 4 / 8 / 12 / 16 / 24 px |
| 圓角 | --qy-radius-control/card/panel | 8 / 10 / 14 px；不套用全螢幕外框或圖片 |
| 標題 | --qy-font-title | 系統楷體優先，Noto Serif TC 備援；宗門四字保留原 MasaFont |
| 內文 | --qy-font-body | 清楚的繁體中文無襯線，14 px；次要 12 px，輔助 11 px |
| 數字 | --qy-font-number | 等寬數字功能；不改原始數值 |
| 題幹／選項 | --qy-question / --qy-option | 17–23 / 15–18 px；閱讀行高 1.8 |

新介面不得把題目、聊天、名稱或用戶輸入的英文當成裝飾移除；僅在確認純裝飾的靜態標籤後整理。不要為了套用規範而改變資料、功能開關、導航或戰場控制。數學保留 math-colors.css 第一載入與 MathJax/KaTeX 自有字形，公式沿用所在文字/對錯狀態色彩。避免固定行高裁切分式。

直式使用現有安全區與可捲動規則，700px 以下既有標準操作高 44px。短橫式（高度不超過 540px）標題及間距緊縮；不縮小題幹至難以閱讀，不重新排戰場。各模組可保留美術自身比例與主題色，後續 U01–U13 逐步整合，不以全域 CSS 強制覆蓋所有元件。驗收須包含手機直式、短橫式、平板、桌面及公式、等階、答案狀態與數字。
