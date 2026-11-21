# 六武器高清原畫安裝說明

目前戰場與兵器閣各自對應六種武器的獨立 SVG 插圖（可縮放、不會像低解析六宮格圖集模糊），並支援同名 **1024 × 1024 WebP 高清原畫**。

高清素材不是由程式自動生成。上傳高清圖後，畫面會優先選用 `*-hd.webp` 原畫；未上傳時保留 SVG 圖片，不會出現空白武器。

| 武器 | 請放在 `public/assets/weapons/` |
|---|---|
| 流風靈劍 | `sword-wind-hd.webp` |
| 御靈飛劍 | `sword-flight-hd.webp` |
| 八方天劍 | `sword-sky-hd.webp` |
| 玄嶽圖騰 | `body-rock-hd.webp` |
| 龍象圖騰 | `body-dragon-hd.webp` |
| 伏虎圖騰 | `body-tiger-hd.webp` |

1. 解壓「青雲問道_武器高清遊戲素材包_1024.zip」，保留裡面的 `public/assets/weapons/` 目錄結構。
2. 將六張 `-hd.webp` 合併到 GitHub `stamina-battle` 分支對應資料夾。
3. 執行 `npm run build:module-versions` 並提交變更，供靜態快取與服務工作者取得最新版本。
4. 重新部署後進入兵器閣與問道試煉查看；如果圖片未載入，先排查網路 404，SVG 仍可作為備援。

**武器規則：** 三格地位相同，沒有主武器；單人時可隨時裝備或卸下。多人對戰與合作副本開始後才鎖定裝備（等待配對時允許更改）。右側戰鬥圓盤外圈選武器、內圈選武器技能；不額外消耗一次切換行動。
