import { config, hasGemini, hasOpenAI } from "./config.js";
import { heuristicReply, missingAiKeyReply } from "./fallback.js";
import { answerWithGemini } from "./providers/gemini.js";
import { answerWithOpenAI } from "./providers/openai.js";

export async function answerUserMessage({ text, location }) {
  if (config.aiProvider === "openai") {
    if (!hasOpenAI()) return missingAiKeyReply();
    return withSafeError(() => answerWithOpenAI({ text, location }));
  }

  if (config.aiProvider === "gemini") {
    if (!hasGemini()) return missingAiKeyReply();
    return withSafeError(() => answerWithGemini({ text, location }));
  }

  return heuristicReply({ text, location });
}

async function withSafeError(action) {
  try {
    return await action();
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("429") || message.includes("RESOURCE_EXHAUSTED") || message.includes("Quota exceeded")) {
      return buildGeminiQuotaReply(message);
    }
    return "我剛剛連線 AI 時遇到問題，請稍後再試一次。若持續發生，請查看 Render Logs 裡最新的 Gemini request failed 訊息。";
  }
}

function buildGeminiQuotaReply(message) {
  const retryDelay = message.match(/retryDelay"?\s*:\s*"?([0-9.]+s)"?/i)?.[1]
    || message.match(/retry in ([0-9.]+s)/i)?.[1];

  const retryLine = retryDelay
    ? `如果只是短暫限流，Google 建議約 ${retryDelay} 後再試。`
    : "這不一定等 1 分鐘就會恢復，可能要等每日免費額度重置。";

  return [
    "Gemini 目前回傳額度限制 429。",
    retryLine,
    "若一直發生，請在 Render 先改成：",
    "GEMINI_MODEL=gemini-2.5-flash-lite",
    "GEMINI_ENABLE_SEARCH_GROUNDING=false",
    "然後重新部署。"
  ].join("\n");
}
