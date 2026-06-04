function readBoolean(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function readNumber(name, defaultValue) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const value = Number(raw);
  return Number.isFinite(value) ? value : defaultValue;
}

export const config = {
  port: readNumber("PORT", 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  allowUnsignedWebhooks: readBoolean("ALLOW_UNSIGNED_WEBHOOKS", false),
  enableSimulateRoute: readBoolean("ENABLE_SIMULATE_ROUTE", false),
  aiProvider: (process.env.AI_PROVIDER || "gemini").toLowerCase(),
  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET || "",
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || ""
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "chat-latest"
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite"
  },
  providers: {
    cwaApiKey: process.env.CWA_API_KEY || "",
    googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY || "",
    finnhubApiKey: process.env.FINNHUB_API_KEY || ""
  }
};

export function hasOpenAI() {
  return Boolean(config.openai.apiKey);
}

export function hasGemini() {
  return Boolean(config.gemini.apiKey);
}
