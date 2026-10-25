// HTTP entry point and web UI.
//   POST /run                 {"question": "..."} -> the full investigation as JSON (for judges and scripts)
//   GET  /api/stream?question  the same investigation as server-sent events: every trace step live, then the result
//   GET  /api/status          data layer and Nightshift status
//   POST /api/feedback        {"ids": ["mem-1"], "kind": "helpful" | "not_helpful" | "wrong"} -> H-MEM feedback
//   GET  /                    the web UI (public/)

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { config } from "./config.ts";
import { warehouse } from "./data/warehouse.ts";
import { investigate, memory } from "./investigate.ts";
import { providerStatus } from "./llm.ts";

const PORT = Number(process.env.PORT || 3100);
const PUBLIC = path.join(import.meta.dirname, "..", "public");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

// One investigation at a time: the models and the laptop are shared.
let busy = false;

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function questionOf(value: unknown): string | undefined {
  const q = typeof value === "string" ? value.trim() : "";
  return q && q.length <= 500 ? q : undefined;
}

async function status() {
  const [data, ai] = await Promise.all([warehouse().status(), providerStatus()]);
  return {
    sample_mode: config.sampleMode,
    agents: !config.forceOffline && ai.state === "online" ? "model" : "rule-based",
    data_layer: { kind: warehouse().kind, ...data },
    nightshift: { url: config.meterless.baseUrl, state: ai.state, detail: ai.detail, model: config.meterless.model, deep_model: config.meterless.modelDeep },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (req.method === "POST" && url.pathname === "/run") {
      const question = questionOf((await readJson(req)).question);
      if (!question) return send(res, 400, { error: 'send {"question": "..."} (up to 500 characters)' });
      if (busy) return send(res, 409, { error: "an investigation is already running" });
      busy = true;
      try {
        return send(res, 200, await investigate(question));
      } finally {
        busy = false;
      }
    }

    if (req.method === "GET" && url.pathname === "/api/stream") {
      const question = questionOf(url.searchParams.get("question"));
      if (!question) return send(res, 400, { error: "question is required (up to 500 characters)" });
      if (busy) return send(res, 409, { error: "an investigation is already running" });
      busy = true;
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      const emit = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const ping = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
      try {
        const result = await investigate(question, (e) => emit("step", e));
        emit("result", result);
      } catch (err) {
        emit("failure", { error: (err as Error).message });
      } finally {
        clearInterval(ping);
        busy = false;
        res.end();
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") return send(res, 200, { ...(await status()), busy });

    if (req.method === "POST" && url.pathname === "/api/feedback") {
      const body = await readJson(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(String).filter((id) => /^mem-\d+$/.test(id)) : [];
      const kind = body.kind;
      if (!ids.length || !(kind === "helpful" || kind === "not_helpful" || kind === "wrong")) return send(res, 400, { error: 'send {"ids": ["mem-1"], "kind": "helpful" | "not_helpful" | "wrong"}' });
      memory().feedback(ids, kind);
      return send(res, 200, { ok: true, ids, kind });
    }

    if (req.method === "GET") {
      const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const file = path.join(PUBLIC, rel);
      if (file.startsWith(PUBLIC + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
        return fs.createReadStream(file).pipe(res);
      }
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    if (!res.headersSent) send(res, 500, { error: (err as Error).message });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Causa on http://localhost:${PORT}  (POST /run for scripts, the web UI at /)`);
  console.log(`data layer: ${config.sampleMode ? "SAMPLE_MODE (bundled seed data)" : `Zetaris at ${config.zetaris.restUrl}`}; AI: Nightshift at ${config.meterless.baseUrl}`);
});
