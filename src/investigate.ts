// The investigation loop: Planner -> Analyst <-> Critic (until approved or the
// revision budget is spent) -> Reporter -> H-MEM. Every step lands in the trace.

import { Evidence, type EvidenceQuery, type Totals } from "./analysis.ts";
import { analyse, revise } from "./agents/analyst.ts";
import { critique } from "./agents/critic.ts";
import { plan as makePlan } from "./agents/planner.ts";
import { rememberFindings, report as makeReport } from "./agents/reporter.ts";
import type { Context, Critique, Draft, Mode, Plan, Report } from "./agents/shared.ts";
import { config } from "./config.ts";
import { warehouse } from "./data/warehouse.ts";
import { InvestigationMemory } from "./engines/hmem.ts";
import { providerStatus } from "./llm.ts";
import { Trace, type TraceListener } from "./trace.ts";

export interface Investigation {
  trace_id: string;
  log_path: string;
  question: string;
  status: "success" | "error";
  error?: string;
  mode: Mode;
  data_source: "zetaris" | "sample";
  plan?: Plan;
  totals?: Totals;
  draft?: Draft;
  critiques: Critique[];
  report?: Report;
  evidence: EvidenceQuery[];
  memory: { recalled: string[]; stored: string[] };
  collaboration: { revision_count: number; feedback_loop_completed: boolean; agents_used: string[] };
  models_used: string[];
  duration_ms: number;
}

let sharedMemory: InvestigationMemory | undefined;
export function memory(): InvestigationMemory {
  sharedMemory ??= new InvestigationMemory(config.paths.memory);
  return sharedMemory;
}

export async function investigate(question: string, onEvent?: TraceListener): Promise<Investigation> {
  const started = Date.now();
  const trace = new Trace();
  if (onEvent) trace.onEvent(onEvent);
  const wh = warehouse();
  const mode = await chooseMode(trace);
  const ev = new Evidence(wh, trace, config.limits.maxQueries);
  const critiques: Critique[] = [];
  const result: Investigation = {
    trace_id: trace.id,
    log_path: `logs/${trace.id}.jsonl`,
    question,
    status: "success",
    mode,
    data_source: wh.kind,
    critiques,
    evidence: ev.queries,
    memory: { recalled: [], stored: [] },
    collaboration: { revision_count: 0, feedback_loop_completed: false, agents_used: [] },
    models_used: [],
    duration_ms: 0,
  };
  try {
    const plan = await makePlan(question, mode, memory(), trace);
    result.plan = plan;
    result.memory.recalled = plan.recalled.map((m) => m.id);
    const ctx: Context = { plan, queries: ev.queries };

    let draft = await analyse(ctx, ev, wh, trace, mode);
    result.totals = ctx.totals;
    for (let round = 1; ; round++) {
      const c = await critique(ctx, draft, round, config.limits.maxRevisions, trace, mode);
      critiques.push(c);
      if (c.verdict === "approve") break;
      draft = await revise(ctx, c, ev, wh, trace, mode);
      result.collaboration.revision_count++;
    }
    result.draft = draft;
    result.collaboration.feedback_loop_completed = true;
    result.report = await makeReport(ctx, draft, critiques, trace, mode);
    result.memory.stored = rememberFindings(ctx, draft, memory(), trace);
    trace.log({ agent: "ReporterAgent", action: "deliver_answer", status: "success", output_summary: `confidence ${(result.report.confidence * 100).toFixed(0)}%, ${ev.count} queries, ${result.collaboration.revision_count} revision(s)` });
  } catch (err) {
    result.status = "error";
    result.error = (err as Error).message;
    trace.log({ agent: "Orchestrator", action: "investigation_failed", status: "error", output_summary: result.error });
  }
  result.collaboration.agents_used = [...new Set(trace.events.map((e) => e.agent).filter((a) => a.endsWith("Agent")))];
  result.models_used = trace.modelsUsed();
  result.duration_ms = Date.now() - started;
  return result;
}

// Model agents run through Nightshift when it is online; otherwise (or with
// CAUSA_OFFLINE=true) the rule-based agents run, and the trace says so.
// SAMPLE_MODE only swaps the data layer.
async function chooseMode(trace: Trace): Promise<Mode> {
  if (config.forceOffline) {
    trace.log({ agent: "Orchestrator", action: "select_mode", status: "info", output_summary: "CAUSA_OFFLINE: rule-based agents (no model calls)" });
    return "offline";
  }
  const s = await providerStatus();
  if (s.state === "online") {
    trace.log({ agent: "Orchestrator", action: "select_mode", status: "info", output_summary: `Nightshift online (${s.models.length} routes); model ${config.meterless.model}, deep ${config.meterless.modelDeep}` });
    return "model";
  }
  trace.log({ agent: "Orchestrator", action: "select_mode", status: "fallback", output_summary: `Nightshift ${s.state}${s.detail ? ` (${s.detail})` : ""}: rule-based agents` });
  return "offline";
}
