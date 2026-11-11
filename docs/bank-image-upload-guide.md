# 題庫圖片上傳說明（文字 JSON 版）

此版本取代先前的整題截圖包。題幹、選項、共用閱讀原文與文字表格儲存在 JSON；數學式保留 LaTeX。只將實際插圖、圖表、地圖、古文字字形和圖像選項另外存成 PNG。

共有 **66 份題庫、2,591 題**。其中 1,577 題可直接練習；1,014 題在所需圖片上傳後開放。圖片包共 1,475 張，重複引用的共用圖片只需放一次。

## 放置方式

1. 使用新版 `bank-images-for-upload.zip`，解壓後把其中的 `public/assets/banks/` 合併到專案同一路徑。
2. 保留所有子資料夾、檔名、大小寫及 `.png` 副檔名。
3. 推送圖片並部署後，題庫會自動開放已有完整圖片的題目，不必再修改 JSON。
4. 舊版 `Q題號-question.png` 與 `G起題-迄題-context.png` 已不再使用，請依新版清單上傳。

缺少圖片時，題庫名稱仍會出現在「使用題庫」列表，相關題目會等待補圖，避免出現沒有圖的題目。

| 新檔名 | 對應內容 |
|---|---|
| `Q2-figure-1.png` | 第2題的第1張插圖／圖表 |
| `Q2-option-A-figure-1.png` | 第2題原卷選項A中的圖片 |
| `G28-30-figure-1.png` | 第28至30題共用閱讀資料中的圖片 |

圖片均已按路徑整理好。完整逐圖對照在 `bank-image-upload-list.csv`，包含來源試卷、原卷題號、所在位置、PDF頁碼及目的路徑。PDF頁從檔案第一頁起算（包含封面）；直接擷取的圖片另列出裁切座標，單位為PDF點，順序是左、上、右、下。由原始Word內嵌圖取得的圖片，頁碼為對應題目的起始頁。

## 題庫總表

| 題庫 | 題數 | 可直接練習 | 待補圖題數 | 圖片資料夾 |
|---|---:|---:|---:|---|
| 109年會考 國文 | 48 | 36 | 12 | `public/assets/banks/cap-109-chinese/` |
| 110年會考 國文 | 48 | 38 | 10 | `public/assets/banks/cap-110-chinese/` |
| 111年會考 國文 | 42 | 30 | 12 | `public/assets/banks/cap-111-chinese/` |
| 112年會考 國文 | 42 | 30 | 12 | `public/assets/banks/cap-112-chinese/` |
| 113年會考 國文 | 42 | 32 | 10 | `public/assets/banks/cap-113-chinese/` |
| 114年會考 國文 | 42 | 32 | 10 | `public/assets/banks/cap-114-chinese/` |
| 109年會考 數學 | 26 | 11 | 15 | `public/assets/banks/cap-109-math/` |
| 110年會考 數學 | 26 | 13 | 13 | `public/assets/banks/cap-110-math/` |
| 111年會考 數學 | 25 | 12 | 13 | `public/assets/banks/cap-111-math/` |
| 112年會考 數學 | 25 | 8 | 17 | `public/assets/banks/cap-112-math/` |
| 113年會考 數學 | 25 | 13 | 12 | `public/assets/banks/cap-113-math/` |
| 114年會考 數學 | 25 | 9 | 16 | `public/assets/banks/cap-114-math/` |
| 109年會考 社會 | 63 | 35 | 28 | `public/assets/banks/cap-109-social/` |
| 110年會考 社會 | 63 | 34 | 29 | `public/assets/banks/cap-110-social/` |
| 111年會考 社會 | 54 | 25 | 29 | `public/assets/banks/cap-111-social/` |
| 112年會考 社會 | 54 | 37 | 17 | `public/assets/banks/cap-112-social/` |
| 113年會考 社會 | 54 | 25 | 29 | `public/assets/banks/cap-113-social/` |
| 114年會考 社會 | 54 | 16 | 38 | `public/assets/banks/cap-114-social/` |
| 109年會考 自然 | 54 | 14 | 40 | `public/assets/banks/cap-109-science/` |
| 110年會考 自然 | 54 | 21 | 33 | `public/assets/banks/cap-110-science/` |
| 111年會考 自然 | 50 | 17 | 33 | `public/assets/banks/cap-111-science/` |
| 112年會考 自然 | 50 | 8 | 42 | `public/assets/banks/cap-112-science/` |
| 113年會考 自然 | 50 | 11 | 39 | `public/assets/banks/cap-113-science/` |
| 114年會考 自然 | 50 | 6 | 44 | `public/assets/banks/cap-114-science/` |
| 109年會考 英語閱讀 | 41 | 24 | 17 | `public/assets/banks/cap-109-english/` |
| 110年會考 英語閱讀 | 41 | 23 | 18 | `public/assets/banks/cap-110-english/` |
| 111年會考 英語閱讀 | 43 | 25 | 18 | `public/assets/banks/cap-111-english/` |
| 112年會考 英語閱讀 | 43 | 28 | 15 | `public/assets/banks/cap-112-english/` |
| 113年會考 英語閱讀 | 43 | 27 | 16 | `public/assets/banks/cap-113-english/` |
| 114年會考 英語閱讀 | 43 | 24 | 19 | `public/assets/banks/cap-114-english/` |
| 111年學測 國文 | 27 | 12 | 15 | `public/assets/banks/gsat-111-chinese/` |
| 112年學測 國文 | 27 | 17 | 10 | `public/assets/banks/gsat-112-chinese/` |
| 108年學測 國文 | 34 | 28 | 6 | `public/assets/banks/gsat-108-chinese/` |
| 109年學測 國文 | 34 | 23 | 11 | `public/assets/banks/gsat-109-chinese/` |
| 113年學測 國文 | 26 | 12 | 14 | `public/assets/banks/gsat-113-chinese/` |
| 114年學測 國文 | 26 | 6 | 20 | `public/assets/banks/gsat-114-chinese/` |
| 110年學測 國文 | 34 | 24 | 10 | `public/assets/banks/gsat-110-chinese/` |
| 111年學測 數學A | 7 | 5 | 2 | `public/assets/banks/gsat-111-math-a/` |
| 112年學測 數學A | 7 | 4 | 3 | `public/assets/banks/gsat-112-math-a/` |
| 113年學測 數學A | 8 | 5 | 3 | `public/assets/banks/gsat-113-math-a/` |
| 114年學測 數學A | 7 | 4 | 3 | `public/assets/banks/gsat-114-math-a/` |
| 111年學測 數學B | 9 | 6 | 3 | `public/assets/banks/gsat-111-math-b/` |
| 112年學測 數學B | 7 | 5 | 2 | `public/assets/banks/gsat-112-math-b/` |
| 113年學測 數學B | 8 | 5 | 3 | `public/assets/banks/gsat-113-math-b/` |
| 114年學測 數學B | 8 | 7 | 1 | `public/assets/banks/gsat-114-math-b/` |
| 108年學測 社會 | 72 | 54 | 18 | `public/assets/banks/gsat-108-social/` |
| 109年學測 社會 | 69 | 40 | 29 | `public/assets/banks/gsat-109-social/` |
| 111年學測 社會 | 57 | 39 | 18 | `public/assets/banks/gsat-111-social/` |
| 112年學測 社會 | 56 | 37 | 19 | `public/assets/banks/gsat-112-social/` |
| 113年學測 社會 | 54 | 43 | 11 | `public/assets/banks/gsat-113-social/` |
| 114年學測 社會 | 54 | 41 | 13 | `public/assets/banks/gsat-114-social/` |
| 110年學測 社會 | 72 | 57 | 15 | `public/assets/banks/gsat-110-social/` |
| 108年學測 自然 | 40 | 21 | 19 | `public/assets/banks/gsat-108-science/` |
| 109年學測 自然 | 42 | 22 | 20 | `public/assets/banks/gsat-109-science/` |
| 111年學測 自然 | 23 | 9 | 14 | `public/assets/banks/gsat-111-science/` |
| 112年學測 自然 | 31 | 19 | 12 | `public/assets/banks/gsat-112-science/` |
| 113年學測 自然 | 22 | 10 | 12 | `public/assets/banks/gsat-113-science/` |
| 110年學測 自然 | 37 | 25 | 12 | `public/assets/banks/gsat-110-science/` |
| 114年學測 自然 | 21 | 13 | 8 | `public/assets/banks/gsat-114-science/` |
| 108年學測 英文 | 56 | 52 | 4 | `public/assets/banks/gsat-108-english/` |
| 109年學測 英文 | 56 | 51 | 5 | `public/assets/banks/gsat-109-english/` |
| 111年學測 英文 | 46 | 42 | 4 | `public/assets/banks/gsat-111-english/` |
| 112年學測 英文 | 46 | 42 | 4 | `public/assets/banks/gsat-112-english/` |
| 113年學測 英文 | 46 | 42 | 4 | `public/assets/banks/gsat-113-english/` |
| 114年學測 英文 | 46 | 42 | 4 | `public/assets/banks/gsat-114-english/` |
| 110年學測 英文 | 56 | 49 | 7 | `public/assets/banks/gsat-110-english/` |

## JSON與來源處理

- 每個來源題號保留固定 `id`，依考試及原卷題號去重。
- `q` 是題幹／共用閱讀資料，`correct` 是正確選項，`wrong` 是其餘選項；圖片直接放在實際所在的欄位。
- `requiredImages` 列出題幹及所有選項需要的圖片，缺任何一張就先不抽出該題。
- `source.answer` 保留原卷答案代號供查核。學測數學另核對官方答案表的主題號欄，排除填充題的分格答案，補回原先漏列的單選題。
- 多選題、填充題、非選擇題及官方取消的題目仍列在匯入紀錄的排除清單，未偽造選項。
- 會考依官方通過率設定難度；學測未取得逐題通過率者標示中等。
- 來源與排除紀錄：`data/bank-import/catalog.json`；逐圖位置、尺寸及檔案雜湊：`data/bank-import/images.json`。
