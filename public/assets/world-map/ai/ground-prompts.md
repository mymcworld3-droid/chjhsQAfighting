# 簡化地面材質

使用內建 `image_gen`，以原本的地面圖集為編輯輸入，重新繪製二十種低細節材質。正式檔案為 `ground-atlas.webp`（512 × 640，每格 128 × 128）；來源 SHA-256 與下載大小見 `manifest.json`。

原始生成圖為 1122 × 1402。依實際材質邊界裁切：`columns: [0,268,561,855,1122]`、`rows: [0,262,526,790,1054,1402]`、`inset: 3`。打包器的 `inset` 排除交界色；繪製時再排除壓縮圖集邊緣的兩像素，防止 WebP 色度取樣造成異色細線。

一張材質延伸四乘四地格，整塊鏡像銜接。道路仍依相鄰方向遮罩連接，河岸與地形交界保留混合。竹子、石頭、營地圍欄與建築繼續使用獨立圖片，地面不再承擔物件細節。

## 生成提示詞

```text
Use case: style-transfer.
Asset type: production terrain texture atlas for a top-down Chinese xianxia mobile grid-world game. Edit target: the attached existing 4-column by 5-row texture atlas. Redraw all twenty cells to solve extreme visual clutter from detailed photorealistic terrain repeated in tiny 40px game tiles.
Keep exactly the SAME 4 x 5 grid, same cell order, equal square cell sizes, flush edge-to-edge with absolutely NO gutters, NO margins, NO visible grid or frames. Output dimensions 1024 x 1280. Every cell must be an opaque flat ground MATERIAL filling its whole square, never a diorama or raised floating tile. Preserve recognizable material and approximate existing hue, but simplify dramatically to restrained hand-painted game art: extremely calm, softly blended broad color masses with at most 2 or 3 very subtle organic low-contrast patches. Each tile will repeat across hundreds of cells. Texture variation within a tile should stay within about 5 percent brightness for grass/dirt/stone/snow. No focal point, no dark edges, no vignette. All four edges of each cell must meet seamlessly with copies of itself. Do not bake objects into the ground; trees, rocks, fences, bamboo and buildings are separate sprites.
EXACT cell order left to right, top to bottom:
Row 1: (1) muted sage green plain short-grass ground, no individual blades; (2) warm tan packed dirt road material, no pebbles; (3) pale gray-green courtyard stone, only two or three large very faint slab seams, no chips; (4) muted dark olive mountain earth, no pebbles or moss flecks.
Row 2: (5) quiet soft turquoise river surface, only one or two very faint broad rounded ripples, no caustic net; (6) subdued warm gray-brown wooden bridge planks, only three large broad planks; (7) same quiet bridge wood, tiny damage hint only; (8) muted jade green bamboo-forest earth, flat and empty, no leaves or stems.
Row 3: (9) slate gray rock material, large soft tonal masses and at most one faint wide crack, no gravel; (10) quiet gray sealed ground with one extremely faint broad seal circle; (11) muted deep slate blue ocean surface, almost flat, two soft broad ripples, no foam; (12) calm warm pale sand, no footprints or stones.
Row 4: (13) dark desaturated green forest floor, no leaves or twigs; (14) muted golden desert sand with one faint broad dune contour; (15) pale cool snow, nearly flat with gentle shaded undulation; (16) gray-olive swamp ground, softly blended, no gravel or details.
Row 5: (17) pale warm gray stone field ground, no scattered stones or gravel; (18) quiet charcoal volcanic ground with a single subtle dim rust-colored fissure; (19) muted dark orange-red lava with just one or two broad soft orange bands, avoid bright yellow busy veins; (20) pale gray-green plaza stone with only a single very faint large circular inlay, no ornamental pattern.
Style target: clean softly painted RPG ground, pleasant subdued palette, generous visual quiet, character and building readability. Remove 90 percent of the source detail and microtexture. Avoid photographic grain, speckles, stippling, tight grass blades, repeated fine lines, pebbles, tiny flowers, high contrast cracks, decorative patterns, checkerboards, text, labels, symbols outside the subtle seal/plaza, UI, shadows around cell edges. This atlas should look deliberately simple at 100 percent view; do not reintroduce details to make it look more realistic.
```
