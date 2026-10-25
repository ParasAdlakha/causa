// Settings, read once from the environment. A local .env is loaded if present;
// real deployments set the variables directly.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = (name: string, fallback = ""): string => (process.env[name] ?? fallback).trim();

export const config = {
  sampleMode: env("SAMPLE_MODE", "false").toLowerCase() === "true",
  forceOffline: env("CAUSA_OFFLINE", "false").toLowerCase() === "true",
  port: Number(env("PORT", "8790")),
  zetaris: {
    restUrl: env("ZETARIS_REST_URL", "http://localhost:8888/api/v1.0").replace(/\/+$/, ""),
    orgId: env("ZETARIS_ORG_ID", "1"),
    apiKey: env("ZETARIS_API_KEY"),
    erpSource: env("ZETARIS_ERP_SOURCE", "causa_erp"),
    crmSource: env("ZETARIS_CRM_SOURCE", "causa_crm"),
    timeoutMs: 90_000,
  },
  meterless: {
    baseUrl: normaliseBaseUrl(env("METERLESS_BASE_URL", "http://127.0.0.1:8088/v1")),
    token: env("METERLESS_RUNTIME_TOKEN") || runtimeTokenFromDisk(),
    model: env("METERLESS_MODEL", "meterless/auto"),
    modelDeep: env("METERLESS_MODEL_DEEP", env("METERLESS_MODEL", "meterless/auto")),
    app: "causa",
    timeoutMs: 300_000,
  },
  paths: {
    logs: path.join(ROOT, "logs"),
    memory: process.env.CAUSA_MEMORY_DIR || path.join(ROOT, ".memory"),
    seed: path.join(ROOT, "data", "seed", "causa_seed.json.gz"),
  },
  limits: {
    maxRevisions: 2,
    maxQueries: 14,
    maxLlmRetries: 1,
  },
};

// Per the Meterless provider contract the runtime writes its token to
// <stateDir>/proxy-token; on the same machine Causa reads it from there, so the
// token never has to be copied into a file by hand.
function runtimeTokenFromDisk(): string {
  const candidates = [
    process.env.METERLESS_TOKEN_FILE,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ai.meterless.runtime", "proxy-token"),
    process.env.HOME && path.join(process.env.HOME, "Library", "Application Support", "ai.meterless.runtime", "proxy-token"),
    process.env.HOME && path.join(process.env.HOME, ".local", "share", "ai.meterless.runtime", "proxy-token"),
  ].filter((p): p is string => !!p);
  for (const file of candidates) {
    try {
      const token = fs.readFileSync(file, "utf-8").trim();
      if (token) return token;
    } catch {
      // not on this platform
    }
  }
  return "";
}

// Per the Meterless provider contract: accept a pasted URL with or without a
// scheme, /v1, /v1/chat/completions, /v1/models or /healthz, and normalise to <host>/v1.
export function normaliseBaseUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  const u = new URL(url);
  return `${u.protocol}//${u.host}/v1`;
}
