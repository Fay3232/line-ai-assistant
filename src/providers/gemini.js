import { config } from "../config.js";
import { runTool } from "../tools.js";

const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const systemInstruction = `
You are a Traditional Chinese LINE assistant for users in Taiwan.
You can answer general questions and route requests to tools for Taiwan weather, food, Taiwan stocks, and US stocks.
Keep replies short, clear, and mobile-friendly.
Stock information is for lookup only and is not investment advice.
`.trim();

const intentSchema = {
  type: "object",
  properties: {
    toolName: {
      type: "string",
      enum: ["none", "get_weather", "search_food", "get_stock_quote"],
      description: "Tool to call. Use none when no tool is needed."
    },
    args: {
      type: "object",
      properties: {
        city: { type: "string" },
        query: { type: "string" },
        market: { type: "string", enum: ["TW", "US"] },
        symbol: { type: "string" },
        latitude: { type: "number" },
        longitude: { type: "number" },
        openNow: { type: "boolean" }
      }
    },
    reply: {
      type: "string",
      description: "Traditional Chinese direct reply when toolName is none; otherwise an empty string."
    }
  },
  required: ["toolName", "args", "reply"],
  propertyOrdering: ["toolName", "args", "reply"]
};

export async function answerWithGemini({ text, location }) {
  const userPrompt = buildUserPrompt({ text, location });
  const intent = await detectIntent(userPrompt);

  if (intent.toolName === "none") {
    return intent.reply || await generateText({
      prompt: userPrompt,
      system: systemInstruction
    });
  }

  const toolResult = await runTool(intent.toolName, sanitizeToolArgs(intent), { location });
  return formatToolResult(intent.toolName, toolResult);
}

async function detectIntent(userPrompt) {
  const prompt = `
Classify this LINE message and return JSON only.

Rules:
- Weather/rain/temperature/typhoon: toolName=get_weather, args.city should be a Taiwan city/county.
- Food/restaurants/cafes/ramen/what to eat/market food: toolName=search_food, args.query should keep the full search term, for example "西湖市場美食".
- Stocks/stock price/Taiwan stocks/US stocks/2330/AAPL-like symbols: toolName=get_stock_quote. Use market=TW for numeric Taiwan symbols, market=US for US tickers.
- General chat or "what can you do": toolName=none and reply in Traditional Chinese.

User message:
${userPrompt}
`.trim();

  const text = await generateText({
    prompt,
    system: systemInstruction,
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: intentSchema
    }
  });

  const parsed = parseJson(text);
  return {
    toolName: normalizeToolName(parsed.toolName),
    args: parsed.args && typeof parsed.args === "object" ? parsed.args : {},
    reply: typeof parsed.reply === "string" ? parsed.reply.trim() : ""
  };
}

async function generateText({ prompt, system, generationConfig = {} }) {
  const url = new URL(`${GEMINI_ENDPOINT_BASE}/${config.gemini.model}:generateContent`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.gemini.apiKey
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: system }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 800,
        ...generationConfig
      }
    })
  });

  const payload = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status} ${payload}`);
  }

  const data = payload ? JSON.parse(payload) : {};
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.map((part) => part.text || "").join("").trim();
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }
  return text;
}

function formatToolResult(toolName, result) {
  if (result?.needsConfiguration) {
    return `此功能還缺 Render Environment 變數：${result.needsConfiguration}\n設定後請重新部署 Render。`;
  }

  if (result?.providerError) {
    return `我已連到 AI，但 ${result.source} 資料源發生問題：\n${result.message}`;
  }

  if (toolName === "get_weather") return formatWeather(result);
  if (toolName === "search_food") return formatFood(result);
  if (toolName === "get_stock_quote") return formatStock(result);
  return result?.message || "查詢完成，但我暫時無法整理結果。";
}

function formatWeather(result) {
  if (!result?.ok) {
    return result?.message || "查不到這個地區的天氣資訊，請換成縣市名稱再試一次。";
  }

  const rows = [];
  for (const element of result.forecast || []) {
    const first = element.periods?.[0];
    if (!first) continue;
    rows.push(`${weatherElementLabel(element.name)}：${first.value}${first.unit || ""}`);
  }

  return [
    `${result.city} 天氣：`,
    ...rows.slice(0, 5),
    `來源：${result.source}`
  ].filter(Boolean).join("\n");
}

function formatFood(result) {
  if (!result?.ok) {
    return result?.message || "找不到符合條件的餐廳。";
  }

  const lines = (result.places || []).slice(0, 5).map((place, index) => {
    const rating = place.rating ? `，評分 ${place.rating}` : "";
    const address = place.address ? `\n${place.address}` : "";
    const map = place.mapsUrl ? `\n${place.mapsUrl}` : "";
    return `${index + 1}. ${place.name}${rating}${address}${map}`;
  });

  return [
    "找到幾個美食選項：",
    ...lines
  ].join("\n\n");
}

function formatStock(result) {
  if (!result?.ok) {
    return result?.message || "查不到這個股票代號。";
  }

  if (result.market === "TW") {
    return [
      `${result.symbol} ${result.name || ""}`.trim(),
      `收盤價：${result.price}`,
      `漲跌：${result.change}`,
      result.note
    ].filter(Boolean).join("\n");
  }

  return [
    `${result.symbol} 美股報價`,
    `目前：${result.currentPrice}`,
    `漲跌：${result.change} (${result.percentChange}%)`,
    result.note
  ].filter(Boolean).join("\n");
}

function weatherElementLabel(name) {
  const labels = {
    Wx: "天氣",
    PoP: "降雨機率",
    MinT: "最低溫",
    MaxT: "最高溫",
    CI: "體感"
  };
  return labels[name] || name;
}

function buildUserPrompt({ text, location }) {
  const parts = [String(text || "").trim()];
  if (location) {
    parts.push(`LINE 位置：${JSON.stringify(location)}`);
  }
  return parts.filter(Boolean).join("\n");
}

function sanitizeToolArgs(intent) {
  const args = intent.args || {};
  if (intent.toolName === "get_weather") {
    return { city: String(args.city || "").trim() || "臺北市" };
  }
  if (intent.toolName === "search_food") {
    return {
      query: String(args.query || "餐廳").trim(),
      city: typeof args.city === "string" ? args.city.trim() : undefined,
      latitude: numberOrUndefined(args.latitude),
      longitude: numberOrUndefined(args.longitude),
      openNow: Boolean(args.openNow)
    };
  }
  if (intent.toolName === "get_stock_quote") {
    const symbol = String(args.symbol || "").trim().toUpperCase();
    return {
      market: args.market === "US" ? "US" : inferMarket(symbol),
      symbol
    };
  }
  return {};
}

function normalizeToolName(toolName) {
  const allowed = new Set(["none", "get_weather", "search_food", "get_stock_quote"]);
  return allowed.has(toolName) ? toolName : "none";
}

function inferMarket(symbol) {
  return /^[0-9]{4,6}$/.test(symbol) ? "TW" : "US";
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  }
}

function numberOrUndefined(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
