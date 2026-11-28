# 六武器高清原畫安裝說明

目前六張 **1024 × 1024 WebP 透明背景武器圖已提交至本分支**。已去除山景、建築與地面，保留武器、圖騰與光效的透明度；戰場及兵器閣共用這六張圖，不會同時請求 SVG 備援。武器修煉頁依序疊放霧底盤、旋轉金框、武器與境界標籤，武器不作圓形裁切。

載入策略：只在武器實際可見或即將操作時請求相關高清圖；初始登入不預載六張武器。SVG 仍保留於儲存庫，供未來需要時使用。

| 武器 | 請放在 `public/assets/weapons/` |
|---|---|
| 流風靈劍 | `sword-wind-hd.webp` |
| 御靈飛劍 | `sword-flight-hd.webp` |
| 八方天劍 | `sword-sky-hd.webp` |
| 玄嶽圖騰 | `body-rock-hd.webp` |
| 龍象圖騰 | `body-dragon-hd.webp` |
| 伏虎圖騰 | `body-tiger-hd.webp` |

1. 本分支已包含這六張高清圖片；不需再次安裝。若日後更換素材，再解壓圖片包並保留目錄結構。
2. 將有變更的 `-hd.webp` 合併到 GitHub `stamina-battle` 分支對應資料夾。
3. 執行 `npm run build:module-versions` 並提交變更，供靜態快取與服務工作者取得最新版本。
4. 重新部署後進入兵器閣與問道試煉查看；若圖片未載入，先排查網路 404 與版本快取。

**武器規則：** 三格地位相同，沒有主武器；單人時可隨時裝備或卸下。多人對戰與合作副本開始後才鎖定裝備（等待配對時允許更改）。右側戰鬥圓盤外圈選武器、內圈選武器技能；不額外消耗一次切換行動。

## 2026-11-27 新圖騰正式原畫

新增鳴鐘、蜃影及星隕圖騰三張 1024 × 1024 透明 WebP 原畫：`body-bell-hd.webp`、`body-mirror-hd.webp`、`body-gravity-hd.webp`。使用本次生成的 PNG 原畫，僅縮放及 WebP 壓縮，保留 Alpha 通道。共用武器呈現、功法收藏與情境預載均指向高清圖；舊 SVG 保留但不主動載入。新圖騰的技能圖示與戰鬥規則不在此次修改範圍。

## 2026-11-28 新圖騰九招技能正式圖片

依使用者選定的九張圖片，逐一核對相同構圖的透明原 PNG，再合成純黑背景並縮放為 512 × 512 不透明 WebP。鳴鐘：`bell-strike`、`bell-shock`、`bell-echo`；蜃影：`mirror-strike`、`mirror-summon`、`mirror-swap`；星隕：`gravity-strike`、`gravity-core`、`gravity-crash`。全部置於 `public/assets/skills/`，由 `manual-art.js` 統一提供修煉與戰鬥使用；舊 SVG 保留但不再由該映射載入。武器本身原畫仍為透明背景，不變更既有靈劍技能圖片、技能數值或解鎖規則。
