// JSONL trace of one investigation: every agent step, every handoff, every SQL
// query and every model call (with the model that actually answered). This is
// the evidence of how Causa reached its answer.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.ts";

export interface TraceEvent {
  timestamp: string;
  trace_id: string;
  step: number;
  agent: string;
  action: string;
  target_agent?: string;
  input_summary?: string;
  output_summary?: string;
  model?: string;
  query_id?: string;
  duration_ms?: number;
  retry_count?: number;
  status: "success" | "error" | "fallback" | "info";
  detail?: unknown;
}

export type TraceListener = (event: TraceEvent) => void;

export class Trace {
  readonly id: string;
  readonly file: string;
  readonly events: TraceEvent[] = [];
  private listeners: TraceListener[] = [];

  constructor() {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
    this.id = `trace-${stamp}-${randomUUID().slice(0, 6)}`;
    fs.mkdirSync(config.paths.logs, { recursive: true });
    this.file = path.join(config.paths.logs, `${this.id}.jsonl`);
  }

  onEvent(listener: TraceListener): void {
    this.listeners.push(listener);
  }

  log(event: Omit<TraceEvent, "timestamp" | "trace_id" | "step">): TraceEvent {
    const full: TraceEvent = { timestamp: new Date().toISOString(), trace_id: this.id, step: this.events.length + 1, ...event };
    this.events.push(full);
    fs.appendFileSync(this.file, JSON.stringify(full) + "\n");
    const who = full.target_agent ? `${full.agent} -> ${full.target_agent}` : full.agent;
    const model = full.model ? ` [${full.model}]` : "";
    if (!process.env.CAUSA_QUIET) console.log(`  ${String(full.step).padStart(2)} ${who}: ${full.action}${model} ${full.output_summary ?? ""}`.trimEnd());
    for (const l of this.listeners) l(full);
    return full;
  }

  modelsUsed(): string[] {
    return [...new Set(this.events.map((e) => e.model).filter((m): m is string => !!m))];
  }
}
