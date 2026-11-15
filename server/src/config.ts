import dotenv from "dotenv";

dotenv.config();

export function getConfig() {
  const nodeEnv = process.env.NODE_ENV || "development";
  const production = nodeEnv === "production";
  return {
    nodeEnv,
    production,
    databaseUrl: process.env.DATABASE_URL || "",
    sessionSecret: process.env.SESSION_SECRET || (production ? "" : "dev-only-secret-change-me"),
    cookieSecure: process.env.COOKIE_SECURE === "true",
    port: Number(process.env.PORT || 4317),
    host: process.env.HOST || "0.0.0.0",
    publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""),
    localLlmUrl: (process.env.LOCAL_LLM_URL || "").replace(/\/$/, ""),
    localLlmModel: process.env.LOCAL_LLM_MODEL || "qwen2.5:3b",
    localLlmKey: process.env.LOCAL_LLM_API_KEY || "",
    cloudEnabled: process.env.ENABLE_CLOUD_LLM === "true",
    llmProvider: (process.env.LLM_PROVIDER || "").toLowerCase(),
    trustProxy: process.env.TRUST_PROXY === "true",
    loginLimit: Number(process.env.LOGIN_LIMIT || 8),
    logLevel: process.env.LOG_LEVEL || "info",
  };
}
