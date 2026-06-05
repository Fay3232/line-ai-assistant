# LINE AI Assistant

LINE 官方帳號 AI 機器人範本。Render 上的 Node.js webhook 接收 LINE Messaging API 事件，全部先交給 Gemini 判斷與回覆；當 Gemini 判斷需要即時資料時，再呼叫天氣、美食或股票工具。

目前支援：

- Gemini 一般問答：聊天、文案、翻譯、摘要、規劃、知識問答
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

編輯 `.env`，Gemini 模式至少需要：

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
$body = @{ text = "幫我寫一段咖啡店開幕文案" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/simulate" -ContentType "application/json; charset=utf-8" -Body $body
```

## 2. Render Environment

`.env` 不要上傳 GitHub。正式部署請到 Render：

```text
line-ai-assistant → Environment → Add Environment Variable
```

必要設定：

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=你的_Gemini_API_Key
GEMINI_MODEL=gemini-2.5-flash-lite
LINE_CHANNEL_SECRET=你的_LINE_Channel_Secret
LINE_CHANNEL_ACCESS_TOKEN=你的_LINE_Channel_Access_Token
ALLOW_UNSIGNED_WEBHOOKS=false
ENABLE_SIMULATE_ROUTE=false
```

即時資料功能可再補：

```text
CWA_API_KEY=你的_中央氣象署_API_Key
GOOGLE_PLACES_API_KEY=你的_Google_Places_Key
FINNHUB_API_KEY=你的_Finnhub_Key
```

填完 Render Environment 後一定要重新部署：

```text
Manual Deploy → Deploy latest commit
```

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

## 5. 常用測試句

```text
你可以做什麼？
幫我寫一段咖啡店開幕文案
幫我翻譯這句話成英文：今天很適合喝咖啡
幫我查明天台北市的天氣
西湖市場推薦美食有哪些
2330 股價
AAPL 股價
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

- 所有問題都會先交給 Gemini，因此 Gemini 免費額度比較容易遇到 429；等約 1 分鐘通常會恢復。
- Google Places 通常需要 Google Cloud billing，且要啟用 Places API (New)。
- `.env.example` 只能放 placeholder，不要放真實 API key。
