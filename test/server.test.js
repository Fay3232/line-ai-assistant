import test from "node:test";
import assert from "node:assert/strict";

process.env.ENABLE_SIMULATE_ROUTE = "true";

const { createServer } = await import("../src/server.js");

test("GET /health returns ok", async () => {
  const server = await listen(createServer());
  try {
    const response = await fetch(server.url("/health"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.version, "gemini-direct-answer-tamsui-weather-2026-06-05");
    assert.equal(body.aiProvider, "gemini");
  } finally {
    await close(server.instance);
  }
});

test("POST /simulate handles Chinese weather text", async () => {
  const server = await listen(createServer());
  try {
    const response = await fetch(server.url("/simulate"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ text: "台北明天會下雨嗎？" })
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.match(body.reply, /GEMINI_API_KEY/);
  } finally {
    await close(server.instance);
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        instance: server,
        url: (path) => `http://127.0.0.1:${address.port}${path}`
      });
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
