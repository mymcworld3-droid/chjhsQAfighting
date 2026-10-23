# 一般草坪

- `grass.webp` / `grass.png`：80 × 80 px，建議顯示為單格 40 × 40 CSS px。
- `grass-40.webp` / `grass-40.png`：40 × 40 px 原生小尺寸版本。
- 一格草坪與一名角色的站立格相同；角色可向格子上方延伸，實際高度約 48 px。
- 普通可行走地面，不含角色、障礙、陰影或格線；格線由地圖另外繪製。
- 可重複鋪設；手機建議載入 80 px WebP，單張約 1.6 KB。
- `source/` 保留內建圖片生成工具的原始結果與提示詞，原始大圖不供地圖載入。
- `manifest.json` 提供尺寸與通行設定。

預覽：`docs/design/world-map-players/grass-size-preview.png`，以每格 40 px 與角色實際建議大小顯示。
