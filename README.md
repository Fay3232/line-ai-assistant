# LINE AI Assistant

這是一個最小可部署的 LINE AI 機器人範本，使用 LINE Messaging API webhook 接收訊息，透過 OpenAI Responses API 的 tool calling 判斷並呼叫外部資料源，支援：

- 台灣天氣查詢：中央氣象署 Open Data
- 美食推薦：Google Places API
- 股票查詢：台股 TWSE OpenAPI、美股 Finnhub

> 股票資訊僅供查詢與摘要，不構成投資建議。

## 1. 準備帳號與 API Key

1. 建立或使用既有 LINE Official Account。
2. 到 LINE Developers 啟用 Messaging API，取得：
   - `LINE_CHANNEL_SECRET`
   - `LINE_CHANNEL_ACCESS_TOKEN`
3. 建立 OpenAI API key，填入 `OPENAI_API_KEY`。
4. 依功能填入資料源 key：
   - 天氣：`CWA_API_KEY`
   - 美食：`GOOGLE_PLACES_API_KEY`
   - 美股：`FINNHUB_API_KEY`

## 2. 本機設定

複製環境變數範例：

```powershell
Copy-Item .env.example .env
```

編輯 `.env`，至少先設定：

```env
ENABLE_SIMULATE_ROUTE=true
OPENAI_API_KEY=你的_OpenAI_Key
CWA_API_KEY=你的_中央氣象署_Key
GOOGLE_PLACES_API_KEY=你的_Google_Places_Key
FINNHUB_API_KEY=你的_Finnhub_Key
```

啟動本機服務：

```powershell
npm run dev
```

健康檢查：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/health
```

在尚未接 LINE 前，可用模擬路由測試：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/simulate `
  -ContentType 'application/json' `
  -Body '{"text":"台北明天會下雨嗎？"}'
```

## 3. LINE Webhook 設定

部署到支援 Node.js 的平台後，把 LINE Developers Console 的 webhook URL 設成：

```text
https://你的網域/webhook/line
```

正式環境請確認：

```env
ALLOW_UNSIGNED_WEBHOOKS=false
ENABLE_SIMULATE_ROUTE=false
LINE_CHANNEL_SECRET=你的_LINE_Channel_Secret
LINE_CHANNEL_ACCESS_TOKEN=你的_LINE_Channel_Access_Token
```

如果 webhook 只跑在本機，電腦關機後 AI 查詢就不會執行；LINE 官方帳號仍存在，但只剩後台固定回覆、歡迎訊息、Rich Menu 等不依賴 webhook 的功能。正式使用請部署到雲端 HTTPS 服務，例如 Render、Railway、Cloud Run 或 Vercel。

### 用 ngrok 做本機 LINE 測試

如果 PowerShell 顯示 `ngrok` 無法辨識，代表 Windows 尚未安裝 ngrok，或安裝後尚未重新開啟終端機。

安裝 ngrok：

```powershell
winget install -e --id Ngrok.Ngrok
```

安裝完成後，關掉 PowerShell 再重新打開，確認可執行：

```powershell
ngrok version
```

第一次使用需要到 ngrok 註冊並複製 authtoken，然後執行：

```powershell
ngrok config add-authtoken "你的_ngrok_authtoken"
```

確認本機 server 已在 `http://localhost:3000` 執行後，開另一個 PowerShell：

```powershell
ngrok http 3000
```

把 ngrok 顯示的 `https://...ngrok-free.app` 網址加上 `/webhook/line`，填到 LINE Developers Console：

```text
https://你的-ngrok網址.ngrok-free.app/webhook/line
```

## 4. 常用測試句

- `台北明天會下雨嗎？`
- `附近牛肉麵`
- `台北車站拉麵`
- `2330 股價`
- `AAPL 股價`

## 5. 驗證

```powershell
npm run check
npm test
```

## 6. 下一步

- 加入資料庫保存使用者最近一次位置，讓「附近美食」不用每次重新分享位置。
- 加入 Rich Menu：天氣、美食、股票、分享位置。
- 加入背景佇列，避免較慢的 API 查詢影響 LINE webhook 回應時間。
- 加入部署設定，例如 Render、Railway、Cloud Run 或 Vercel serverless adapter。
