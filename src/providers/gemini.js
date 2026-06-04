import { config } from "../config.js";
import { runTool } from "../tools.js";

const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const systemInstruction = `
你是 LINE 裡的繁體中文 AI 助理，主要服務台灣使用者。
你可以回答一般問題，也可以協助查詢台灣天氣、美食、台股與美股。
回覆要短、清楚、適合手機閱讀。
股票資訊只做查詢與摘要，不提供買賣建議。
`.trim();

const intentSchema = {
  type: "object",
  properties: {
    toolName: {
      type: "string",
      enum: ["none", "get_weather", "search_food", "get_stock_quote"],
      description: "要呼叫的工具；不需要工具時用 none"
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
      description: "若 toolName 是 none，直接提供繁體中文短回覆；否則留空字串"
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
  return summarizeToolResult({ userPrompt, toolName: intent.toolName, toolResult });
}

async function detectIntent(userPrompt) {
  const prompt = `
判斷使用者訊息是否需要呼叫工具。

工具規則：
- 查天氣、下雨、氣溫、颱風：toolName=get_weather，args.city 填台灣縣市。
- 查附近美食、餐廳、咖啡、拉麵、吃什麼、市場美食：toolName=search_food，args.query 填完整搜尋詞，例如「西湖市場美食」。
- 查股票、股價、台股、美股、2330、AAPL 這類代號：toolName=get_stock_quote，台股 market=TW，美股 market=US。
- 其他一般聊天或能力介紹：toolName=none，reply 直接用繁體中文回答。

使用者訊息：
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

async function summarizeToolResult({ userPrompt, toolName, toolResult }) {
  if (toolResult?.needsConfiguration) {
    return `此功能還缺 Render Environment 變數：${toolResult.needsConfiguration}。\n設定後請重新部署 Render。`;
  }

  if (toolResult?.providerError) {
    return `我已連到 AI，但 ${toolResult.source} 資料源發生問題：\n${toolResult.message}`;
  }

  const prompt = `
請根據使用者訊息與工具結果，用繁體中文回覆 LINE 使用者。

要求：
- 手機閱讀友善，短句，不要超過 5 行。
- 如果工具結果 ok=false，直接說明查不到或需要補哪些資訊。
- 如果是美食，列出最多 5 間，包含店名、評分、地址或 Google Maps 連結。
- 如果是股票，提醒「僅供資訊查詢，不構成投資建議」。
- 不要捏造工具結果沒有提供的數字。

使用者訊息：
${userPrompt}

工具名稱：
${toolName}

工具結果 JSON：
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
