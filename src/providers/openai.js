import { config } from "../config.js";
import { runTool, toolDefinitions } from "../tools.js";

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

const instructions = `
你是 LINE 裡的繁體中文 AI 助理，主要服務台灣使用者。
你可以回答一般問題，也可以透過工具查詢天氣、美食與股票。
規則：
- 回覆要短、清楚、適合手機閱讀。
- 美食查詢若缺地點，請請使用者分享 LINE 位置或輸入城市/區域。
- 股票資訊只做查詢與摘要，不提供買賣建議，也不要保證即時性。
- 工具結果若顯示缺少 API key，請用使用者能理解的方式說明尚未完成該資料源設定。
`.trim();

export async function answerWithOpenAI({ text, location }) {
  const input = [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: buildUserPrompt({ text, location })
        }
      ]
    }
  ];

  return runResponsesToolLoop(input, { location });
}

async function runResponsesToolLoop(input, context) {
  let conversationInput = input;
  let lastText = "";

  for (let step = 0; step < 3; step += 1) {
    const response = await createResponse(conversationInput);
    lastText = extractText(response) || lastText;

    const toolCalls = (response.output || []).filter((item) => item.type === "function_call");
    if (toolCalls.length === 0) {
      return lastText || "我需要更多資訊才能回答。";
    }

    conversationInput = [
      ...conversationInput,
      ...(response.output || [])
    ];

    for (const toolCall of toolCalls) {
      const args = parseArguments(toolCall.arguments);
      const toolResult = await runTool(toolCall.name, args, context);
      conversationInput.push({
        type: "function_call_output",
        call_id: toolCall.call_id,
        output: JSON.stringify(toolResult)
      });
    }
  }

  return lastText || "我已查到部分資訊，但還需要再整理一次。";
}

async function createResponse(input) {
  const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.openai.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.openai.model,
      instructions,
      input,
      tools: toolDefinitions,
      max_output_tokens: 800
    })
  });

  const payload = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status} ${payload}`);
  }

  return payload ? JSON.parse(payload) : {};
}

function buildUserPrompt({ text, location }) {
  const parts = [String(text || "").trim()];
  if (location) {
    parts.push(`LINE 位置：${JSON.stringify(location)}`);
  }
  return parts.filter(Boolean).join("\n");
}

function extractText(response) {
  if (response.output_text) return response.output_text.trim();

  const chunks = [];
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" || content.type === "text") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function parseArguments(raw) {
  if (!raw) return {};
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}
