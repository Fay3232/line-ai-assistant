import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTaiwanCity } from "../src/tools.js";

test("normalizeTaiwanCity maps common 台 city spellings to CWA names", () => {
  assert.equal(normalizeTaiwanCity("台北市"), "臺北市");
  assert.equal(normalizeTaiwanCity("台中"), "臺中市");
  assert.equal(normalizeTaiwanCity("台南市"), "臺南市");
  assert.equal(normalizeTaiwanCity("台東縣"), "臺東縣");
});
