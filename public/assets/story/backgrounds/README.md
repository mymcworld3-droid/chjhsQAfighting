# 主線背景圖

將背景 PNG 放進此目錄。檔名使用 `public/cultivation/story/story-backgrounds.js` 的 `filename`，共 24 張，16:9、不透明背景，建議 1920×1080 或更高解析度。人物立繪與對話由播放器疊加，素材只畫場景。

`story-scripts.js` 中每章的 `backgrounds` 以從 0 起算的 `fromLine` 指定切換位置；回到教學後會依目前台詞恢復背景。劇情開啟前先載入第一張，閱讀時預載下一個場景。相同場景翻台詞會保留圖片節點，換景時以透明度交疊淡入，不拉伸圖片。

素材尚未放入或載入失敗時，使用目錄中的既有開場圖片 `fallback`；兩者皆失敗則保留上一張圖或顯示底色，不顯示破圖。載入設有逾時，不阻塞觀看與任務完成。

加入圖片後執行 `npm run build:module-versions` 並重新部署，再重新整理遊戲。瀏覽器同一次開啟會快取載入結果。

讀取 `window.getXiuxianStoryBackgrounds()` 可取得檔名、場景說明、路徑與備援。背景顯示不改變章節解鎖、手動觀看、教學交棒及任務獎勵規則。
