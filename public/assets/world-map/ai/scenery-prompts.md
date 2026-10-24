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
