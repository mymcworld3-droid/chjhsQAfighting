# 修煉山景與雲層 AI 素材

使用內建 imagegen 生成／編修。橫式、直式分別參考既有 `cultivation-landscape-clean` 和 `cultivation-portrait-clean` 圖；五島提取直接以 WebP 為編修來源。遠景最後移除月亮。PNG 為完整畫布的透明原稿；WebP 去掉不必要的透明外邊，`training-scene-layer-art.js` 保存還原座標。雲層保留真正的 RGBA alpha。

## landscape-mountains-middle

參考素材：對應橫式／直式原場景 PNG。

透明背景：是

```text
Use case: compositing and precise-object-edit.
Asset type: fixed-ratio Chinese xianxia interactive map layered scene.
Input image 1 is the EDIT TARGET. Preserve its camera, palette, moon, mountain geography and relative positions. It is a finished premium moonlit painterly xianxia map, and the intended result is a separable scene layer which will be composited over OTHER EXACTLY ALIGNED layers. Do not change zoom or recompose. No UI, text, labels, borders, people or added destination buildings.
Output: ONE transparent RGBA LANDSCAPE 16:9 full-frame mountain MIDDLE layer, exact input framing 1672 x 941. Extract ONLY the medium and tall background mountain peaks behind the FIVE circular terrace islands, including their tiny summit temples and distant waterfalls. Keep their silhouettes, exact positions, height, perspective, moonlit rock and foliage details. Reconstruct the portions of these peaks currently hidden by clouds, so clouds can drift across them without revealing holes. Remove ALL white clouds, sky, moon, galaxy, the five foreground platforms/islands, connecting stone bridges, central pine mountain and all large foreground trees. Those removed areas must be truly TRANSPARENT including spaces between mountain silhouettes, NOT white/gray/checkerboard. Full frame size and absolute alignment must remain unchanged; do not center or enlarge extracted subject. Original palette, no glow outline.
```

## portrait-mountains-middle

參考素材：對應橫式／直式原場景 PNG。

透明背景：是

```text
Use case: compositing and precise-object-edit.
Asset type: fixed-ratio Chinese xianxia interactive map layered scene.
Input image 1 is the EDIT TARGET. Preserve its camera, palette, moon, mountain geography and relative positions. It is a finished premium moonlit painterly xianxia map, and the intended result is a separable scene layer which will be composited over OTHER EXACTLY ALIGNED layers. Do not change zoom or recompose. No UI, text, labels, borders, people or added destination buildings.
Output: ONE transparent RGBA PORTRAIT 9:16 full-frame mountain MIDDLE layer, exact input framing 941 x 1672. Extract ONLY the medium/tall background mountain peaks behind the FIVE circular terrace islands, including summit temples and thin distant waterfalls. Keep their exact silhouettes, positions, height, perspective and moonlit rock detail. Reconstruct any portions hidden by white clouds so animated clouds can move away without holes. Remove ALL white clouds and haze, sky, moon, stars, the FIVE foreground islands/platforms and connecting bridges, big central pine and all foreground trees. All removed areas truly transparent, especially wide gaps between peaks and the lower half; not gray, white or checkerboard. Do not zoom, center or change composition. Original palette, no glow outline.
```

## landscape-cloud-middle

參考素材：對應橫式／直式原場景 PNG。

透明背景：是

```text
Use case: compositing and precise-object-edit.
Asset type: fixed-ratio Chinese xianxia interactive map layered scene.
Input image 1 is the EDIT TARGET. Preserve its camera, palette, moon, mountain geography and relative positions. It is a finished premium moonlit painterly xianxia map, and the intended result is a separable scene layer which will be composited over OTHER EXACTLY ALIGNED layers. Do not change zoom or recompose. No UI, text, labels, borders, people or added destination buildings.
Use case: background-extraction.
Output: ONE truly transparent RGBA LANDSCAPE 16:9, 1672 x 941 full-frame MIDDLE-DISTANCE CLOUD SEA layer. Extract and reconstruct ONLY the original softly billowing silver-blue cloud banks curling through the valleys between background peaks and foreground terrace islands, mainly across y25%-70% (stretching gently from left to right). Reconstruct cloud shapes behind removed mountains into complete natural vapor banks. Top y0%-18% must be clear transparent. Keep the bottom corners mostly empty for a separate near-cloud layer. Remove ALL mountains, platform surfaces, cliffs, waterfalls, pine trees, temples, moon, sky and stars to genuine transparency. Cloud-only illustration with natural soft varying alpha, silver highlights and slate-blue shadows matching reference; no solid backing/gray rectangle/checkerboard; no border or straight cuts. Keep full-frame source coordinates; do not center/enlarge extracted clouds. Clouds will drift BEHIND the five foreground islands.
```

## landscape-cloud-near

參考素材：對應橫式／直式原場景 PNG。

透明背景：是

```text
Use case: compositing and precise-object-edit.
Asset type: fixed-ratio Chinese xianxia interactive map layered scene.
Input image 1 is the EDIT TARGET. Preserve its camera, palette, moon, mountain geography and relative positions. It is a finished premium moonlit painterly xianxia map, and the intended result is a separable scene layer which will be composited over OTHER EXACTLY ALIGNED layers. Do not change zoom or recompose. No UI, text, labels, borders, people or added destination buildings.
Use case: background-extraction.
Output: ONE truly transparent RGBA LANDSCAPE 16:9, 1672 x 941 full-frame FOREGROUND CLOUD layer. Extract and reconstruct ONLY the softly luminous dense ivory/slate-blue foreground cloud banks in the bottom of the reference, keeping original nighttime painted cloud textures. Clouds confined mostly to lower y72%-100%, with slightly taller delicate wisps on extreme left/right sides, and quieter thinner vapor in lower central gap. Top y0%-60% must be EMPTY truly transparent canvas; absolutely no cloud covering any of the five circular platform surfaces. Reconstruct complete cloud banks formerly hidden by mountain silhouettes, feather the cloud edges with smooth variable alpha. Remove ALL mountains, land, waterfalls, platforms, bridges, trees, stars, moon and sky to true transparency. No sky rectangle, no solid gray/white backing, no checkerboard pixels; only cloud vapor on transparent canvas. Preserve full-frame coordinates and original color/light, no zoom, no labels. This image will drift IN FRONT OF foreground cliffs, but behind building buttons.
```

## portrait-cloud-middle

參考素材：對應橫式／直式原場景 PNG。

透明背景：是

```text
Use case: compositing and precise-object-edit.
Asset type: fixed-ratio Chinese xianxia interactive map layered scene.
Input image 1 is the EDIT TARGET. Preserve its camera, palette, moon, mountain geography and relative positions. It is a finished premium moonlit painterly xianxia map, and the intended result is a separable scene layer which will be composited over OTHER EXACTLY ALIGNED layers. Do not change zoom or recompose. No UI, text, labels, borders, people or added destination buildings.
Use case: background-extraction.
Output: ONE truly transparent RGBA PORTRAIT 9:16, 941 x 1672 full-frame MIDDLE-DISTANCE CLOUD SEA layer. Extract and reconstruct ONLY the original softly billowing silver-blue cloud banks curling through the valleys between background peaks and foreground terrace islands, mainly across y25%-70% (some long slender clouds along the left and right valleys down to y80%). Reconstruct cloud shapes behind removed mountains into complete natural vapor banks. Top y0%-18% must be clear transparent. Keep the bottom corners mostly empty for a separate near-cloud layer. Remove ALL mountains, platform surfaces, cliffs, waterfalls, pine trees, temples, moon, sky and stars to genuine transparency. Cloud-only illustration with natural soft varying alpha, silver highlights and slate-blue shadows matching reference; no solid backing/gray rectangle/checkerboard; no border or straight cuts. Keep full-frame source coordinates; do not center/enlarge extracted clouds. Clouds will drift BEHIND the five foreground islands.
```

## portrait-cloud-near

參考素材：對應橫式／直式原場景 PNG。

透明背景：是

```text
Use case: compositing and precise-object-edit.
Asset type: fixed-ratio Chinese xianxia interactive map layered scene.
Input image 1 is the EDIT TARGET. Preserve its camera, palette, moon, mountain geography and relative positions. It is a finished premium moonlit painterly xianxia map, and the intended result is a separable scene layer which will be composited over OTHER EXACTLY ALIGNED layers. Do not change zoom or recompose. No UI, text, labels, borders, people or added destination buildings.
Use case: background-extraction.
Output: ONE truly transparent RGBA PORTRAIT 9:16, 941 x 1672 full-frame FOREGROUND CLOUD layer. Extract and reconstruct ONLY the softly luminous dense ivory/slate-blue foreground cloud banks in the bottom of the reference, keeping original nighttime painted cloud textures. Clouds confined mostly to lower y72%-100%, with slightly taller delicate wisps on extreme left/right sides, and quieter thinner vapor in lower central gap. Top y0%-60% must be EMPTY truly transparent canvas; absolutely no cloud covering any of the five circular platform surfaces. Reconstruct complete cloud banks formerly hidden by mountain silhouettes, feather the cloud edges with smooth variable alpha. Remove ALL mountains, land, waterfalls, platforms, bridges, trees, stars, moon and sky to true transparency. No sky rectangle, no solid gray/white backing, no checkerboard pixels; only cloud vapor on transparent canvas. Preserve full-frame coordinates and original color/light, no zoom, no labels. This image will drift IN FRONT OF foreground cliffs, but behind building buttons.
```

## landscape-far

參考素材：本次先生成的遠山底圖（移除月亮的編修目標）

透明背景：否

```text
Use case: precise-object-edit.
Input image 1 is the EDIT TARGET. Make only ONE change: remove the bright round moon at the upper right completely and inpaint the vacated disk and moon halo with the surrounding quiet dark blue starry sky. There must be NO moon anywhere in the output, no replacement bright orb/sun, no new clouds. Preserve EVERY mountain ridge, the galaxy/stars away from the moon, exact colors, camera, composition, framing and original 1672 x 941 LANDSCAPE 16:9 size. Output opaque background image, no UI/text, all other areas unchanged.
```

## portrait-far

參考素材：本次先生成的遠山底圖（移除月亮的編修目標）

透明背景：否

```text
Use case: precise-object-edit.
Input image 1 is the EDIT TARGET. Make only ONE change: remove the bright round moon at the upper right completely and inpaint the vacated disk and moon halo with the surrounding quiet dark blue starry sky. There must be NO moon anywhere in the output, no replacement bright orb/sun, no new clouds. Preserve EVERY mountain ridge, the galaxy/stars away from the moon, exact colors, camera, composition, framing and original 941 x 1672 PORTRAIT 9:16 size. Output opaque background image, no UI/text, all other areas unchanged.
```

## landscape-island-vault

參考素材：cultivation-landscape-clean.webp

透明背景：是

```text
Use case: background-extraction.
Input image 1 is the EXACT EDIT TARGET, not a style inspiration. The task is precise extraction of ONE UPPER LEFT island as an independently composited game layer.
Output ONE truly transparent RGBA LANDSCAPE 16:9 canvas, EXACT same full-frame 1672 x 941 camera/framing as input.
KEEP ONLY the circular platform centered near x310 y322, its island and foreground pine/rocks. This is the platform for the treasure vault. Preserve the original pixels, architecture-free empty platform, EXACT platform position and size, perspective, stone engravings, railing, pine silhouette, rocks, waterfalls. This layer will be overlaid at (0,0) with the same canvas size; do NOT center, resize, zoom, rotate or recompose this island. Reconstruct only cliff/tree portions concealed by clouds, filling with matching source rock and foliage.
REMOVE everything else: the OTHER FOUR platform islands, all intermediate/distant mountains, all clouds/fog, sky, moon, stars and buildings to genuine alpha transparency. The unused canvas must be transparent, not black/white/checkerboard. Keep delicate foliage edges and empty air between branches. NO additional objects, no cloud left attached, no glow, no new platforms, no UI or writing. Retain one island in its ORIGINAL full-frame location.
```

## landscape-island-secret

參考素材：cultivation-landscape-clean.webp

透明背景：是

```text
Use case: background-extraction.
Input image 1 is the EXACT EDIT TARGET, not a style inspiration. The task is precise extraction of ONE UPPER RIGHT island as an independently composited game layer.
Output ONE truly transparent RGBA LANDSCAPE 16:9 canvas, EXACT same full-frame 1672 x 941 camera/framing as input.
KEEP ONLY the circular platform centered near x1370 y347, the tall crag directly behind it and its own rocks/trees. This is the platform for the portal. Preserve the original pixels, architecture-free empty platform, EXACT platform position and size, perspective, stone engravings, railing, pine silhouette, rocks, waterfalls. This layer will be overlaid at (0,0) with the same canvas size; do NOT center, resize, zoom, rotate or recompose this island. Reconstruct only cliff/tree portions concealed by clouds, filling with matching source rock and foliage.
REMOVE everything else: the OTHER FOUR platform islands, all intermediate/distant mountains, all clouds/fog, sky, moon, stars and buildings to genuine alpha transparency. The unused canvas must be transparent, not black/white/checkerboard. Keep delicate foliage edges and empty air between branches. NO additional objects, no cloud left attached, no glow, no new platforms, no UI or writing. Retain one island in its ORIGINAL full-frame location.
```

## landscape-island-meditation

參考素材：cultivation-landscape-clean.webp

透明背景：是

```text
Use case: background-extraction.
Input image 1 is the EXACT EDIT TARGET, not a style inspiration. The task is precise extraction of ONE CENTER island as an independently composited game layer.
Output ONE truly transparent RGBA LANDSCAPE 16:9 canvas, EXACT same full-frame 1672 x 941 camera/framing as input.
KEEP ONLY the LARGE circular platform centered near x848 y455, its lower circular stair landing, central huge ancient pine behind it, central island and four connecting bridges out to neighboring islands. Keep the full connecting bridges, railings and supporting arches but STOP where they meet the other island's rock/platform edge. Preserve the original pixels, architecture-free empty platform, EXACT platform position and size, perspective, stone engravings, railing, pine silhouette, rocks, waterfalls. This layer will be overlaid at (0,0) with the same canvas size; do NOT center, resize, zoom, rotate or recompose this island. Reconstruct only cliff/tree portions concealed by clouds, filling with matching source rock and foliage.
REMOVE everything else: the OTHER FOUR platform islands, all intermediate/distant mountains, all clouds/fog, sky, moon, stars and buildings to genuine alpha transparency. The unused canvas must be transparent, not black/white/checkerboard. Keep delicate foliage edges and empty air between branches. NO additional objects, no cloud left attached, no glow, no new platforms, no UI or writing. Retain one island in its ORIGINAL full-frame location.
```

## landscape-island-forge

參考素材：cultivation-landscape-clean.webp

透明背景：是

```text
Use case: background-extraction.
Input image 1 is the EXACT EDIT TARGET, not a style inspiration. The task is precise extraction of ONE LOWER LEFT island as an independently composited game layer.
Output ONE truly transparent RGBA LANDSCAPE 16:9 canvas, EXACT same full-frame 1672 x 941 camera/framing as input.
KEEP ONLY the circular platform centered near x310 y655, its island, orange trees, waterfalls and extreme bottom-left foreground pine/rocks. Preserve the original pixels, architecture-free empty platform, EXACT platform position and size, perspective, stone engravings, railing, pine silhouette, rocks, waterfalls. This layer will be overlaid at (0,0) with the same canvas size; do NOT center, resize, zoom, rotate or recompose this island. Reconstruct only cliff/tree portions concealed by clouds, filling with matching source rock and foliage.
REMOVE everything else: the OTHER FOUR platform islands, all intermediate/distant mountains, all clouds/fog, sky, moon, stars and buildings to genuine alpha transparency. The unused canvas must be transparent, not black/white/checkerboard. Keep delicate foliage edges and empty air between branches. NO additional objects, no cloud left attached, no glow, no new platforms, no UI or writing. Retain one island in its ORIGINAL full-frame location.
```

## landscape-island-status

參考素材：cultivation-landscape-clean.webp

透明背景：是

```text
Use case: background-extraction.
Input image 1 is the EXACT EDIT TARGET, not a style inspiration. The task is precise extraction of ONE LOWER RIGHT island as an independently composited game layer.
Output ONE truly transparent RGBA LANDSCAPE 16:9 canvas, EXACT same full-frame 1672 x 941 camera/framing as input.
KEEP ONLY the circular platform centered near x1375 y718, its island, waterfalls and extreme bottom-right pine/rocks. Preserve the original pixels, architecture-free empty platform, EXACT platform position and size, perspective, stone engravings, railing, pine silhouette, rocks, waterfalls. This layer will be overlaid at (0,0) with the same canvas size; do NOT center, resize, zoom, rotate or recompose this island. Reconstruct only cliff/tree portions concealed by clouds, filling with matching source rock and foliage.
REMOVE everything else: the OTHER FOUR platform islands, all intermediate/distant mountains, all clouds/fog, sky, moon, stars and buildings to genuine alpha transparency. The unused canvas must be transparent, not black/white/checkerboard. Keep delicate foliage edges and empty air between branches. NO additional objects, no cloud left attached, no glow, no new platforms, no UI or writing. Retain one island in its ORIGINAL full-frame location.
```

## landscape-cloud-far

參考素材：cultivation-landscape-clean.webp

透明背景：是

```text
Use case: background-extraction.
Input image is a reference for existing clouds, lighting and exact camera only. Create ONE transparent RGBA full-frame LANDSCAPE 16:9 1672 x 941 sprite containing ONLY a few thin moonlit silver-blue vapor clouds from the source's upper left and horizon region. Place delicate horizontally extended wisps at original upper left y5%-25% and a very thin broken cloud band at y20%-30%, leaving top center mostly transparent and ALL pixels below y35% transparent. Crucial: REMOVE THE MOON COMPLETELY. No moon disk or halo, no blue sky rectangle, no stars, no galaxy, no land, no mountains or trees. Only isolated wispy semi-transparent cloud shapes on genuine alpha background. Clouds must have thin translucent tips and smooth natural edge alpha, not hard silhouette cutouts, no gray backing or checkerboard. The sprite is a drifting distant cloud layer behind mountains. Preserve source palette, not dense daylight cumulus.
```

## portrait-island-vault

參考素材：cultivation-portrait-clean.webp

透明背景：是

```text
Use case: background-extraction.
Input image 1 is the EXACT EDIT TARGET, not a style reference. Precisely extract ONE UPPER LEFT foreground island into an independently composited game scene layer.
Output ONE truly transparent RGBA PORTRAIT 9:16 canvas, EXACT same full-frame 941 x 1672 framing as input.
KEEP ONLY the circular platform centered near x182 y439, its entire rocky island, pine/rocks and its own stairs. Preserve original empty platform engraving, exact position and size, perspective, railing, original tree silhouettes, rock/foliage/waterfall details. The result overlays the original at (0,0) with SAME canvas size; do not center, zoom, rotate, resize or recompose this island. Reconstruct only cliff and tree portions concealed by clouds using matching source rock/foliage.
REMOVE all the OTHER FOUR platform islands, intermediate/distant mountains, white clouds/fog, sky, moon, stars and buildings to TRUE ALPHA TRANSPARENCY. Unused canvas transparent, not black/white/checkerboard. Fine alpha around branches and railings, no cloud bank attached, no added objects/glow, no new platform or building, no UI/writing. One island ONLY, in its original full-frame coordinates.
```

## portrait-island-secret

參考素材：cultivation-portrait-clean.webp

透明背景：是

```text
Use case: background-extraction.
Input image 1 is the EXACT EDIT TARGET, not a style reference. Precisely extract ONE UPPER RIGHT foreground island into an independently composited game scene layer.
Output ONE truly transparent RGBA PORTRAIT 9:16 canvas, EXACT same full-frame 941 x 1672 framing as input.
KEEP ONLY the circular platform centered near x775 y486, its entire rocky island, tall crag behind it and its own trees/rocks and stairs. Preserve original empty platform engraving, exact position and size, perspective, railing, original tree silhouettes, rock/foliage/waterfall details. The result overlays the original at (0,0) with SAME canvas size; do not center, zoom, rotate, resize or recompose this island. Reconstruct only cliff and tree portions concealed by clouds using matching source rock/foliage.
REMOVE all the OTHER FOUR platform islands, intermediate/distant mountains, white clouds/fog, sky, moon, stars and buildings to TRUE ALPHA TRANSPARENCY. Unused canvas transparent, not black/white/checkerboard. Fine alpha around branches and railings, no cloud bank attached, no added objects/glow, no new platform or building, no UI/writing. One island ONLY, in its original full-frame coordinates.
```

## portrait-island-meditation

參考素材：cultivation-portrait-clean.webp

透明背景：是

```text
Use case: background-extraction.
Input image 1 is the EXACT EDIT TARGET, not a style reference. Precisely extract ONE CENTER foreground island into an independently composited game scene layer.
Output ONE truly transparent RGBA PORTRAIT 9:16 canvas, EXACT same full-frame 941 x 1672 framing as input.
KEEP ONLY the LARGE circular platform centered near x487 y860, its lower circular stair landing, huge ancient pine directly behind it, full central rocky island and four connecting bridges to neighboring islands. Keep complete original bridges with railing and supporting arches, stopping where the bridges meet the other island rock/platform edges. Preserve original empty platform engraving, exact position and size, perspective, railing, original tree silhouettes, rock/foliage/waterfall details. The result overlays the original at (0,0) with SAME canvas size; do not center, zoom, rotate, resize or recompose this island. Reconstruct only cliff and tree portions concealed by clouds using matching source rock/foliage.
REMOVE all the OTHER FOUR platform islands, intermediate/distant mountains, white clouds/fog, sky, moon, stars and buildings to TRUE ALPHA TRANSPARENCY. Unused canvas transparent, not black/white/checkerboard. Fine alpha around branches and railings, no cloud bank attached, no added objects/glow, no new platform or building, no UI/writing. One island ONLY, in its original full-frame coordinates.
```

## portrait-island-forge

參考素材：cultivation-portrait-clean.webp

透明背景：是

```text
Use case: background-extraction.
Input image 1 is the EXACT EDIT TARGET, not a style reference. Precisely extract ONE LOWER LEFT foreground island into an independently composited game scene layer.
Output ONE truly transparent RGBA PORTRAIT 9:16 canvas, EXACT same full-frame 941 x 1672 framing as input.
KEEP ONLY the circular platform centered near x252 y1198, its entire rocky island, orange trees, waterfalls and extreme bottom-left foreground pine/rocks. Preserve original empty platform engraving, exact position and size, perspective, railing, original tree silhouettes, rock/foliage/waterfall details. The result overlays the original at (0,0) with SAME canvas size; do not center, zoom, rotate, resize or recompose this island. Reconstruct only cliff and tree portions concealed by clouds using matching source rock/foliage.
REMOVE all the OTHER FOUR platform islands, intermediate/distant mountains, white clouds/fog, sky, moon, stars and buildings to TRUE ALPHA TRANSPARENCY. Unused canvas transparent, not black/white/checkerboard. Fine alpha around branches and railings, no cloud bank attached, no added objects/glow, no new platform or building, no UI/writing. One island ONLY, in its original full-frame coordinates.
```

## portrait-island-status

參考素材：cultivation-portrait-clean.webp

透明背景：是

```text
Use case: background-extraction.
Input image 1 is the EXACT EDIT TARGET, not a style reference. Precisely extract ONE LOWER RIGHT foreground island into an independently composited game scene layer.
Output ONE truly transparent RGBA PORTRAIT 9:16 canvas, EXACT same full-frame 941 x 1672 framing as input.
KEEP ONLY the circular platform centered near x758 y1270, its entire rocky island, pine/rocks, waterfalls and extreme bottom-right foreground pine/rocks. Preserve original empty platform engraving, exact position and size, perspective, railing, original tree silhouettes, rock/foliage/waterfall details. The result overlays the original at (0,0) with SAME canvas size; do not center, zoom, rotate, resize or recompose this island. Reconstruct only cliff and tree portions concealed by clouds using matching source rock/foliage.
REMOVE all the OTHER FOUR platform islands, intermediate/distant mountains, white clouds/fog, sky, moon, stars and buildings to TRUE ALPHA TRANSPARENCY. Unused canvas transparent, not black/white/checkerboard. Fine alpha around branches and railings, no cloud bank attached, no added objects/glow, no new platform or building, no UI/writing. One island ONLY, in its original full-frame coordinates.
```

## portrait-cloud-far

參考素材：cultivation-portrait-clean.webp

透明背景：是

```text
Use case: background-extraction.
Input image is a cloud shape/palette and camera reference only. Create ONE genuinely transparent RGBA PORTRAIT 9:16 full-frame 941 x 1672 sprite containing ONLY a few delicate silver-blue NIGHTTIME CLOUD wisps from the source's upper left and distant horizon. Spread thin natural moonlit vapor at y4%-20%; ALL pixels below y26% must be empty transparent. Keep original light/painterly style but no dense thick white banks. REMOVE THE MOON COMPLETELY: no bright disk, halo, orb, sun or stars, no blue sky rectangle, no galaxy, no land/mountain/tree. Only wispy cloud shapes with softly fading translucent vapor and smooth varied alpha. No gray backing or checkerboard pixels. Full-frame source alignment, no centering. This layer will drift behind middle-distance peaks.
```
