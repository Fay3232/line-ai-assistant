import { createHmac, timingSafeEqual } from "node:crypto";

const LINE_REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";
const LINE_TEXT_LIMIT = 5000;

export function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!channelSecret || !signature) return false;

  const expected = createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function toLineTextMessage(text) {
  const normalized = String(text || "").trim() || "抱歉，我暫時無法產生回覆。";
  return {
    type: "text",
    text: normalized.slice(0, LINE_TEXT_LIMIT)
  };
}

export async function replyToLine(replyToken, messages, channelAccessToken) {
  if (!channelAccessToken) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is required to send reply messages.");
  }

  const response = await fetch(LINE_REPLY_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${channelAccessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      replyToken,
      messages: messages.slice(0, 5)
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`LINE reply failed: ${response.status} ${details}`);
  }
}

export function getEventText(event) {
  if (event?.type !== "message") return "";
  if (event.message?.type === "text") return event.message.text || "";
  if (event.message?.type === "location") {
    const title = event.message.title || "目前位置";
    const address = event.message.address || "";
    return `使用者分享位置：${title} ${address}`;
  }
  return "";
}

export function getEventLocation(event) {
  if (event?.type !== "message" || event.message?.type !== "location") return null;
  return {
    title: event.message.title || "",
    address: event.message.address || "",
    latitude: event.message.latitude,
    longitude: event.message.longitude
  };
}
