import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { normalizeTaiwanCity, runTool } from "../src/tools.js";

test("normalizeTaiwanCity maps common 台 city spellings to CWA names", () => {
  assert.equal(normalizeTaiwanCity("台北市"), "臺北市");
  assert.equal(normalizeTaiwanCity("台中"), "臺中市");
  assert.equal(normalizeTaiwanCity("台南市"), "臺南市");
  assert.equal(normalizeTaiwanCity("台東縣"), "臺東縣");
});

test("search_food explains missing Google Places key", async () => {
  const result = await runTool("search_food", { query: "西湖市場美食" });

  assert.equal(result.ok, false);
  assert.equal(result.needsConfiguration, "GOOGLE_PLACES_API_KEY");
});

test("search_food returns one random Google Places candidate", async () => {
  const originalKey = config.providers.googlePlacesApiKey;
  const originalFetch = globalThis.fetch;
  const originalRandom = Math.random;
  const requests = [];

  config.providers.googlePlacesApiKey = "test-key";
  Math.random = () => 0.6;
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      places: [
        {
          displayName: { text: "第一家" },
          formattedAddress: "台北市 1 號",
          rating: 4.1,
          googleMapsUri: "https://maps.example/1"
        },
        {
          displayName: { text: "第二家" },
          formattedAddress: "台北市 2 號",
          rating: 4.5,
          googleMapsUri: "https://maps.example/2"
        },
        {
          displayName: { text: "第三家" },
          formattedAddress: "台北市 3 號",
          rating: 4.3,
          googleMapsUri: "https://maps.example/3"
        }
      ]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const result = await runTool("search_food", { query: "西湖市場美食" });

    assert.equal(result.ok, true);
    assert.equal(result.candidateCount, 3);
    assert.equal(result.places.length, 1);
    assert.equal(result.places[0].name, "第二家");
    assert.equal(requests[0].maxResultCount, 20);
  } finally {
    config.providers.googlePlacesApiKey = originalKey;
    globalThis.fetch = originalFetch;
    Math.random = originalRandom;
  }
});
