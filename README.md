# LINE AI Assistant

LINE 官方帳號 AI 機器人範本。Render 上的 Node.js webhook 接收 LINE Messaging API 事件，透過 AI provider 判斷使用者需求，再呼叫天氣、美食或股票工具回覆。

目前支援：

- AI provider：Gemini Free Tier，或 OpenAI Responses API
- 天氣：中央氣象署 Open Data
- 台股：TWSE OpenAPI
- 美股：Finnhub
- 美食：Google Places

> 股票資訊僅供查詢與摘要，不構成投資建議。

## 1. 本機啟動

複製環境變數範例：

```powershell
Copy-Item .env.example .env
```

編輯 `.env`，測試 Gemini 免費方案至少需要：

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=你的_Gemini_API_Key
GEMINI_MODEL=gemini-2.5-flash-lite
ENABLE_SIMULATE_ROUTE=true
```

啟動：

```powershell
npm.cmd run dev
```

如果 PowerShell 擋住 npm，改用：

```powershell
node --env-file=.env src/server.js
```

健康檢查：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/health
```

模擬 LINE 訊息：

```powershell
$body = @{ text = "幫我查明天台北市的天氣" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/simulate" -ContentType "application/json; charset=utf-8" -Body $body
```

## 2. Render Environment

`.env` 不要上傳 GitHub。正式部署請到 Render：

```text
line-ai-assistant → Environment → Add Environment Variable
```

Gemini 免費方案需要：

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=你的_Gemini_API_Key
GEMINI_MODEL=gemini-2.5-flash-lite
LINE_CHANNEL_SECRET=你的_LINE_Channel_Secret
LINE_CHANNEL_ACCESS_TOKEN=你的_LINE_Channel_Access_Token
ALLOW_UNSIGNED_WEBHOOKS=false
ENABLE_SIMULATE_ROUTE=false
```

天氣功能需要：

```text
CWA_API_KEY=你的_中央氣象署_API_Key
```

其他功能可再補：

```text
GOOGLE_PLACES_API_KEY=你的_Google_Places_Key
FINNHUB_API_KEY=你的_Finnhub_Key
```

填完 Render Environment 後一定要重新部署：

```text
Manual Deploy → Deploy latest commit
```

如果改了 key 但沒有重新部署，正在跑的 Render container 仍會讀到舊環境變數。

## 3. Render Build 設定

Render Web Service 設定：

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
Root Directory: package.json 所在資料夾
```

Render 會自動提供 `PORT`，不用手動設定。

部署成功後測：

```text
https://你的-render網址.onrender.com/health
```

預期：

```json
{"ok":true}
```

## 4. LINE Webhook

到 LINE Developers Console：

```text
Provider → Messaging API Channel → Messaging API
```

Webhook URL 設為：

```text
https://你的-render網址.onrender.com/webhook/line
```

並開啟：

```text
Use webhook
```

到 LINE Official Account Manager 的回應設定，建議關閉會搶回覆的固定訊息：

```text
回應訊息：關閉
AI 自動回應訊息：關閉
Webhook：開啟
```

歡迎訊息可以保留。

## 5. 常用測試句

```text
幫我查明天台北市的天氣
2330 股價
AAPL 股價
你可以做什麼？
附近牛肉麵
```

## 6. 驗證

```powershell
npm.cmd run check
npm.cmd test
```

或不用 npm：

```powershell
node --check src/server.js
node --test
```

## 7. 注意事項

- Render Free 方案閒置會休眠，第一則 LINE 訊息可能延遲或 timeout。
- Gemini Free Tier 可用量與模型支援會依 Google 規則調整；免費層資料可能被用於改善產品。
- Google Places 通常需要 Google Cloud billing；初期可先測天氣與股票。
- `.env.example` 只能放 placeholder，不要放真實 API key。
