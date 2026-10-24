# 清晰地面材質

使用內建 `image_gen` 重新繪製二十種地面材質，並進行一次降低重複花紋的定向修訂。最終來源為 `exec-848dabaf-24e9-4033-8add-c1929411134d.png`；正式檔案 `ground-atlas.webp` 維持 512 × 640、每格 128 × 128、不透明 WebP，quality 84。來源 SHA-256 與大小見 `manifest.json`。

原始圖 1122 × 1402；裁切參數 `columns: [0,280,561,841,1122]`、`rows: [0,278,554,822,1088,1402]`、`inset: 3`。地面維持四乘四地格延伸與鏡像銜接；主色面積提高，小色塊降低對比，避免霧狀暈染與明顯的重複菱形圖案。建築、角色與地景物件沒有改圖。

繪製時以 124 × 124 像素原比例隔離材質，排除圖集壓縮邊緣；分區直接取樣至 `40 × DPR × zoom` 的實體像素尺寸，避免固定放大到 80 再縮小。縮放改變時更新地格與遮罩快取，原材質快取保留。不同生態的過渡限於交界 12% 寬度，保留連接、道路轉角及橋梁方向。

## 初次重繪

輸入：原本偏柔的地面圖集，保留二十格順序與大致配色。

```text
Use case: style-transfer. Asset type: production opaque terrain texture atlas for a Chinese xianxia overhead 2D mobile grid RPG. EDIT the attached existing 4-column by 5-row atlas. Keep every material in exactly its current position and retain the overall muted natural color palette, but REMOVE the foggy muddy blurry cloud texture completely. The game should have SIMPLE, CRISP, CLEAN GROUND under detailed miniature characters, buildings and plants. Main visual direction: restrained hand-painted cel-shaded game material, flat dominant base color with just 2-4 broad clean-edged tonal shapes per cell. All surfaces in sharp focus. Keep edges of tonal shapes legible and deliberate, with only minimal antialiasing, NO blurry airbrush blending. Shapes should be organic, not perfect vector symbols. Contrast is modest but clear; no milky white veil, no washed-out desaturated haze. No grain, mottled noise, photographic textures, watercolor bloom, soft clouds, cloudy marbling, fine scattered particles, detailed blades or tiny stones. This is low DETAIL, not low CLARITY. Exactly FOUR columns and FIVE rows of equal square cells, no gaps, frames, grid strokes or labels, flush opaque materials edge-to-edge, portrait 4:5 image. Each cell must fill its entire square, seamless on opposite sides, no dark border, no vignette, no bevel or floating tile. Pure overhead camera.
Cell order left to right:
Row1: (1) clear muted leaf-green meadow, almost uniform with only 2 small clean-edged darker grass-color patches, no drawn blades; (2) warm tan packed-earth road, nearly uniform with two broad earth-color shapes, no pebbles; (3) pale warm jade-grey courtyard with a FEW large clearly defined stone slabs and thin restrained joints, no cracks or moss speckles; (4) muted olive brown mountain earth with 2-3 broad clean rocky soil shapes, no loose pebbles.
Row2: (5) calm turquoise river with THREE sparse distinct gently curved lighter ripple strokes, no caustic net; (6) warm brown bridge deck with FOUR broad clean wooden planks, no grain; (7) matching broad wood with a simple small broken gap, no debris; (8) calm muted jade-green bamboo soil, almost flat with two restrained leaf-color patches, no bamboo or leaves drawn individually.
Row3: (9) slate grey cliff rock with 2-3 large clean planar rock shapes; (10) grey sealed ground with one sparse faint but crisp large abstract ring, no letters; (11) rich muted deep blue ocean with 3 broad sparse defined wave strokes, no foam; (12) pale warm sandy beach, almost uniform with 2 broad clean-edged sand shapes.
Row4: (13) dark forest-green soil, nearly uniform with 2 broad dark shapes, no leaf litter; (14) ochre desert with TWO clean broad dune contours, no gradients; (15) clean pale cool snow with 2 defined light blue snow-shadow shapes, no haze; (16) quiet grey-olive swamp with 2-3 clean dark shallow puddle shapes, no speckles or reeds.
Row5: (17) warm light grey stone field, almost uniform with 2 broad grey rock-color patches, no pebbles or stones; (18) charcoal volcanic ground with ONE clean narrow dim rust fissure, no fine cracks; (19) muted red-orange lava with THREE broad defined orange flow bands and a few large dark crust shapes, no glow haze, no bright busy veins; (20) pale jade-grey plaza with large simple slabs and one sparse crisp circular inlay, no decorative engraving.
No objects, people, buildings, trees, rocks, props, text, letters, labels, watermark or UI. Do not sharpen the old noisy texture: repaint it as calm crisp intentional shapes. The result should stay quiet when repeated over a large map, with clear small characters in front. Fully opaque image.
```

## 最終修訂

輸入：第一次重繪結果。只減少陸地色塊的面積、對比及斜向條帶，保留清晰輪廓與其他材質。

```text
Use case: precise-object-edit. Edit this twenty-cell 4-column x 5-row opaque ground texture atlas. Keep EXACT same layout, cell boundaries, material identities, river/ocean/bridge/lava textures and large courtyard/slab/inlay details. The result is already much clearer, but the LAND color patches are too large and diagonal: when mirrored in game they form conspicuous repeated X/diamond patterns. Fix ONLY the land material tonal pattern. For grass cell 1 and bamboo soil cell 8 use an almost uniform calm green base, with at most TWO SMALL sparse off-centre irregular patches occupying less than 12% of that cell combined. Patch shade only 5 percent darker than base. For stone field cell 17 use almost uniform pale warm grey, with ONE small sparse off-centre clean-edged grey patch at most 8% of the cell and only 4 percent darker than base. No diagonal bands, no large connected shapes, no marbling. Mountain earth cell 4, forest soil cell 13, beach cell 12, desert cell 14, snow cell 15 and swamp cell 16 must also be predominantly flat base color; keep just one or two small very restrained off-centre shapes, NO huge diagonal stripes. Each land cell's outermost 15 percent rim must be its uniform base color on all edges so repeats are quiet. Keep edges of the few shapes clean and in sharp focus. DO NOT blur, airbrush or introduce fog, grain, noise, tiny grass marks, watercolor bloom, mottling or glow. Keep crisp clean hand-painted game material style, not busy or cloudy. Keep every other cell exactly as in the input, no borders, gutters, labels, objects or text. Entire image fully opaque. Calm spacious surfaces with clear miniature character readability.
```
