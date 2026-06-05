import http from "node:http";
import { pathToFileURL } from "node:url";
import { config } from "./config.js";
import { answerUserMessage } from "./ai.js";
import {
  getEventLocation,
  getEventText,
  replyToLine,
  toLineTextMessage,
  verifyLineSignature
} from "./line.js";

if (isMainModule()) {
  const server = createServer();
  server.listen(config.port, () => {
    console.log(`LINE AI assistant ${config.appVersion} listening on http://localhost:${config.port}`);
  });
}

export function createServer() {
  return http.createServer(routeRequest);
}

export async function routeRequest(req, res) {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, {
        ok: true,
        version: config.appVersion,
        aiProvider: config.aiProvider
      });
    }

    if (req.method === "POST" && req.url === "/webhook/line") {
      return handleLineWebhook(req, res);
    }

    if (req.method === "POST" && req.url === "/simulate" && config.enableSimulateRoute) {
      return handleSimulate(req, res);
    }

    return sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }
}

async function handleLineWebhook(req, res) {
  const rawBody = await readRequestBody(req);
  const signature = req.headers["x-line-signature"];
  const isVerified = verifyLineSignature(rawBody, signature, config.line.channelSecret);

  if (!isVerified && !config.allowUnsignedWebhooks) {
    return sendJson(res, 401, { ok: false, error: "Invalid LINE signature" });
  }

  const payload = JSON.parse(rawBody || "{}");
  const events = Array.isArray(payload.events) ? payload.events : [];

  for (const event of events) {
    await handleLineEvent(event);
  }

  return sendJson(res, 200, { ok: true });
}

async function handleLineEvent(event) {
  if (event.type !== "message" || !event.replyToken) return;

  const text = getEventText(event);
  const location = getEventLocation(event);
  const reply = await answerUserMessage({ text, location });

  await replyToLine(
    event.replyToken,
    [toLineTextMessage(reply)],
    config.line.channelAccessToken
  );
}

async function handleSimulate(req, res) {
  const body = JSON.parse(await readRequestBody(req) || "{}");
  const reply = await answerUserMessage({
    text: body.text || "",
    location: body.location || null
  });
  return sendJson(res, 200, { ok: true, reply });
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}
