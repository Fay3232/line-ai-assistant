import { config } from "../config.js";
import { runTool } from "../tools.js";

const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const systemInstruction = `
You are a Traditional Chinese LINE assistant for users in Taiwan.
You can answer general questions directly.
For current Taiwan weather and food/restaurant recommendations, choose the appropriate tool first, then summarize the tool result.
For stock questions, answer directly with Gemini. Do not claim you have guaranteed realtime quotes; mention uncertainty when the user asks for current prices.
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
- Stocks/stock price/Taiwan stocks/US stocks/2330/AAPL-like symbols: toolName=none. Gemini will answer directly without a backend stock API.
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

  const text = await generateText({
    prompt,
    system: systemInstruction
  });
  return formatLineReply(text);
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
- If the user asks about stocks or stock prices, answer directly with Gemini. Be clear that prices may not be realtime, avoid fabricating exact live quotes, and include "僅供資訊參考，不構成投資建議。"

User message:
${userPrompt}
`.trim();
}

function mayNeedRealtimeTool(text, location) {
  const message = String(text || "");
  if (location) return true;
  return /天氣|下雨|降雨|氣溫|溫度|颱風|天候|美食|餐廳|吃什麼|小吃|市場|咖啡|拉麵|牛肉麵|火鍋|早餐|午餐|晚餐|宵夜/i.test(message);
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
