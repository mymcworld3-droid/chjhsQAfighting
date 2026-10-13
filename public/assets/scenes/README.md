# 青雲問道 AI 場景插圖

以內建 imagegen 生成，取代共用向量山景與載入插圖。境界紋章保留既有版本。

保留原始像素尺寸，匯出為品質 90 的 WebP。橫式為 1672 × 941，直式為 941 × 1672，分別接近 16:9 與 9:16。文字、數值與按鈕由介面呈現，未烘焙進圖片。

| 素材 | 使用位置 |
| --- | --- |
| `mountains-landscape-ai.webp` | 橫式的修行境界卡、登入、仙榜、全站底圖與鬥法場景 |
| `mountains-portrait-ai.webp` | 相同位置的直式版本 |
| `loading-landscape-ai.webp` | 橫式的仙府載入畫面 |
| `loading-portrait-ai.webp` | 直式的仙府載入畫面 |

共用山景由 `xianxia.css` 的 `--xq-scene-art` 統一選圖，依畫布方向選擇橫／直版本。載入底圖由同一方向規則的 `--xq-loading-art` 繪製，原生 `<picture>` 負責預載與解碼選中的圖，避免重複的圖層。兩組圖已加入方向對應的預載提示；目前方向優先預熱，另一方向在背景繼續準備。

## 生成提示詞

### 共用山景 · 橫式

```text
Use case: stylized-concept. Asset type: finished background illustration for the Chinese cultivation fantasy game 青雲問道. Style: refined painterly game environment concept art, natural stone textures, detailed traditional Chinese architecture with dark teal glazed roof tiles, restrained antique gold trim and warm lantern light, ink-blue and jade mountains, ivory mist, subtle brushwork. Match a sophisticated xianxia landscape with believable cliff paths and pine trees. Atmospheric depth and coherent lighting, no vector look, no flat polygons, no neon cyberpunk, no exaggerated floating ornament clutter. Full-bleed image with no frame, no words, no letters, no text, no symbols resembling UI, no watermark. Primary request: a landscape 16:9 mountain-and-cloud-sea illustration replacing a flat vector mountain wallpaper. Faraway layered misty peaks and a quiet Qingyun sect pavilion on the right, a graceful pine branch and stone path at the lower right, a faint pale gold moon in the upper right behind haze. The LEFT 50 percent should be calm dark teal mountain haze with rich low-contrast natural texture, for readable live game text. Place the detailed pavilion and main cliff mostly in the right third near vertical center; keep all key content comfortably inside the edges. Deep jade and ink blue with warm gold accents, dignified and serene. Clear beautiful mountain detail on the right, no hard graphic division between the quiet left and the scenic right.
```

### 共用山景 · 直式

```text
Use case: stylized-concept. Asset type: finished background illustration for the Chinese cultivation fantasy game 青雲問道. Style: refined painterly game environment concept art, natural stone textures, detailed traditional Chinese architecture with dark teal glazed roof tiles, restrained antique gold trim and warm lantern light, ink-blue and jade mountains, ivory mist, subtle brushwork. Match a sophisticated xianxia landscape with believable cliff paths and pine trees. Atmospheric depth and coherent lighting, no vector look, no flat polygons, no neon cyberpunk, no exaggerated floating ornament clutter. Full-bleed image with no frame, no words, no letters, no text, no symbols resembling UI, no watermark. Primary request: a tall PORTRAIT 9:16 mountain-and-cloud-sea illustration replacing a flat vector mountain wallpaper, composed specifically for a phone. Faraway layered misty peaks, clouds wrapping rugged cliffs, a quiet Qingyun sect pavilion at the right-center (around x=70%, y=48%), a graceful pine branch and a stone path lower right, a faint pale gold moon above mountains at the upper right. The LEFT 45 percent and central lower area should be calm dark teal mountain haze with natural low-contrast texture for readable live game text. Place the detailed pavilion near the vertical center so a short card cropped from the center remains attractive. Deep jade and ink blue with warm antique gold lights. Beautiful atmospheric depth, generous mist foreground, all key content inside edges, no text.
```

### 仙府載入 · 橫式

```text
Use case: stylized-concept. Asset type: finished background illustration for the Chinese cultivation fantasy game 青雲問道. Style: refined painterly game environment concept art, natural stone textures, detailed traditional Chinese architecture with dark teal glazed roof tiles, restrained antique gold trim and warm lantern light, ink-blue and jade mountains, ivory mist, subtle brushwork. Match a sophisticated xianxia landscape with believable cliff paths and pine trees. Atmospheric depth and coherent lighting, no vector look, no flat polygons, no neon cyberpunk, no exaggerated floating ornament clutter. Full-bleed image with no frame, no words, no letters, no text, no symbols resembling UI, no watermark. Primary request: a LANDSCAPE 16:9 cinematic moonlit cultivation sect landscape for a full-screen game loading scene. A majestic traditional Chinese mountain gateway and a luminous ivory-and-gold moon emerge from ink-blue cloud seas. The gate is at the right-center, a solitary very small distant robed cultivator stands on a stone terrace at the lower left contemplating the gate. Dark teal peaks and soft white cloud banks, pale gold light drifting through mist. Keep the left upper area and bottom-center 35 percent quiet, dark, and low-contrast because the game overlays loading text there; the detailed gate and moon stay toward the upper/right part of the frame. Painterly game art, rich atmosphere, tasteful and coherent with teal roofs and golden Qingyun architecture. No literal progress bars, no graphics, no captions, no lettering.
```

### 仙府載入 · 直式

```text
Use case: stylized-concept. Asset type: finished background illustration for the Chinese cultivation fantasy game 青雲問道. Style: refined painterly game environment concept art, natural stone textures, detailed traditional Chinese architecture with dark teal glazed roof tiles, restrained antique gold trim and warm lantern light, ink-blue and jade mountains, ivory mist, subtle brushwork. Match a sophisticated xianxia landscape with believable cliff paths and pine trees. Atmospheric depth and coherent lighting, no vector look, no flat polygons, no neon cyberpunk, no exaggerated floating ornament clutter. Full-bleed image with no frame, no words, no letters, no text, no symbols resembling UI, no watermark. Primary request: a tall PORTRAIT 9:16 cinematic moonlit cultivation sect landscape for a full-screen phone game loading scene. A majestic traditional Chinese mountain gateway emerges from an ink-blue sea of clouds in the upper-middle/right, and a luminous ivory-and-gold moon hangs in the upper right. A solitary very small distant robed cultivator stands on a narrow stone terrace around the lower-left middle, contemplating the gate. Misty dark teal peaks, elegant ancient roofs and warm antique gold lanterns. Keep the BOTTOM 40 percent mostly dark quiet cloud haze with very low-contrast texture because the game overlays loading text there. Center the visual story in the upper 55 percent with generous spacing and believable cliffs and path perspective. Refined painterly xianxia game art, warm light through cold mist. No UI, no words, no glyphs, no watermark.
```

