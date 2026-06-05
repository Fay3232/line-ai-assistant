import test from "node:test";
import assert from "node:assert/strict";

process.env.AI_PROVIDER = "gemini";

const { answerUserMessage } = await import("../src/ai.js");
const { answerWithGemini } = await import("../src/providers/gemini.js");
const { config } = await import("../src/config.js");

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

test("Gemini provider answers stock questions without search grounding by default", async () => {
  const calls = mockGemini([
    "我目前無法確認 2330 的即時股價，建議查看券商、Google Finance 或 TWSE。僅供資訊參考，不構成投資建議。"
  ]);

  try {
    const reply = await answerWithGemini({ text: "2330 股價" });

    assert.match(reply, /2330|即時股價/);
    assert.match(reply, /不構成投資建議/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].tools, undefined);
    assert.match(calls[0].contents[0].parts[0].text, /Google Search grounding is disabled/);
    assert.doesNotMatch(calls[0].contents[0].parts[0].text, /Classify this LINE message/);
  } finally {
    calls.restore();
  }
});

test("Gemini provider can enable Google Search grounding for stock questions", async () => {
  const calls = mockGemini([
    "台積電（2330.TW）最新股價請以查詢來源為準。僅供資訊參考，不構成投資建議。"
  ]);
  const original = config.gemini.enableSearchGrounding;
  config.gemini.enableSearchGrounding = true;

  try {
    const reply = await answerWithGemini({ text: "今天台積電股價多少" });

    assert.match(reply, /台積電|2330/);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].tools, [{ google_search: {} }]);
    assert.match(calls[0].contents[0].parts[0].text, /Google Search grounding/);
  } finally {
    config.gemini.enableSearchGrounding = original;
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
    assert.match(calls[1].contents[0].parts[0].text, /Format for a LINE chat bubble/);
    assert.match(calls[1].contents[0].parts[0].text, /• /);
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
