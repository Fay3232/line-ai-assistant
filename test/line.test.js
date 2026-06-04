import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyLineSignature } from "../src/line.js";

test("verifyLineSignature accepts a matching LINE signature", () => {
  const secret = "channel-secret";
  const body = JSON.stringify({ events: [] });
  const signature = createHmac("sha256", secret).update(body).digest("base64");

  assert.equal(verifyLineSignature(body, signature, secret), true);
});

test("verifyLineSignature rejects an invalid LINE signature", () => {
  const secret = "channel-secret";
  const body = JSON.stringify({ events: [] });

  assert.equal(verifyLineSignature(body, "invalid", secret), false);
});
