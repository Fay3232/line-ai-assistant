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
      return "Gemini 免費額度暫時用完了，請等約 1 分鐘再試一次。\n目前所有問題都會先交給 Gemini，因此測試太頻繁時比較容易遇到 429。";
    }
    return "我剛剛連線 AI 時遇到問題，請稍後再試一次。若持續發生，請查看 Render Logs 裡最新的 Gemini request failed 訊息。";
  }
}
