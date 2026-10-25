// Meterless H-MEM engine: Causa's long-term investigation memory.
//
// The HMEM class is the Meterless reference implementation (vendored, Apache-2.0)
// and is re-exported so the official conformance suite can run against exactly
// the engine Causa uses (npm run conformance).
//
// InvestigationMemory is the feature built on it: after every investigation the
// Reporter writes what was learned (which dimensions explained the change, which
// did not) into H-MEM, and before the next one the Planner recalls it, so a
// follow-up question starts from what earlier runs found. Analyst notes are mined
// into memory too, and thumbs up/down on an answer feeds back into the scores.

import { HMEM } from "../../vendor/hmem/src/index.ts";
import type { Trace } from "../trace.ts";

export { HMEM };

export interface Recalled {
  id: string;
  content: string;
  relevance: number;
  source: string;
  tags: string[];
}

export class InvestigationMemory {
  private hmem: InstanceType<typeof HMEM>;

  constructor(persistDir: string) {
    this.hmem = new HMEM({ persistDir, actor: "causa" });
  }

  recall(question: string, trace: Trace, agent = "PlannerAgent"): Recalled[] {
    const result = this.hmem.query(question, { topN: 5, threshold: 0.1 });
    const recalled = result.memories.map((r: any) => ({
      id: r.memory.id,
      content: r.memory.content,
      relevance: r.relevance,
      source: r.memory.source,
      tags: r.memory.tags ?? [],
    }));
    trace.log({
      agent,
      action: "hmem_recall",
      status: "success",
      input_summary: question,
      output_summary: recalled.length ? `recalled ${recalled.map((m) => m.id).join(", ")} (${result.trace.strategy})` : "no relevant memories yet",
      detail: { memories: recalled, retrievalReason: result.trace.retrievalReason },
    });
    return recalled;
  }

  remember(content: string, opts: { tags: string[]; source: string; refs?: string[] }, trace: Trace, agent = "ReporterAgent"): string {
    const record = this.hmem.add({
      content,
      type: "factual",
      layer: "working",
      tags: opts.tags,
      confidence: 0.8,
      source: opts.source,
      provenance: { origin: "plan_completion", learnedAt: Date.now(), label: "investigation finding", refs: opts.refs },
    });
    trace.log({ agent, action: "hmem_remember", status: "success", output_summary: `stored ${record.id}: ${content.slice(0, 120)}` });
    return record.id;
  }

  async note(text: string): Promise<string[]> {
    const mined = await this.hmem.mine("chat_message", text);
    if (mined.length) return mined.map((m: any) => m.id);
    const record = this.hmem.add({ content: text, type: "preference", source: "causa:analyst-note" });
    return [record.id];
  }

  feedback(ids: string[], kind: "helpful" | "not_helpful" | "wrong"): void {
    for (const id of ids) this.hmem.feedback(id, kind);
  }

  history(id: string): unknown[] {
    return this.hmem.ledger.history(id);
  }

  all(): { id: string; content: string; confidence: number; layer: string; tags: string[] }[] {
    return this.hmem.store.all().map((m: any) => ({ id: m.id, content: m.content, confidence: m.confidence, layer: m.layer, tags: m.tags }));
  }
}
