import test from "node:test";
import assert from "node:assert/strict";

process.env.AI_PROVIDER = "gemini";

const { answerUserMessage } = await import("../src/ai.js");
const { answerWithGemini } = await import("../src/providers/gemini.js");

test("missing Gemini key reply does not mention OpenAI", async () => {
  const reply = await answerUserMessage({ text: "幫我查明天台北市的天氣" });

  assert.match(reply, /GEMINI_API_KEY/);
  assert.doesNotMatch(reply, /OPENAI_API_KEY/);
});

test("Gemini provider routes common food query locally before calling Gemini", async () => {
  const reply = await answerWithGemini({ text: "西湖市場推薦美食有哪些" });

  assert.match(reply, /GOOGLE_PLACES_API_KEY/);
});

test("Gemini provider routes common weather query locally before calling Gemini", async () => {
  const reply = await answerWithGemini({ text: "幫我查明天台北市的天氣" });

  assert.match(reply, /CWA_API_KEY/);
});
