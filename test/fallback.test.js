import test from "node:test";
import assert from "node:assert/strict";

process.env.AI_PROVIDER = "gemini";

const { answerUserMessage } = await import("../src/ai.js");

test("missing Gemini key reply does not mention OpenAI", async () => {
  const reply = await answerUserMessage({ text: "幫我查明天台北市的天氣" });

  assert.match(reply, /GEMINI_API_KEY/);
  assert.doesNotMatch(reply, /OPENAI_API_KEY/);
});
