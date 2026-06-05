import { config } from "../config.js";
import { runTool } from "../tools.js";

const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const systemInstruction = `
You are a Traditional Chinese LINE assistant for users in Taiwan.
You can answer general questions directly.
For current Taiwan weather and food/restaurant recommendations, choose the appropriate tool first, then summarize the tool result.
For stock questions, answer with Gemini plus Google Search grounding. Do not use model memory for current prices.
Keep replies short, clear, and mobile-friendly.
Do not fabricate current weather or restaurant details when a tool result is unavailable.
Stock information is for reference only and is not investment advice.
`.trim();

const intentSchema = {
  type: "object",
  properties: {
    toolName: {
      type: "string",
      enum: ["none", "get_weather", "search_food"],
      description: "Tool to call. Use none only when no current external data is needed."
    },
    args: {
      type: "object",
      properties: {
        city: { type: "string" },
        query: { type: "string" },
        latitude: { type: "number" },
        longitude: { type: "number" },
        openNow: { type: "boolean" }
      }
    },
    reply: {
      type: "string",
      description: "Always return an empty string. The app will call Gemini again for final replies."
    }
  },
  required: ["toolName", "args", "reply"],
  propertyOrdering: ["toolName", "args", "reply"]
};

export async function answerWithGemini({ text, location }) {
  const userPrompt = buildUserPrompt({ text, location });
  if (isStockQuestion(text)) {
    return answerStockQuestion(userPrompt);
  }

  if (!mayNeedRealtimeTool(text, location)) {
    return generateTextWithFallback({
      prompt: buildDirectAnswerPrompt(userPrompt),
      system: systemInstruction
    });
  }

  const intent = await detectIntent(userPrompt);

  if (intent.toolName === "none") {
    return generateTextWithFallback({
      prompt: buildDirectAnswerPrompt(userPrompt),
      system: systemInstruction
    });
  }

  const toolArgs = sanitizeToolArgs(intent, text);
  const toolResult = await runTool(intent.toolName, toolArgs, { location });
  if (intent.toolName === "search_food") {
    return formatFoodToolResult(toolArgs, toolResult);
  }

  return summarizeToolResult({
    userPrompt,
    toolName: intent.toolName,
    toolArgs,
    toolResult
  });
}

async function detectIntent(userPrompt) {
  const prompt = `
Classify this LINE message and return JSON only.

Rules:
- Current weather/rain/temperature/typhoon: toolName=get_weather, args.city should be a Taiwan city/county.
- If the user asks about 淡水 weather, set args.city to 淡水區, not 臺北市.
- Food/restaurants/cafes/ramen/what to eat/market food: toolName=search_food, args.query should keep the full search term, for example "西湖市場美食".
- Stocks/stock price/Taiwan stocks/US stocks/2330/AAPL-like symbols: toolName=none. Gemini will answer directly without a backend stock API.
- General chat, entertainment recommendations, writing, translation, planning, summarization, or "what can you do": toolName=none. Do not answer here; set reply to an empty string.

User message:
${userPrompt}
`.trim();

  const text = await generateTextWithFallback({
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

async function summarizeToolResult({ userPrompt, toolName, toolArgs, toolResult }) {
  const prompt = `
Reply to the LINE user in Traditional Chinese using the user message and tool result.

Requirements:
- Format for a LINE chat bubble. Use short lines, blank lines between sections, and no markdown tables.
- Use this structure when possible:
  1. First line: concise title, for example "淡水區明天天氣"
  2. Blank line
  3. 3 to 5 bullet lines starting with "• "
  4. Blank line
  5. "資料來源：..."
- Keep it mobile-friendly and concise.
- If needsConfiguration is present, clearly name the missing Render Environment variable and say Render must be redeployed after setting it.
- If providerError is present, explain the data source problem without exposing long raw JSON.
- If ok=false, explain what was not found or what input is missing.
- For weather, group the key conditions into bullets. Mention the requested location first.
- For food, recommend the single place returned by the tool. Include rating and map link when available.
- Do not invent values that are not in the tool result.
- Avoid long paragraphs.

User message:
${userPrompt}

Tool:
${toolName}

Tool args:
${JSON.stringify(toolArgs)}

Tool result:
${JSON.stringify(toolResult)}
`.trim();

  const text = await generateTextWithFallback({
    prompt,
    system: systemInstruction
  });
  return formatLineReply(text);
}

async function answerStockQuestion(userPrompt) {
  if (config.gemini.enableSearchGrounding) {
    return generateTextWithFallback({
      prompt: buildStockGroundedAnswerPrompt(userPrompt),
      fallbackPrompt: buildStockLimitedAnswerPrompt(userPrompt),
      fallbackTools: [],
      system: systemInstruction,
      tools: [{ google_search: {} }]
    });
  }

  return generateTextWithFallback({
    prompt: buildStockLimitedAnswerPrompt(userPrompt),
    system: systemInstruction
  });
}

async function generateTextWithFallback(options) {
  try {
    return await generateText(options);
  } catch (error) {
    const fallbackModel = config.gemini.fallbackModel;
    if (!isQuotaError(error) || !fallbackModel || fallbackModel === config.gemini.model) {
      throw error;
    }

    return generateText({
      ...options,
      model: fallbackModel,
      prompt: options.fallbackPrompt || options.prompt,
      tools: options.fallbackTools ?? options.tools
    });
  }
}

async function generateText({ prompt, system, generationConfig = {}, tools = [], model = config.gemini.model }) {
  const url = new URL(`${GEMINI_ENDPOINT_BASE}/${model}:generateContent`);
  const body = {
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
  };

  if (tools.length) {
    body.tools = tools;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.gemini.apiKey
    },
    body: JSON.stringify(body)
  });

  const payload = await response.text();
  if (!response.ok) {
    throw new GeminiRequestError(response.status, payload);
  }

  const data = payload ? JSON.parse(payload) : {};
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.map((part) => part.text || "").join("").trim();
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }
  return text;
}

class GeminiRequestError extends Error {
  constructor(status, payload) {
    super(`Gemini request failed: ${status} ${payload}`);
    this.name = "GeminiRequestError";
    this.status = status;
    this.payload = payload;
  }
}

function formatLineReply(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function formatFoodToolResult(toolArgs, toolResult) {
  if (toolResult.needsConfiguration) {
    return formatLineReply([
      "美食查詢尚未完成設定",
      "",
      `缺少：${toolResult.needsConfiguration}`,
      toolResult.message || "請到 Render Environment 補上設定。",
      "設定後請重新部署 Render。"
    ].join("\n"));
  }

  if (toolResult.providerError) {
    return formatLineReply([
      "美食查詢暫時失敗",
      "",
      toolResult.message || "Google Places 暫時無法回應，請稍後再試。"
    ].join("\n"));
  }

  const place = toolResult.places?.[0];
  if (!toolResult.ok || !place) {
    return formatLineReply([
      `${String(toolArgs.query || "美食").trim()}推薦`,
      "",
      toolResult.message || "目前找不到符合條件的餐廳，可以換個地區或關鍵字再試。"
    ].join("\n"));
  }

  const address = place.address || place.shortAddress || "未提供";
  const category = place.categories || place.primaryTypeName || "未提供";
  const rating = place.rating ? `★ ${place.rating}` : "未提供";
  const mapsUrl = place.mapsUrl || "未提供";
  const websiteUrl = place.websiteUrl || "未提供";
  const openStatus = typeof place.openNow === "boolean"
    ? (place.openNow ? "營業中" : "目前未營業")
    : "未提供";

  return formatLineReply([
    `${String(toolArgs.query || "美食").trim()}推薦`,
    "",
    `店名：${place.name || "未提供"}`,
    `分類：${category}`,
    `評分：${rating}`,
    `地址：${address}`,
    `營業狀態：${openStatus}`,
    `Google Maps：${mapsUrl}`,
    `訂位/官網：${websiteUrl}`,
    "",
    `資料來源：${toolResult.source || "Google Places"}`
  ].join("\n"));
}

function buildUserPrompt({ text, location }) {
  const parts = [String(text || "").trim()];
  if (location) {
    parts.push(`LINE 位置：${JSON.stringify(location)}`);
  }
  return parts.filter(Boolean).join("\n");
}

function buildDirectAnswerPrompt(userPrompt) {
  return `
Answer this LINE user message directly in Traditional Chinese.

Requirements:
- Actually answer the request; do not only introduce your capabilities.
- Keep it concise and useful for mobile chat.
- If the user asks for recommendations, give concrete options.
- If the user asks about current weather or restaurants, say you need the realtime tool instead of inventing data.

User message:
${userPrompt}
`.trim();
}

function buildStockGroundedAnswerPrompt(userPrompt) {
  return `
Answer this stock-related LINE message in Traditional Chinese using Google Search grounding.

Rules:
- Use current web search results, not model memory, for prices and market status.
- If the user asks "今天台積電股價多少", interpret it as TSMC / 台積電 / 2330.TW.
- If you find a reliable current quote, include:
  1. Stock name and ticker
  2. Latest price
  3. Change or percentage change when available
  4. Quote time and timezone when available
  5. Source name
- If search results are unclear or outdated, say you cannot confirm the latest price and suggest checking a broker app, TWSE, Yahoo Finance, or Google Finance.
- Do not fabricate exact live prices.
- Keep the reply short and LINE-friendly.
- Always include: "僅供資訊參考，不構成投資建議。"

User message:
${userPrompt}
`.trim();
}

function buildStockLimitedAnswerPrompt(userPrompt) {
  return `
Answer this stock-related LINE message in Traditional Chinese.

Important:
- Google Search grounding is disabled or quota-limited in this deployment.
- Do not provide exact current stock prices from memory.
- If the user asks for today's/latest/current price, say you cannot confirm the realtime quote right now.
- Suggest checking a broker app, Google Finance, Yahoo Finance, TWSE, or Nasdaq.
- You may still explain the company, ticker, what the quoted fields mean, and how to interpret price/change/volume.
- Keep the reply short and LINE-friendly.
- Always include: "僅供資訊參考，不構成投資建議。"

User message:
${userPrompt}
`.trim();
}

function mayNeedRealtimeTool(text, location) {
  const message = String(text || "");
  if (location) return true;
  return /天氣|下雨|降雨|氣溫|溫度|颱風|天候|美食|餐廳|吃什麼|小吃|市場|咖啡|拉麵|牛肉麵|火鍋|早餐|午餐|晚餐|宵夜/i.test(message);
}

function isStockQuestion(text) {
  return /\b[A-Z]{1,5}\b|[0-9]{4,6}|股票|股價|台股|美股|報價|台積電|鴻海|聯發科|TSMC|AAPL|NVDA|TSLA/i.test(String(text || ""));
}

function isQuotaError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("429")
    || message.includes("RESOURCE_EXHAUSTED")
    || message.includes("Quota exceeded")
    || message.includes("generate_content_free_tier_requests");
}

function sanitizeToolArgs(intent, userText = "") {
  const args = intent.args || {};
  if (intent.toolName === "get_weather") {
    return { city: extractWeatherLocationFromText(userText) || String(args.city || "").trim() || "臺北市" };
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
  return {};
}

function normalizeToolName(toolName) {
  const allowed = new Set(["none", "get_weather", "search_food"]);
  return allowed.has(toolName) ? toolName : "none";
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

function extractWeatherLocationFromText(text) {
  const message = String(text || "");
  const overrides = [
    [/淡水區|淡水/, "淡水區"],
    [/八里區|八里/, "八里區"],
    [/三芝區|三芝/, "三芝區"],
    [/石門區|石門/, "石門區"],
    [/金山區|金山/, "金山區"],
    [/萬里區|萬里/, "萬里區"],
    [/北投區|北投/, "北投區"],
    [/士林區|士林/, "士林區"],
    [/內湖區|內湖/, "內湖區"],
    [/信義區|信義/, "信義區"],
    [/板橋區|板橋/, "板橋區"],
    [/新莊區|新莊/, "新莊區"],
    [/中和區|中和/, "中和區"],
    [/永和區|永和/, "永和區"],
    [/三重區|三重/, "三重區"],
    [/蘆洲區|蘆洲/, "蘆洲區"],
    [/汐止區|汐止/, "汐止區"],
    [/新店區|新店/, "新店區"]
  ];
  return overrides.find(([pattern]) => pattern.test(message))?.[1] || "";
}
