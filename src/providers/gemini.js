import { config } from "../config.js";
import { runTool } from "../tools.js";

const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const systemInstruction = `
You are a Traditional Chinese LINE assistant for users in Taiwan.
You can answer general questions directly.
For current Taiwan weather, food/restaurant recommendations, Taiwan stocks, and US stocks, choose the appropriate tool first, then summarize the tool result.
Keep replies short, clear, and mobile-friendly.
Do not fabricate current weather, restaurant details, or stock prices when a tool result is unavailable.
Stock information is for lookup only and is not investment advice.
`.trim();

const intentSchema = {
  type: "object",
  properties: {
    toolName: {
      type: "string",
      enum: ["none", "get_weather", "search_food", "get_stock_quote"],
      description: "Tool to call. Use none only when no current external data is needed."
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
      description: "Always return an empty string. The app will call Gemini again for final replies."
    }
  },
  required: ["toolName", "args", "reply"],
  propertyOrdering: ["toolName", "args", "reply"]
};

export async function answerWithGemini({ text, location }) {
  const userPrompt = buildUserPrompt({ text, location });
  if (!mayNeedRealtimeTool(text, location)) {
    return generateText({
      prompt: buildDirectAnswerPrompt(userPrompt),
      system: systemInstruction
    });
  }

  const intent = await detectIntent(userPrompt);

  if (intent.toolName === "none") {
    return generateText({
      prompt: buildDirectAnswerPrompt(userPrompt),
      system: systemInstruction
    });
  }

  const toolArgs = sanitizeToolArgs(intent, text);
  const toolResult = await runTool(intent.toolName, toolArgs, { location });
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
- Stocks/stock price/Taiwan stocks/US stocks/2330/AAPL-like symbols: toolName=get_stock_quote. Use market=TW for numeric Taiwan symbols, market=US for US tickers.
- General chat, entertainment recommendations, writing, translation, planning, summarization, or "what can you do": toolName=none. Do not answer here; set reply to an empty string.

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

async function summarizeToolResult({ userPrompt, toolName, toolArgs, toolResult }) {
  const prompt = `
Reply to the LINE user in Traditional Chinese using the user message and tool result.

Requirements:
- Keep it mobile-friendly and concise.
- If needsConfiguration is present, clearly name the missing Render Environment variable and say Render must be redeployed after setting it.
- If providerError is present, explain the data source problem without exposing long raw JSON.
- If ok=false, explain what was not found or what input is missing.
- For food, list up to 5 places with name, rating, address, and Google Maps link when available.
- For stocks, include the source caveat and say this is not investment advice.
- Do not invent values that are not in the tool result.

User message:
${userPrompt}

Tool:
${toolName}

Tool args:
${JSON.stringify(toolArgs)}

Tool result:
${JSON.stringify(toolResult)}
`.trim();

  return generateText({
    prompt,
    system: systemInstruction
  });
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
- If the user asks about current weather, restaurants, or stock prices, say you need the realtime tool instead of inventing data.

User message:
${userPrompt}
`.trim();
}

function mayNeedRealtimeTool(text, location) {
  const message = String(text || "");
  if (location) return true;
  return /天氣|下雨|降雨|氣溫|溫度|颱風|天候|美食|餐廳|吃什麼|小吃|市場|咖啡|拉麵|牛肉麵|火鍋|早餐|午餐|晚餐|宵夜|股票|股價|台股|美股|報價|\b[0-9]{4,6}\b|\b[A-Z]{1,5}\b/i.test(message);
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
