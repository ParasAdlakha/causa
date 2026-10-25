// Zetaris adapter: sends one Lightning SQL statement at a time to the local
// Zetaris REST API and returns the rows. Zetaris is Causa's data layer.

import { randomUUID } from "node:crypto";
import { config } from "../config.ts";

export interface QueryRows {
  columns: string[];
  rows: unknown[][];
}

export async function zetarisSql(sql: string, limit = 1000): Promise<QueryRows> {
  if (!config.zetaris.apiKey) throw new Error("ZETARIS_API_KEY is not set (create one in the Zetaris web UI)");
  const res = await fetch(`${config.zetaris.restUrl}/sql-editor/sqls/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.zetaris.apiKey}`,
      "X-Org-ID": config.zetaris.orgId,
      "X-Request-ID": randomUUID(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ queryId: randomUUID(), sql, source: "SqlEditor", limit }),
    signal: AbortSignal.timeout(config.zetaris.timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Zetaris HTTP ${res.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as Record<string, unknown>;
  return normalise(body);
}

export async function zetarisStatus(): Promise<{ state: "online" | "unauthorized" | "offline"; detail?: string }> {
  try {
    const r = await zetarisSql("SELECT 1", 1);
    return String(r.rows[0]?.[0]) === "1" ? { state: "online" } : { state: "offline", detail: "unexpected reply to SELECT 1" };
  } catch (err) {
    const msg = (err as Error).message;
    return { state: /HTTP 40[13]|ZETARIS_API_KEY/.test(msg) ? "unauthorized" : "offline", detail: msg.slice(0, 160) };
  }
}

// The REST reply carries the rows under `data`; column names come back in one
// of a few shapes depending on the endpoint version, so accept each of them.
function normalise(body: Record<string, unknown>): QueryRows {
  const data = (body.data ?? []) as unknown[];
  const meta = (body.headers ?? body.columns ?? body.columnNames ?? body.schema ?? body.metadata) as unknown;
  let columns: string[] = [];
  if (Array.isArray(meta)) columns = meta.map((c) => (typeof c === "string" ? c : String((c as Record<string, unknown>).name ?? (c as Record<string, unknown>).columnName ?? "")));
  if (data.length && !Array.isArray(data[0]) && typeof data[0] === "object") {
    columns = columns.length ? columns : Object.keys(data[0] as object);
    return { columns, rows: data.map((r) => columns.map((c) => (r as Record<string, unknown>)[c])) };
  }
  return { columns, rows: data as unknown[][] };
}
