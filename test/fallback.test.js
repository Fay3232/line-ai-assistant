import test from "node:test";
import assert from "node:assert/strict";

process.env.AI_PROVIDER = "gemini";

const { answerUserMessage } = await import("../src/ai.js");
const { answerWithGemini } = await import("../src/providers/gemini.js");

test("missing Gemini key reply does not mention OpenAI", async () => {
  const reply = await answerUserMessage({ text: "幫我寫一段開幕文案" });

  assert.match(reply, /GEMINI_API_KEY/);
  assert.doesNotMatch(reply, /OPENAI_API_KEY/);
});

test("Gemini provider sends general questions directly to Gemini answer mode", async () => {
  const calls = mockGemini([
    "推薦你最近可以看《Moving 異能》、《黑暗榮耀》和《淚之女王》。"
  ]);

  try {
    const reply = await answerWithGemini({ text: "最近推薦影集" });

    assert.match(reply, /Moving|黑暗榮耀|淚之女王/);
    assert.equal(calls.length, 1);
    assert.match(calls[0].contents[0].parts[0].text, /最近推薦影集/);
    assert.match(calls[0].contents[0].parts[0].text, /Actually answer/);
  } finally {
    calls.restore();
  }
});

test("Gemini provider lets Gemini route weather before tool lookup", async () => {
  const calls = mockGemini([
    {
      toolName: "get_weather",
      args: { city: "台北市" },
      reply: ""
    },
    "此功能還缺 Render Environment 變數：CWA_API_KEY"
  ]);

  try {
    const reply = await answerWithGemini({ text: "幫我查明天台北市的天氣" });

    assert.match(reply, /CWA_API_KEY/);
    assert.equal(calls.length, 2);
  } finally {
    calls.restore();
  }
});

test("Gemini provider corrects Tamsui weather location before tool lookup", async () => {
  const calls = mockGemini([
    {
      toolName: "get_weather",
      args: { city: "臺北市" },
      reply: ""
    },
    "淡水區天氣資料查詢中。"
  ]);

  try {
    const reply = await answerWithGemini({ text: "明天淡水的天氣" });

    assert.match(reply, /淡水/);
    assert.equal(calls.length, 2);
    assert.match(calls[1].contents[0].parts[0].text, /淡水區/);
  } finally {
    calls.restore();
  }
});

test("Gemini provider lets Gemini route food before tool lookup", async () => {
  const calls = mockGemini([
    {
      toolName: "search_food",
      args: { query: "西湖市場美食" },
      reply: ""
    },
    "此功能還缺 Render Environment 變數：GOOGLE_PLACES_API_KEY"
  ]);

  try {
    const reply = await answerWithGemini({ text: "西湖市場推薦美食有哪些" });

    assert.match(reply, /GOOGLE_PLACES_API_KEY/);
    assert.equal(calls.length, 2);
  } finally {
    calls.restore();
  }
});

function mockGemini(outputs) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let index = 0;

  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    const output = outputs[index++];
    const text = typeof output === "string" ? output : JSON.stringify(output);

    return new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text }]
          }
        }
      ]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  calls.restore = () => {
    globalThis.fetch = originalFetch;
  };

  return calls;
}
