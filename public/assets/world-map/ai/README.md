# 地圖 AI 圖像

每棟宗門建築、野外結構和秘境入口都有獨立的透明背景 AI 圖片，共 15 棟，保留原本的單一朝向。地表、地景物件和妖獸使用 AI 圖集，營地圍欄、斷牆、橋梁、船隻與妖獸有不同方向素材。主角沿用既有 AI 動畫素材。

| 建築／入口 | 圖片 |
| --- | --- |
| 修煉室 | `meditation.webp` |
| 鍛造坊 | `forge.webp` |
| 契器閣 | `contract.webp` |
| 寶庫 | `vault.webp` |
| 仙榜 | `rank.webp` |
| 論道台 | `duel.webp` |
| 秘境之門 | `raid.webp` |
| 古代望樓 | `watchtower.webp` |
| 山神祭壇 | `shrine.webp` |
| 殘破仙府 | `ruins.webp` |
| 行腳營地 | `camp.webp` |
| 靈泉洞天 | `realm-spring.webp` |
| 古陣秘境 | `realm-array.webp` |
| 藏劍遺窟 | `realm-sword.webp` |
| 星隕石窟 | `realm-star.webp` |

- 單棟建築檔案為 256 × 256 WebP，畫面顯示 72～80 邏輯像素，約 1.8～2 格；圖檔中的透明留白會讓實際輪廓略小。
- 妖獸顯示 44 邏輯像素，採集物 34～38 像素，與角色大小相近。
- 圖集每格 128 × 128，最大邊 640 像素。正式地圖共 27 張小型 WebP（不含既有主角動畫），完整大小見 `manifest.json`。
- 竹林以種子散布三種竹叢，混入灌木並保留空地；石域以鄰格優先規則放置三種散石，八方向相鄰格不會同時放石頭，跨區塊也一致。
- 營地配置相連柵欄、開放入口、物資、柴堆與營火；遺跡有斷牆、石柱與碎石。鍛造坊、契器閣與仙榜分別配置武器架、方尖碑及卷軸架。周邊避開道路和其他物件，與建築的原始正門方向一致。
- 地面使用簡化後的低細節材質，以四乘四地格延伸一張紋理，避免每小格重複碎紋；規格與生成提示詞見 `ground-prompts.md`。
- 透明背景、接地位置、前後遮擋與圖片超出地格後的點選共用 `public/world/world-art.js`。透明像素不截取旁邊地格的點擊。
- `manifest.json` 列出尺寸、檔案大小、來源名稱與來源 SHA-256；生成提示詞在 `prompts.md`、`scenery-prompts.md` 和 `ground-prompts.md`。
- 地形、建築座標、種子、通行與獎勵仍由原本的世界生成器和伺服器決定。

地圖插畫透過 `drawImage` 繪製；格線／選取、路線、傷害文字、血條及小地圖資訊標記仍是互動資訊。沒有另外生成逐格資料庫資料。

重新壓縮原始圖：安裝開發工具 `sharp`，提供 `{"assets":[{"id":"meditation","path":"/path/original.png"}]}` 格式的 JSON 給 `node scripts/pack-world-ai-art.cjs /path/source-manifest.json`。可加 `--merge` 保留其他素材。圖集可提供 `gridColumns`、`gridRows`、`rows`、`columns`、`inset` 與 `quality`，支援裁切部分列與獨立壓縮品質。原始 PNG 保留於生成結果，正式網站只載入小型 WebP。
