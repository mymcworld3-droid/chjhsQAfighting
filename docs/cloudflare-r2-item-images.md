# Cloudflare R2：法寶 / 素材圖片儲存設定

本專案的 AI 圖片流程使用：

1. Cloudflare Workers AI / FLUX Schnell 產生 JPG。
2. Render 後端以 Cloudflare R2 的 S3 相容 API 上傳圖片。
3. Firestore 只保存 `imageUrl` 與圖片狀態，不再依賴 Firebase Storage。

## 1. 建立 R2 bucket

Cloudflare Dashboard → **Storage & databases → R2 Object Storage → Create bucket**。

建議：

- Bucket name: `xiuxian-item-images`
- Storage class: **Standard**

## 2. 開啟圖片公開讀取

進入剛建立的 bucket → **Settings**。

開發階段可以先啟用 **Public Development URL**，取得類似：

```
https://pub-xxxxxxxxxxxxxxxx.r2.dev
```

正式上線建議改接自己的 Cloudflare custom domain。

把這個網址記下來；Render 需要它作為 `R2_PUBLIC_BASE_URL`。

## 3. 建立 R2 S3 API 金鑰

Cloudflare Dashboard → R2 → **Manage R2 API Tokens** → 建立 token。

權限請選：

- **Object Read & Write**
- 只套用到 `xiuxian-item-images` bucket

建立後保存：

- Access Key ID
- Secret Access Key

注意：這組 S3 金鑰和目前 Workers AI 使用的 `CLOUDFLARE_API_TOKEN` 不同。

## 4. Render Environment Variables

Render 的服務新增：

```
R2_ACCESS_KEY_ID=<R2 Access Key ID>
R2_SECRET_ACCESS_KEY=<R2 Secret Access Key>
R2_BUCKET_NAME=xiuxian-item-images
R2_PUBLIC_BASE_URL=https://pub-xxxxxxxxxxxxxxxx.r2.dev
```

Account ID 預設會沿用既有：

```
CLOUDFLARE_ACCOUNT_ID
```

如果 R2 與 Workers AI 使用不同 Cloudflare account，另外設定：

```
R2_ACCOUNT_ID=<R2 所在 Cloudflare Account ID>
```

## 5. 重新部署與測試

Render 重新部署後，以管理員登入遊戲並按「補圖」。

成功後物件會出現在 R2：

```
generated-items/
  artifacts/
  materials/
```

Firestore 的法寶 / 素材資料則會保存公開的 `imageUrl`。

## 常見錯誤

- `Render 尚缺少 Cloudflare R2 設定`：Render 缺少上方必要環境變數。
- `Cloudflare R2 上傳失敗 (403)`：通常是 R2 Access Key / Secret 錯誤、token 沒有 Object Read & Write，或 token 沒有套用到正確 bucket。
- `Cloudflare R2 上傳失敗 (404)`：通常是 `R2_BUCKET_NAME` 不正確。
- 圖片已上傳但瀏覽器看不到：確認 Public Development URL 或 custom domain 已啟用，而且 `R2_PUBLIC_BASE_URL` 填的是該公開網址，不是 S3 API endpoint。

請勿把 R2 Secret Access Key 提交到 GitHub。
