// Meterless Nightshift client: Causa's only AI provider.
// Implements the Meterless Runtime provider contract: OpenAI-compatible
// /v1/chat/completions, a real bearer token, the meterless-app and
// meterless-scope headers, and GET /v1/models as the online check.

import { config } from "./config.ts";
import type { Trace } from "./trace.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  model: string; // the model Nightshift says handled the request
  ms: number;
}

export type ProviderState = "online" | "unauthorized" | "offline";

export async function providerStatus(): Promise<{ state: ProviderState; models: string[]; detail?: string }> {
  try {
    const res = await fetch(`${config.meterless.baseUrl}/models`, {
      headers: headers(),
      signal: AbortSignal.timeout(5_000),
    });
    if (res.status === 401 || res.status === 403) return { state: "unauthorized", models: [], detail: `HTTP ${res.status}` };
    if (!res.ok) return { state: "offline", models: [], detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { data?: { id: string }[] };
    const models = (body.data ?? []).map((m) => m.id);
    return models.length ? { state: "online", models } : { state: "offline", models, detail: "no models listed" };
  } catch (err) {
    return { state: "offline", models: [], detail: (err as Error).message };
  }
}

export async function chat(messages: ChatMessage[], opts: { deep?: boolean; temperature?: number } = {}): Promise<ChatResult> {
  if (!config.meterless.token) throw new Error("METERLESS_RUNTIME_TOKEN is not set (copy it from Nightshift's Console)");
  const started = Date.now();
  const res = await fetch(`${config.meterless.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { ...headers(), "meterless-scope": "user", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.deep ? config.meterless.modelDeep : config.meterless.model,
      messages,
      temperature: opts.temperature ?? 0.2,
    }),
    signal: AbortSignal.timeout(config.meterless.timeoutMs),
  });
  if (res.status === 401 || res.status === 403) throw new Error(`Nightshift rejected the runtime token (HTTP ${res.status})`);
  if (!res.ok) throw new Error(`Nightshift returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new Error("Nightshift returned an empty answer");
  return { content, model: body.model ?? res.headers.get("meterless-model") ?? "unknown", ms: Date.now() - started };
}

// Asks for JSON and parses it. On a parse or validation failure the error goes
// back to the model once, so it can correct itself; the retry is traced.
export async function chatJson<T>(
  trace: Trace,
  agent: string,
  action: string,
  messages: ChatMessage[],
  validate: (value: unknown) => T,
  opts: { deep?: boolean } = {},
): Promise<{ value: T; model: string }> {
  let convo = [...messages];
  for (let attempt = 0; attempt <= config.limits.maxLlmRetries; attempt++) {
    const result = await chat(convo, opts);
    try {
      const value = validate(extractJson(result.content));
      trace.log({ agent, action, model: result.model, duration_ms: result.ms, retry_count: attempt, status: "success", output_summary: "model call ok" });
      return { value, model: result.model };
    } catch (err) {
      trace.log({ agent, action, model: result.model, duration_ms: result.ms, retry_count: attempt, status: "error", output_summary: `invalid JSON: ${(err as Error).message}` });
      convo = [
        ...convo,
        { role: "assistant", content: result.content },
        { role: "user", content: `That was not valid: ${(err as Error).message}. Reply again with only the corrected JSON object.` },
      ];
    }
  }
  throw new Error(`${agent} could not get valid JSON from the model`);
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the reply");
  return JSON.parse(body.slice(start, end + 1));
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "meterless-app": config.meterless.app };
  if (config.meterless.token) h.Authorization = `Bearer ${config.meterless.token}`;
  return h;
}
