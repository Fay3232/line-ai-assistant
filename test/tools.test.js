import test from "node:test";
import assert from "node:assert/strict";
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
