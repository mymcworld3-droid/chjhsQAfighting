# 畫面整理預覽

分支：`design/interface-cleanup-20261023`。這一輪整理宗門首頁與共用頁首、底部導覽，維持原有玩法。

- 問道、鬥法放在首頁「今日修行」，不再與底部導覽擠在一起。
- 境界與修為保留一張山景卡；當前任務獨立呈現。
- 任務、劇情、閉關、境界圖錄、秘境收為一列，保留原有入口及紅點。
- 悟性、修為及連勝放入原生可展開的「修行紀錄」。
- 手機首頁預設收合紀錄時，不需要捲動即可操作主要入口。

## 截圖

以下為本機 Chromium 載入此分支的正式 `stage.html` / `index.html`、樣式與境界顯示程式後擷取的畫面；使用預覽玩家資料（元嬰、116 修為及示例任務），停用正式帳號、資料庫和遊戲 API。截圖裁切至實際遊戲畫布。

- [橫式首頁](home-landscape.jpg)：1440 × 810，邏輯畫布 1280 × 720。
- [直式首頁](home-portrait.jpg)：390 × 693，邏輯畫布 360 × 640。
- [橫式展開紀錄](home-landscape-records.jpg)。
- [直式展開紀錄](home-portrait-records.jpg)。

檢查了主要按鈕點擊、境界圖錄開關、原生紀錄展開與水平溢位。兩種方向預設首頁的內容高度均等於畫布高度；展開紀錄後可正常捲動。尚未進行 Safari 實機或正式帳號端到端驗證。

## 重現

`scripts/capture-interface-cleanup.cjs` 是隔離的本機擷取工具；不會修改玩家資料。需要 Playwright、Chromium，以及暫存的 Tailwind CSS 與字型套件。

```sh
npm install --prefix /tmp/ui-preview playwright tailwindcss@3 @fontsource/noto-serif-tc @fontsource/noto-sans-tc @fortawesome/fontawesome-free --no-save
printf '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' > /tmp/ui-tailwind-input.css
/tmp/ui-preview/node_modules/.bin/tailwindcss -i /tmp/ui-tailwind-input.css -o /tmp/ui-tailwind.css --content './public/**/*.html,./public/**/*.js' --minify
NODE_PATH=/tmp/ui-preview/node_modules node scripts/capture-interface-cleanup.cjs
```

需先安裝 Playwright Chromium，或以 `UI_CAPTURE_BROWSER` 指向現有 Chromium。可用 `UI_CAPTURE_DEPS`、`UI_CAPTURE_TAILWIND`、`UI_CAPTURE_OUTPUT` 改變字型套件、CSS 與輸出路徑。設定 `BASELINE=1` 可擷取整理前版本的首頁（基準由 `UI_CAPTURE_BASE_REF` 指定）。
