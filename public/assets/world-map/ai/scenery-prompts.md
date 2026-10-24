# 四向地景素材提示詞

使用內建 image_gen。既有 props-atlas.webp 僅作風格參考；四向各生成一張 RGBA 圖集，再依等寬四欄、等高兩列裁切，縮為 512 × 256 WebP。正式檔名為 scenery-{north,east,south,west}-atlas.webp；每格 128 × 128。來源雜湊見 manifest.json。

## north

```text
Use case: stylized-concept
Asset type: one production RGBA directional scenery sprite atlas for a small Chinese xianxia overworld game.
Input image: style reference only, existing props atlas. Match its painterly high detail, jade green and warm wood/gold, soft top-left lighting, readable small shapes.
Create a 1024x512 transparent canvas in EXACTLY 4 equal columns and 2 equal rows, eight isolated sprites, each sprite centered fully inside its own 256x256 cell with generous clear transparent margins, no labels, no separators, no text, no background, no ground tile, no floating perspective diamond.
All sprites seen from the same near-top-down elevated orthographic game camera: north is screen up, east screen right. Keep vertical posts upright in world space. Each straight segment fills its own tile width or length and can join end-to-end with another copy.
Cells left to right, top to bottom:
1. Rustic two-rail wood/bamboo camp fence segment, two posts.
2. Simple matching camp entrance gateway with two posts, small cloth lintel, clear open passage, no closed doors.
3. Low gray stone sect wall segment with dark green glazed cap, two end posts, much lower than the existing tall wall.
4. Broken section of ancient masonry wall, irregular stone ends, moss.
5. Short roofless ancient cylindrical broken stone pillar on small square foot.
6. Small loose pile of fallen stones and rubble, only a few pieces, low profile.
7. One plain short wooden footbridge deck, NO water and NO terrain underneath, open ends, two slim side rails, designed to link land on opposite ends.
8. A small stacked supply crate with rolled green canvas and a coil of rope, low profile.
Direction to honor: NORTH-facing. Fence and walls run left-to-right horizontally and their BACK faces point down toward the camera (we view their northern exterior from behind). Gate opens toward screen TOP, show the back of its lintel. Footbridge runs UP-DOWN, its main entry points toward TOP.
```

## east

```text
Use case: stylized-concept
Asset type: one production RGBA directional scenery sprite atlas for a small Chinese xianxia overworld game.
Input image: style reference only, existing props atlas. Match its painterly high detail, jade green and warm wood/gold, soft top-left lighting, readable small shapes.
Create a 1024x512 transparent canvas in EXACTLY 4 equal columns and 2 equal rows, eight isolated sprites, each sprite centered fully inside its own 256x256 cell with generous clear transparent margins, no labels, no separators, no text, no background, no ground tile, no floating perspective diamond.
All sprites seen from the same near-top-down elevated orthographic game camera: north is screen up, east screen right. Keep vertical posts upright in world space. Each straight segment fills its own tile width or length and can join end-to-end with another copy.
Cells left to right, top to bottom:
1. Rustic two-rail wood/bamboo camp fence segment, two posts.
2. Simple matching camp entrance gateway with two posts, small cloth lintel, clear open passage, no closed doors.
3. Low gray stone sect wall segment with dark green glazed cap, two end posts, much lower than the existing tall wall.
4. Broken section of ancient masonry wall, irregular stone ends, moss.
5. Short roofless ancient cylindrical broken stone pillar on small square foot.
6. Small loose pile of fallen stones and rubble, only a few pieces, low profile.
7. One plain short wooden footbridge deck, NO water and NO terrain underneath, open ends, two slim side rails, designed to link land on opposite ends.
8. A small stacked supply crate with rolled green canvas and a coil of rope, low profile.
Direction to honor: EAST-facing. Fence and walls run up-to-down VERTICALLY on the map, showing east side surfaces. Gate passage opens toward screen RIGHT. Footbridge runs LEFT-RIGHT, its main entry points toward RIGHT. Do NOT simply rotate the whole image: posts and the pillar stay upright, light comes top left.
```

## south

```text
Use case: stylized-concept
Asset type: one production RGBA directional scenery sprite atlas for a small Chinese xianxia overworld game.
Input image: style reference only, existing props atlas. Match its painterly high detail, jade green and warm wood/gold, soft top-left lighting, readable small shapes.
Create a 1024x512 transparent canvas in EXACTLY 4 equal columns and 2 equal rows, eight isolated sprites, each sprite centered fully inside its own 256x256 cell with generous clear transparent margins, no labels, no separators, no text, no background, no ground tile, no floating perspective diamond.
All sprites seen from the same near-top-down elevated orthographic game camera: north is screen up, east screen right. Keep vertical posts upright in world space. Each straight segment fills its own tile width or length and can join end-to-end with another copy.
Cells left to right, top to bottom:
1. Rustic two-rail wood/bamboo camp fence segment, two posts.
2. Simple matching camp entrance gateway with two posts, small cloth lintel, clear open passage, no closed doors.
3. Low gray stone sect wall segment with dark green glazed cap, two end posts, much lower than the existing tall wall.
4. Broken section of ancient masonry wall, irregular stone ends, moss.
5. Short roofless ancient cylindrical broken stone pillar on small square foot.
6. Small loose pile of fallen stones and rubble, only a few pieces, low profile.
7. One plain short wooden footbridge deck, NO water and NO terrain underneath, open ends, two slim side rails, designed to link land on opposite ends.
8. A small stacked supply crate with rolled green canvas and a coil of rope, low profile.
Direction to honor: SOUTH-facing. Fence and walls run left-to-right HORIZONTALLY on the map, showing their attractive front faces toward the camera. Gate passage opens toward screen BOTTOM. Footbridge runs UP-DOWN, its main entry points toward BOTTOM.
```

## west

```text
Use case: stylized-concept
Asset type: one production RGBA directional scenery sprite atlas for a small Chinese xianxia overworld game.
Input image: style reference only, existing props atlas. Match its painterly high detail, jade green and warm wood/gold, soft top-left lighting, readable small shapes.
Create a 1024x512 transparent canvas in EXACTLY 4 equal columns and 2 equal rows, eight isolated sprites, each sprite centered fully inside its own 256x256 cell with generous clear transparent margins, no labels, no separators, no text, no background, no ground tile, no floating perspective diamond.
All sprites seen from the same near-top-down elevated orthographic game camera: north is screen up, east screen right. Keep vertical posts upright in world space. Each straight segment fills its own tile width or length and can join end-to-end with another copy.
Cells left to right, top to bottom:
1. Rustic two-rail wood/bamboo camp fence segment, two posts.
2. Simple matching camp entrance gateway with two posts, small cloth lintel, clear open passage, no closed doors.
3. Low gray stone sect wall segment with dark green glazed cap, two end posts, much lower than the existing tall wall.
4. Broken section of ancient masonry wall, irregular stone ends, moss.
5. Short roofless ancient cylindrical broken stone pillar on small square foot.
6. Small loose pile of fallen stones and rubble, only a few pieces, low profile.
7. One plain short wooden footbridge deck, NO water and NO terrain underneath, open ends, two slim side rails, designed to link land on opposite ends.
8. A small stacked supply crate with rolled green canvas and a coil of rope, low profile.
Direction to honor: WEST-facing. Fence and walls run up-to-down VERTICALLY on the map, showing west side surfaces. Gate passage opens toward screen LEFT. Footbridge runs LEFT-RIGHT, its main entry points toward LEFT. Do NOT simply rotate the whole image: posts and the pillar stay upright, light comes top left.
```

## west 最終修訂

以 east 圖集為編輯輸入，維持 4 × 2 透明排列與八種物件。將柵欄、矮牆與斷牆的長軸維持畫面垂直，生成西側可見表面；橋面維持水平，入口朝西。保持立柱直立、左上光源與足夠透明邊界，禁止旋轉整張圖片，無文字、格線或地板。


## 周邊細節、竹林、散石與移動方向補充

使用內建 `image_gen`，`props-atlas`／`creatures-atlas` 作風格與物種參考，背景透明。正式網站只新增 `ambient-atlas.webp`、`boats-atlas.webp`、`creatures-north.webp`、`creatures-east.webp`、`creatures-west.webp`。十五棟建築沿用原始單張圖片，不增加建築方向版本。

- `ambient-atlas`：四欄五列，原圖列切線 `[0,300,540,830,1070,1402]`，縮為 512 × 640，WebP quality 78。
- `boats-atlas`：只取方向原圖第一列 `[0,320]`，四欄依序南、北、東、西，縮為 512 × 128，WebP quality 82。其餘列不載入遊戲。
- 三張妖獸方向圖集：五欄四列，縮為 640 × 512，WebP quality 64。北向列切線 `[0,295,551,822,1122]`；東向 `[0,300,563,821,1122]`；西向 `[0,292,555,816,1122]`。南向沿用原圖集。

來源檔名、SHA-256、下載大小及裁切座標見 `manifest.json`。圖集保留 128 像素單格，以透明留白置中後在遊戲內顯示 24～60 像素；所有方向均維持原本的接地位置。

### boats-atlas（只使用第一列）

```text
Use case: stylized-concept. Asset type: production sprite atlas for a small Chinese xianxia 2D overhead grid RPG. Match the reference's hand-painted anime miniature art, fine outlines, muted teal, ivory, aged timber, mossy stone and small antique gold details. Light stays at upper left in EVERY orientation. Transparent background, no text, labels, frames or visible grid. Full isolated silhouettes. Elevated camera about 55 degrees above the ground, world north points up the image, south down, east right and west left; never rotate the camera. Clear and readable when each sprite is only 40 to 76 pixels. EXACT FOUR columns and FOUR rows uniform equal square cells, portrait square sheet, generous transparent space so no part crosses cell boundaries. Each object centered, fills at most 72% of its cell. ROW ONE: same small wooden rowboat in SOUTH-facing, NORTH-facing, EAST-facing, WEST-facing views in that exact order. Bow must point in the named direction; actually draw the rear and side hull perspectives, not just rotate the sprite. ROW TWO: same teal-roof Chinese temple gate in SOUTH front view, NORTH rear view, EAST right-facing entrance view, WEST left-facing entrance view. ROW THREE: a short low grey stone wall segment leading from the center toward NORTH, then toward EAST, then SOUTH, then WEST; make these four directional wall arms with squared endpoints that can be joined to other arms at a shared stone post. ROW FOUR: a short low rustic brown wooden camp fence segment leading from center toward NORTH, EAST, SOUTH, WEST; four genuinely different perspective views with joinable rail ends. Small simple structures, not large scenery scenes.
```

### ambient-atlas

```text
Use case: stylized-concept. Asset type: production sprite atlas for a small Chinese xianxia 2D overhead grid RPG. Match the reference's hand-painted anime miniature art, fine outlines, muted teal, ivory, aged timber, mossy stone and small antique gold details. Light stays at upper left in EVERY orientation. Transparent background, no text, labels, frames or visible grid. Full isolated silhouettes. Elevated camera about 55 degrees above the ground, world north points up the image, south down, east right and west left; never rotate the camera. Clear and readable when each sprite is only 40 to 76 pixels. EXACT FOUR columns by FIVE rows, equal square cells, one separate miniature prop per cell, fully isolated with at least 12% transparent margins, no overlap. Row-major order: ROW1 a small scattered pale stone RUBBLE heap; a different dark BROKEN STONE BLOCK heap; a collapsed mossy WALL FRAGMENT; one small pile of SPLIT LOGS. ROW2 a small stack of wooden CRATES; two tied cloth SUPPLY SACKS; one tiny stone-ring CAMPFIRE; a simple small wooden WEAPON RACK holding two sheathed swords. ROW3 three thin graceful green BAMBOO stalks with a few leaves; a different taller airy BAMBOO clump with five stalks; a sparse bent BAMBOO SAPLING with leafy tip; a rounded small LIGHT GREY ROCK. ROW4 a flat DARK GREY ROCK with moss; two TINY GREY PEBBLES; a small wooden SCROLL RACK; a short pale jade STONE POST without canopy. ROW5 a compact cluster of purple STAR CRYSTALS; a small JADE OBELISK with abstract cyan engravings; a small warm-red HANGING BANNER on a slim pole; a small green POTTED BONSAI. Keep props modest in size and unexaggerated. No ground tile or landscape.
```

### creatures-north

```text
Use case: stylized-concept. Asset type: production sprite atlas for a small Chinese xianxia 2D overhead grid RPG. Match the reference's hand-painted anime miniature art, fine outlines, muted teal, ivory, aged timber, mossy stone and small antique gold details. Light stays at upper left in EVERY orientation. Transparent background, no text, labels, frames or visible grid. Full isolated silhouettes. Elevated camera about 55 degrees above the ground, world north points up the image, south down, east right and west left; never rotate the camera. Clear and readable when each sprite is only 40 to 76 pixels. Redraw the reference monster atlas as ONE EXACT FIVE-column FOUR-row sheet, same twenty creatures, same cell order and identities. Every creature now faces NORTH, away from the camera, backs and tails visible. Keep their colors, species, body proportions and armor recognizable. Actually draw this direction's anatomy and visible side, not a canvas rotation. Each creature full body centered in its cell with 12% clear margins. Row-major identities: row1 grey spirit wolf, armored boar, bamboo wolf, bamboo snake, mountain ape; row2 sentient vine, desert scorpion, desert lizard, stone-armored beast, rock golem; row3 fire fox beast, lava lizard, frost eagle, snow wolf, poison toad; row4 swamp snake, tidal crab, coast turtle, ancient spear sentinel, blue horned spirit cub. No labels, no borders and no overlap. Light from upper left.
```

### creatures-east

```text
Use case: stylized-concept. Asset type: production sprite atlas for a small Chinese xianxia 2D overhead grid RPG. Match the reference's hand-painted anime miniature art, fine outlines, muted teal, ivory, aged timber, mossy stone and small antique gold details. Light stays at upper left in EVERY orientation. Transparent background, no text, labels, frames or visible grid. Full isolated silhouettes. Elevated camera about 55 degrees above the ground, world north points up the image, south down, east right and west left; never rotate the camera. Clear and readable when each sprite is only 40 to 76 pixels. Redraw the reference monster atlas as ONE EXACT FIVE-column FOUR-row sheet, same twenty creatures, same cell order and identities. Every creature now faces EAST, toward the RIGHT of the image, side profiles visible. Keep their colors, species, body proportions and armor recognizable. Actually draw this direction's anatomy and visible side, not a canvas rotation. Each creature full body centered in its cell with 12% clear margins. Row-major identities: row1 grey spirit wolf, armored boar, bamboo wolf, bamboo snake, mountain ape; row2 sentient vine, desert scorpion, desert lizard, stone-armored beast, rock golem; row3 fire fox beast, lava lizard, frost eagle, snow wolf, poison toad; row4 swamp snake, tidal crab, coast turtle, ancient spear sentinel, blue horned spirit cub. No labels, no borders and no overlap. Light from upper left.
```

### creatures-west

```text
Use case: stylized-concept. Asset type: production sprite atlas for a small Chinese xianxia 2D overhead grid RPG. Match the reference's hand-painted anime miniature art, fine outlines, muted teal, ivory, aged timber, mossy stone and small antique gold details. Light stays at upper left in EVERY orientation. Transparent background, no text, labels, frames or visible grid. Full isolated silhouettes. Elevated camera about 55 degrees above the ground, world north points up the image, south down, east right and west left; never rotate the camera. Clear and readable when each sprite is only 40 to 76 pixels. Redraw the reference monster atlas as ONE EXACT FIVE-column FOUR-row sheet, same twenty creatures, same cell order and identities. Every creature now faces WEST, toward the LEFT of the image, side profiles visible. Keep their colors, species, body proportions and armor recognizable. Actually draw this direction's anatomy and visible side, not a canvas rotation. Each creature full body centered in its cell with 12% clear margins. Row-major identities: row1 grey spirit wolf, armored boar, bamboo wolf, bamboo snake, mountain ape; row2 sentient vine, desert scorpion, desert lizard, stone-armored beast, rock golem; row3 fire fox beast, lava lizard, frost eagle, snow wolf, poison toad; row4 swamp snake, tidal crab, coast turtle, ancient spear sentinel, blue horned spirit cub. No labels, no borders and no overlap. Light from upper left.
```
