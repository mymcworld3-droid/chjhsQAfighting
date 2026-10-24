# 問道宗大型園林

45 × 45 格宗門，面積為原 19 × 19 格的約 5.6 倍。出生點與原有八個功能／NPC 入口維持原位置及 ID。

- 北側新增跨九格寬的金飾主殿，青瓦、金龍屋脊與白玉台階承接原有美術。
- 兩翼為曲折溪流、蓮池、假山瀑布、玉蘭與涼亭；六座玉橋連接庭園和四向主路。
- 中央與南側配置大型玉石紋章；迎賓大道配置成對石獅、香爐、燈柱及旌旗。
- 溪流阻擋步行、橋梁可走，主殿／假山／涼亭的底座與外牆共用權威碰撞，四座城門保持可達；既有存檔落在新增障礙內時會由原有 `safePosition` 選取鄰近安全格。
- 大圖以實際外框判定可見性，屋頂及樹冠跨越視窗邊緣也不會突然消失；前景遮住主角時只淡出該物件。
- 地坪與玉橋在人物之前繪製，其他物件與角色共用腳點排序。新增圖像沒有光暈動畫、鏡頭位移或逐格網路請求。

`overview.webp`、`main-hall.webp`、`water-garden.webp`、`phone.webp` 使用正式 `WorldRenderer` 經原生 Canvas 繪製。此環境未安裝瀏覽器執行檔，圖片未模擬登入或完整頁面 UI；原生執行環境缺中文字型，截圖隱去名稱標籤。`phone.webp` 驗證 390 × 740 CSS px、DPR 2。量測詳見 `validation.json`，為此機器的原生 Canvas 耗時，不代表實機瀏覽器 FPS。

為避免整座園林縮小時反覆淘汰地面，拓樸快取鍵僅含實際參與繪製的鄰格；52px 以下小型地坪快取最多 1024 張，52px 時約 11 MB，較大的地坪仍維持 512 張。重繪驗證確認相同時間／位置的輸出位元組一致，既有地面翻轉、竹林密度與種子規則仍保留。

重現驗證：

```sh
node --test tests/world-*.test.cjs
node scripts/capture-world-sect.cjs
npm run build:module-versions
npm run check:module-versions
```

生產素材和實際生成提示詞在 `public/assets/world-map/ai/sect-prompts.md`；來源尺寸／雜湊和下載大小記錄於同目錄的 `manifest.json`。
