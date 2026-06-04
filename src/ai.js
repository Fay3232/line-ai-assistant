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
    return "我剛剛連線 AI 時遇到問題，請稍後再試一次。若只在美食查詢時發生，請檢查 Google Places API key、Places API 是否啟用，以及 Google Cloud billing。";
  }
}
