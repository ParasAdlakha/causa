// ReporterAgent: writes the approved findings up for the person who asked,
// with a citation on every number, an honest confidence score and the open
// points the Critic could not close. The write-up is checked once more against
// the evidence before it is shown. Finally it stores what was learned in H-MEM
// so the next investigation starts from it.

import { DIMENSIONS, money, pct } from "../analysis.ts";
import type { InvestigationMemory } from "../engines/hmem.ts";
import { chat } from "../llm.ts";
import type { Trace } from "../trace.ts";
import { factsText } from "./analyst.ts";
import { moneyFigures } from "./critic.ts";
import { titleCase, type Context, type Critique, type Draft, type Mode, type Report } from "./shared.ts";

const AGENT = "ReporterAgent";

export async function report(ctx: Context, draft: Draft, critiques: Critique[], trace: Trace, mode: Mode): Promise<Report> {
  const last = critiques[critiques.length - 1];
  const { confidence, reason } = score(ctx, draft, last);
  const headline = draft.summary || draft.claims[0]?.text || "";
  if (mode === "model") {
    try {
      const md = await modelReport(ctx, draft, last, confidence, reason, trace);
      return { markdown: md, headline, confidence, confidenceReason: reason, mode: "model" };
    } catch (err) {
      trace.log({ agent: AGENT, action: "model_report_failed", status: "fallback", output_summary: `${(err as Error).message.slice(0, 160)}; using the template report` });
    }
  }
  const md = templateReport(ctx, draft, last, confidence, reason);
  trace.log({ agent: AGENT, action: "write_report", status: "success", output_summary: `template report, confidence ${(confidence * 100).toFixed(0)}%` });
  return { markdown: md, headline, confidence, confidenceReason: reason, mode: "offline" };
}

export function rememberFindings(ctx: Context, draft: Draft, memory: InvestigationMemory, trace: Trace): string[] {
  const t = ctx.totals!;
  const drivers = draft.claims.filter((c) => (c.kind === "driver" || c.kind === "drilldown") && c.dimension && c.member);
  const ruledOut = draft.claims.filter((c) => c.kind === "ruled_out" && c.dimension);
  const driverText = drivers.length ? drivers.map((c) => `${DIMENSIONS[c.dimension!].label} (${titleCase(c.member!)})`).join(", ") : "no single dimension";
  const weakText = ruledOut.length ? ruledOut.map((c) => DIMENSIONS[c.dimension!].label).join(", ") : "none";
  const content = `Investigation of revenue for ${ctx.plan.focusLabel}, ${ctx.plan.periodA.label} vs ${ctx.plan.periodB.label}: revenue moved ${pct(t.pct)} (${money(t.delta)}). Explained by ${driverText}. Not the cause: ${weakText}.`;
  const tags = [
    ...ctx.plan.focus.map((f) => `focus:${f.value.toLowerCase()}`),
    ...new Set(drivers.map((c) => `driver:${c.dimension}`)),
    ...new Set(ruledOut.map((c) => `weak:${c.dimension}`)),
    "revenue-variance",
  ];
  const id = memory.remember(content, { tags, source: `causa:${trace.id}`, refs: ctx.queries.map((q) => `${trace.id}#${q.id}`) }, trace, AGENT);
  return [id];
}

function score(ctx: Context, draft: Draft, last: Critique): { confidence: number; reason: string } {
  const reasons: string[] = [];
  let c = 0.45;
  const drivers = draft.claims.filter((x) => x.kind === "driver");
  const t = ctx.totals!;
  if (drivers.length) {
    c += 0.2;
    reasons.push("a concentrated driver was found");
  } else if (Math.abs(t.priceEffect) > Math.abs(t.volumeEffect)) {
    c += 0.2;
    reasons.push("the price/volume split explains the change");
  } else reasons.push("no single driver explains the change");
  if (draft.claims.some((x) => x.kind === "context" && !x.text.includes("no notable"))) {
    c += 0.05;
    reasons.push("CRM events corroborate it");
  }
  if (draft.claims.some((x) => x.kind === "drilldown")) {
    c += 0.1;
    reasons.push("the main driver was drilled into");
  }
  if (ctx.baselineId || !ctx.plan.focus.length) {
    c += 0.1;
    reasons.push("compared with the company-wide trend");
  }
  const failed = last.checks.filter((x) => !x.passed).length;
  if (!failed) {
    c += 0.1;
    reasons.push("all critic checks passed");
  } else reasons.push(`${failed} critic check(s) still open`);
  c -= Math.min(0.2, 0.05 * last.issues.length);
  if (last.issues.length) reasons.push(`${last.issues.length} open point(s) from the critic`);
  return { confidence: Math.max(0.15, Math.min(0.95, c)), reason: reasons.join("; ") };
}

async function modelReport(ctx: Context, draft: Draft, last: Critique, confidence: number, reason: string, trace: Trace): Promise<string> {
  const system = `Write the final answer to a business analyst's question about a revenue change, in Markdown.
Use ONLY the approved claims and query results below. Put the query id in square brackets after every number, like [Q3]. Do not introduce any number that is not in the query results.
Sections, in order: a one-paragraph direct answer (no heading); "## What drove it"; "## Why: what the CRM says" (the account events behind the drivers); "## Price or volume"; "## Compared with the whole company" (only if there is a company-wide query); "## Ruled out"; "## Confidence and limitations" (state ${(confidence * 100).toFixed(0)}% and why: ${reason}; list the open points); "## Suggested next step". Keep it under 350 words.`;
  const user = `Question: ${ctx.plan.question}\n\nQuery results:\n${factsText(ctx)}\n\nApproved claims:\n${draft.claims.map((c) => `- (${c.kind}, ${c.evidence.join(",")}) ${c.text}`).join("\n")}\n\nOpen points from the critic:\n${last.issues.map((i) => `- ${i}`).join("\n") || "- none"}`;
  const result = await chat([{ role: "system", content: system }, { role: "user", content: user }], { deep: true, temperature: 0.3 });
  const allowed = draft.claims.flatMap((c) => moneyFigures(c.text));
  const stray = moneyFigures(result.content).filter((f) => !allowed.some((a) => Math.abs(Math.abs(a) - Math.abs(f)) <= Math.max(1e4, 0.02 * Math.abs(a))));
  trace.log({
    agent: AGENT,
    action: "write_report",
    model: result.model,
    duration_ms: result.ms,
    status: stray.length ? "error" : "success",
    output_summary: stray.length ? `report quotes figures not in the approved claims (${stray.map(money).join(", ")})` : `report written, confidence ${(confidence * 100).toFixed(0)}%`,
  });
  if (stray.length) throw new Error("the report contained unsupported figures");
  return result.content.trim();
}

function templateReport(ctx: Context, draft: Draft, last: Critique, confidence: number, reason: string): string {
  const cite = (ids: string[]) => ids.map((i) => `[${i}]`).join("");
  const line = (kind: string) => draft.claims.filter((c) => c.kind === kind).map((c) => `- ${c.text} ${cite(c.evidence)}`);
  const overall = draft.claims.find((c) => c.kind === "overall");
  const drivers = [...line("driver"), ...line("drilldown")];
  const out = [
    `${overall ? `${overall.text} ${cite(overall.evidence)}` : draft.summary}`,
    "",
    "## What drove it",
    ...(drivers.length ? drivers : ["- No tested dimension concentrates the change; it is spread across the business."]),
    "",
    "## Why: what the CRM says",
    ...(line("context").length ? line("context") : ["- No CRM events explain it."]),
    "",
    "## Price or volume",
    ...line("price_volume"),
  ];
  const baseline = line("baseline");
  if (baseline.length) out.push("", "## Compared with the whole company", ...baseline);
  const ruled = line("ruled_out");
  out.push("", "## Ruled out", ...(ruled.length ? ruled : ["- Nothing was ruled out."]));
  out.push("", "## Confidence and limitations", `- Confidence ${(confidence * 100).toFixed(0)}%: ${reason}.`, ...last.issues.map((i) => `- Open point: ${i}`), "- Revenue is net of discount, by order date; returns are not subtracted.");
  const top = draft.claims.find((c) => c.kind === "drilldown") ?? draft.claims.find((c) => c.kind === "driver");
  out.push("", "## Suggested next step", top ? `- Review ${titleCase(top.member ?? "the main driver")} with the account owners: it carries most of the change.` : "- Widen the comparison window or test more dimensions.");
  return out.join("\n");
}
