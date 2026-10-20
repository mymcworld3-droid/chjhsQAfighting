# 修煉場景圖

## AI 山景、五島與雲層（2026-10-13）

目前修煉地圖改用 `layers/` 中橫式、直式各十張 AI 素材。原本的兩張 `cultivation-*-clean.webp` 為分層來源，保留作為參考。

- `*-far`：星空與遠山底圖，最後移除月亮。
- `*-mountains-middle`：獨立透明的中景山峰，補出雲後的岩壁。
- `*-island-vault`、`*-island-secret`、`*-island-meditation`、`*-island-forge`、`*-island-status`：五座山島各自去背，保留松樹、山臺、瀑布與橋梁。
- `*-cloud-far`、`*-cloud-middle`、`*-cloud-near`：三張透明雲原稿。中層雲分成上、中、下三個柔邊區域，分別插入不同島嶼之間，總共形成五層雲。

PNG 原稿保留完整 1672×941／941×1672 畫布，WebP 以 alpha 範圍加八像素邊距裁去空白。`public/cultivation/training-scene-layer-art.js` 保存裁切座標，`training-scene-layouts.js` 將各島山臺對齊既有建築底座，建築按鈕與名稱的位置維持一致。

雲層單程移動分別為 78、68、56、48、42 秒，方向與相位不同，來回平滑轉向。山峰與五島保持固定，雲從山後與島間穿過；手機版不受一般動畫 0.5 秒限制。離開地圖後暫停，減少動態效果時保持靜止。當前方向的全部圖層加入啟動預載，另一方向在背景預載。

[內建 imagegen 的完整提示詞](layers/PROMPTS.md)。

## AI 建築去背與分層（2026-10-12）

此前畫面使用 `cultivation-landscape-clean.webp` 與 `cultivation-portrait-clean.webp` 兩張背景底圖；AI 移除原本的五處前景建築，保留仙山、橋梁與地面，避免按鈕縮放時露出重複建築。現在進一步分離山島與雲層，但仍沿用這五個獨立建築。

五個建築皆以內建 imagegen 從原圖提取，PNG 保留真正的 RGBA 透明背景，WebP 為遊戲載入版本：

- `cutouts/meditation-ai.png`：修煉室。
- `cutouts/vault-ai.png`：寶庫。
- `cutouts/forge-ai.png`：鍛造坊。
- `cutouts/secret-ai.png`：秘境。
- `cutouts/status-ai.png`：狀態亭與星鏡。

橫直版共用這五個素材，以 alpha 範圍的 SVG viewBox 等比放置，取消手繪多邊形切片和外框描線。光暈沿實際透明輪廓，包含細白亮邊與獨立的柔霧層；滑過／聚焦時增亮，未解鎖時關閉。背景與所有建築均在載入階段預載。

[完整 AI 提示詞](cutouts/PROMPTS.md)


## 原始場景繪畫

Generated with the built-in imagegen tool. The portrait uses the landscape as a style reference.

- `cultivation-landscape.png`: 1672 × 941, 16:9.
- `cultivation-portrait.png`: 941 × 1672, 9:16.
- Matching `.webp` versions of the original paintings are retained for reference; the current page preloads the clean plates and five transparent sprites listed above.
- These original paintings are retained as the AI extraction and clean-plate editing references. The current page uses the layered assets listed above.
- Labels, locks and the white edge glow are live UI, not baked into the paintings.

## Landscape prompt

Generate one finished, premium Chinese xianxia cultivation estate GAME MAP illustration, landscape 16:9, ideally 1536x864. This is an interactive game menu background, not a mockup: NO UI, NO lettering, NO text, NO labels, NO border, NO locks, NO arrows, NO characters. Elegant painterly 2.5D isometric architectural illustration with exceptionally clean silhouettes, refined carved dark timber, aged pale stone, jade teal tiled roofs, subtle warm gold lamps, moon-white mist; midnight ink-green mountains, celestial starry twilight. Atmospheric, handcrafted fantasy game art, lush but not cluttered, warm muted luminous architecture against a dark scenery, coherent perspective. EXACTLY FIVE separate, recognizable destinations connected by delicate stone paths across a floating mountain garden. Leave generous clear ground beneath each building for labels later. Layout with generous 10% blank margin around entire scene, keep all destination silhouettes completely within x10%-90%, y24%-76% so image can safely crop a little at top and bottom. 1 CENTRAL cultivation hall at (50%,44%): the largest tranquil dark teal-roof pavilion with open golden-lit meditation chamber, round jade dais and a tiny levitating luminous golden orb, ancient pine behind. 2 UPPER LEFT treasure vault at (21%,33%): compact ornate locked treasury pavilion with bronze double doors and visible jewel chests on its terrace, roof silhouette isolated from background. 3 LOWER LEFT forge at (21%,66%): compact roofed smithy with open orange furnace, bronze anvil, metal tools, orange ember glow. 4 UPPER RIGHT secret realm at (80%,34%): a freestanding old stone circular moon gate with a luminous jade/violet portal, stairs and a rock arch, NOT another pagoda. 5 LOWER RIGHT status observatory at (80%,67%): small elegant octagonal star pavilion with celestial brass armillary sphere and a tall jade standing mirror reflecting constellation light. All five architecture clusters separately identifiable with their own small platforms, no objects crossing each other, not lined up as icons, genuine integrated landscape. Sparse cloud wisps between terraces and distant dramatic ridges, quiet ink-black edges; crisp enough for precise architecture cutout buttons. The landscape should read like an exquisite illustrated sect map, understated rich gold/teal/ivory compatible with a black and antique-gold Chinese fantasy interface. No garish neon, no photorealism, no modern objects.

## Portrait prompt

Create ONE new PORTRAIT 9:16 game menu map illustration (ideally 864x1536) using the supplied landscape artwork as a strict ART STYLE, architecture, palette and world reference. Recompose it completely for a tall mobile map; do NOT simply crop the landscape. Match the exquisite painterly 2.5D isometric carved dark timber, jade-teal tiled roofs, antique gold lamps, floating mountain terraces, ink-green moonlit ridges, waterfalls, ivory clouds and starry twilight. No UI, no words, no labels, no locks, no people. EXACTLY FIVE distinct recognizable destinations, all architecture silhouettes and their platforms within x8%-92%, y20%-80%, leaving top 16% mostly distant mountain sky/clouds and bottom 16% quiet fog/rock for safe cropping to a shorter phone content area. Keep no small decorative pagodas resembling an extra clickable location. Composition: UPPER LEFT treasure vault centered about (25%,30%), ornate compact treasury pavilion with bronze round-engraved doors and treasure chests on terrace. UPPER RIGHT secret realm centered about (76%,30%), old freestanding circular stone moon gate with luminous lavender/jade portal among flowering branches and a short stair, visually distinct from a house. CENTRAL cultivation hall centered about (50%,49%), the largest graceful teal-roof meditation pavilion with open golden-lit chamber, jade floor dais and tiny golden levitating orb, an ancient pine behind. LOWER LEFT forge at (25%,70%), roofed open smithy with orange furnace and anvil on a small stone terrace. LOWER RIGHT status observatory at (76%,70%), octagonal star pavilion with celestial brass armillary sphere and a tall jade standing mirror showing constellations. Keep destinations well apart with clear distinct silhouettes, clouds between, slender stone bridges, paths and stairs integrated into a believable mountain estate. Leave clear ground directly beneath each main building for a small added label; NO baked-in writing. Make buildings sufficiently bold and recognizable at mobile size. Whole image feels like the same exact place as the reference seen with a specially arranged vertical estate layout. Understated premium Chinese xianxia fantasy painting, crisp detailed architecture, quiet dramatic scenery, NOT a collage, no border, no infographic.

