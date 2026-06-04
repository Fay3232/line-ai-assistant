import { config } from "./config.js";

export function missingAiKeyReply() {
  if (config.aiProvider === "openai") {
    return "目前 AI 已設定為 OpenAI，但 Render 還缺 OPENAI_API_KEY，或該 key 沒有可用額度。請到 Render Environment 設定後重新部署。";
  }

  return "目前 AI 已設定為 Gemini，但 Render 還缺 GEMINI_API_KEY。請到 Google AI Studio 建立免費 API key，填到 Render Environment 後重新部署。";
}

export function heuristicReply({ text, location }) {
  const message = String(text || "").trim();
  if (!message && location) {
    return "收到你的位置了。你可以問我「附近美食」、「附近咖啡」或「附近晚餐推薦」。";
  }

  if (config.aiProvider === "gemini" && !config.gemini.apiKey) {
    return missingAiKeyReply();
  }

  if (config.aiProvider === "openai" && !config.openai.apiKey) {
    return missingAiKeyReply();
  }

  if (/天氣|下雨|氣溫|颱風/.test(message)) {
    return "天氣查詢需要 CWA_API_KEY。請確認 Render Environment 已設定 CWA_API_KEY，並且填完後有重新部署。";
  }

  if (/美食|餐廳|吃什麼|咖啡|拉麵|牛肉麵/.test(message)) {
    return location
      ? "美食查詢需要 GOOGLE_PLACES_API_KEY。Google Places 可能需要啟用 Google Cloud billing。"
      : "可以，請先分享 LINE 位置或輸入城市/區域，例如「台北車站拉麵」。";
  }

  if (/\b[A-Z]{1,5}\b|[0-9]{4}|股票|股價|台股|美股/.test(message.toUpperCase())) {
    return "股票查詢已準備好；台股使用 TWSE OpenAPI，美股需要 FINNHUB_API_KEY。資訊只供查詢，不構成投資建議。";
  }

  return "LINE AI 助理已啟動。你可以問我天氣、美食或股票，例如：「台北明天會下雨嗎？」、「附近牛肉麵」、「2330 股價」。";
}
