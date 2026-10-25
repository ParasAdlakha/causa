// CriticAgent: refuses to pass a draft it cannot verify. Its deterministic
// checks re-derive every figure from the cited queries, confirm the change was
// compared with the company-wide trend, and push the Analyst to drill into any
// driver that explains most of the change. On the model path Nemotron also
// challenges the draft with alternative explanations, which become new
// queries. A rejected draft goes back to the Analyst with the reasons.

import { DIMENSIONS, DIMENSION_IDS, isDriver, money, readMembers, readTotals, type DimensionId, type EvidenceQuery } from "../analysis.ts";
import { chatJson } from "../llm.ts";
import type { Trace } from "../trace.ts";
import { driverCustomers, factsText, queriesById } from "./analyst.ts";
import type { Check, Context, Critique, Draft, Mode, Request } from "./shared.ts";

const AGENT = "CriticAgent";
const DRILL_ORDER: DimensionId[] = ["customer", "part_brand", "ship_mode", "part_type", "order_priority", "supplier_nation"];

export async function critique(ctx: Context, draft: Draft, round: number, maxRevisions: number, trace: Trace, mode: Mode): Promise<Critique> {
  const byId = queriesById(ctx.queries);
  const checks: Check[] = [];
  const issues: string[] = [];
  const requests: Request[] = [];

  const badCites = draft.claims.filter((c) => !c.evidence.length || c.evidence.some((id) => !byId.has(id)));
  checks.push({ name: "every claim cites a query that ran", passed: !badCites.length, detail: badCites.length ? badCites.map((c) => c.id).join(", ") : `${draft.claims.length} claims` });
  for (const c of badCites) issues.push(`Claim "${c.text.slice(0, 80)}" cites ${c.evidence.join(", ") || "nothing"}; cite one of ${[...byId.keys()].join(", ")}.`);

  const unsupported: string[] = [];
  for (const c of draft.claims) {
    const allowed = figuresFor(c.evidence.map((id) => byId.get(id)).filter((q): q is EvidenceQuery => !!q), ctx.totals?.delta ?? 0);
    for (const fig of moneyFigures(c.text)) {
      if (!allowed.some((v) => close(fig, v))) unsupported.push(`${c.id}: ${money(fig)} does not match ${c.evidence.join(", ")}`);
    }
    if (c.member && c.evidence.length && !c.evidence.some((id) => byId.get(id)?.rows.some((r) => String(r[0]).toUpperCase() === c.member!.toUpperCase()))) {
      unsupported.push(`${c.id}: ${c.member} does not appear in ${c.evidence.join(", ")}`);
    }
  }
  checks.push({ name: "every figure matches its cited query", passed: !unsupported.length, detail: unsupported.length ? unsupported.join("; ") : "all figures re-derived" });
  for (const u of unsupported) issues.push(`Unsupported figure or member (${u}). Use only numbers from the cited query.`);

  const needsBaseline = ctx.plan.focus.length > 0;
  const hasBaseline = !!ctx.baselineId;
  checks.push({ name: "compared with the company-wide trend", passed: !needsBaseline || hasBaseline, detail: needsBaseline ? (hasBaseline ? `${ctx.baselineId}` : "missing") : "company-wide question" });
  if (needsBaseline && !hasBaseline) requests.push({ kind: "baseline", reason: "a local change must be compared with the company-wide change" });
  if (needsBaseline && hasBaseline && !draft.claims.some((c) => c.evidence.includes(ctx.baselineId!))) issues.push(`Say how ${ctx.plan.focusLabel} compares with the company-wide trend (${ctx.baselineId}).`);

  const pv = draft.claims.some((c) => c.kind === "price_volume");
  checks.push({ name: "price and volume separated", passed: pv, detail: pv ? "present" : "missing" });
  if (!pv) issues.push(`Split the change into volume and price/discount effects using ${ctx.totalsId}.`);

  // Depth: a driver that explains most of the change must be explained itself.
  const drill = nextDrill(ctx);
  checks.push({ name: "dominant driver drilled into", passed: !drill, detail: drill ? `${drill.filter!.value} not yet broken down` : "no undrilled dominant driver" });
  if (drill) requests.push(drill);

  // Connect the numbers to the accounts: customers carrying the change need CRM context.
  const key = driverCustomers(ctx);
  // A lookup covers an account if it named it, or if it was a complete (under the row limit) lookup for the whole focus.
  const uncovered = key.filter((n) => !ctx.queries.some((q) => q.kind === "crm" && (q.sql.includes(`'${n}'`) || (!q.sql.includes("c.c_name IN") && q.rows.length < 25))));
  const hasContext = draft.claims.some((c) => c.kind === "context");
  checks.push({ name: "driver accounts checked in the CRM", passed: !uncovered.length && hasContext, detail: key.length ? (uncovered.length ? `${uncovered.length} of ${key.length} not looked up` : `${key.length} accounts looked up`) : hasContext ? "CRM context present" : "no CRM context in the draft" });
  if (uncovered.length) requests.push({ kind: "crm", customers: key, reason: `${uncovered.length} account(s) carry a large share of the change; check what the CRM recorded for them` });
  else if (!hasContext && ctx.queries.some((q) => q.kind === "crm")) issues.push("Use the CRM events to say why the accounts behind the change moved (kind \"context\").");

  // Confounding: secondary drivers must survive with the main driver excluded.
  const confound = confounderRequests(ctx);
  checks.push({ name: "secondary drivers tested for confounding", passed: !confound.length, detail: confound.length ? confound.map((r) => r.dimension).join(", ") + " not yet tested" : "none untested" });
  requests.push(...confound);

  const breakdowns = ctx.queries.filter((q) => q.kind === "breakdown" && q.filters.length === ctx.plan.focus.length);
  const anyDriver = breakdowns.some((q) => readMembers(q, ctx.totals?.delta ?? 0, ctx.totals?.pct ?? 0).some(isDriver));
  const priceLed = !!ctx.totals && Math.abs(ctx.totals.priceEffect) > Math.abs(ctx.totals.volumeEffect);
  if (!anyDriver && priceLed) {
    checks.push({ name: "a driver was found", passed: true, detail: "the change is price/discount-led, which the price/volume split explains" });
  } else if (!anyDriver) {
    const tested = new Set(breakdowns.map((q) => q.dimension));
    const fixed = new Set(ctx.plan.focus.map((f) => f.dimension));
    const untested = DIMENSION_IDS.filter((d) => !tested.has(d) && !fixed.has(d) && !(fixed.has("customer_nation") && d === "customer_region")).slice(0, 2);
    checks.push({ name: "a driver was found", passed: false, detail: `no dimension concentrates the change; testing ${untested.join(", ") || "nothing left"}` });
    for (const d of untested) requests.push({ kind: "breakdown", dimension: d, reason: "no tested dimension explains the change yet" });
  } else {
    checks.push({ name: "a driver was found", passed: true, detail: "at least one dimension concentrates the change" });
  }

  if (mode === "model") {
    try {
      const challenge = await modelChallenge(ctx, draft, trace);
      issues.push(...challenge.issues);
      for (const r of challenge.requests) if (!requests.some((x) => x.dimension === r.dimension && !x.filter)) requests.push(r);
    } catch (err) {
      trace.log({ agent: AGENT, action: "model_challenge_failed", status: "fallback", output_summary: (err as Error).message.slice(0, 160) });
    }
  }

  const failed = checks.filter((c) => !c.passed);
  const wantsMore = failed.length > 0 || requests.length > 0 || issues.length > 0;
  const verdict = wantsMore && round <= maxRevisions ? "revise" : "approve";
  const result: Critique = { round, verdict, checks, issues, requests, mode };
  trace.log({
    agent: AGENT,
    action: verdict === "revise" ? "request_revision" : "approve",
    target_agent: verdict === "revise" ? "AnalystAgent" : "ReporterAgent",
    status: "success",
    output_summary: `round ${round}: ${checks.length - failed.length}/${checks.length} checks passed, ${requests.length} new queries asked, ${issues.length} issues${verdict === "approve" && wantsMore ? " (revision budget spent; open points go to limitations)" : ""}`,
    detail: { checks, issues, requests },
  });
  return result;
}

function nextDrill(ctx: Context): Request | undefined {
  const delta = ctx.totals?.delta ?? 0;
  const top = ctx.queries
    .filter((q) => q.kind === "breakdown" && q.filters.length === ctx.plan.focus.length && q.dimension)
    .map((q) => ({ q, m: readMembers(q, delta, ctx.totals?.pct ?? 0).filter(isDriver).sort((a, b) => b.share - a.share)[0] }))
    .filter((x) => x.m && x.m.share >= 0.5)
    .sort((a, b) => b.m.share - a.m.share)[0];
  if (!top) return undefined;
  const filter = { dimension: top.q.dimension!, value: top.m.member };
  const drilled = ctx.queries.some((q) => q.filters.some((f) => f.dimension === filter.dimension && f.value === filter.value));
  if (drilled) return undefined;
  const fixed = new Set([...ctx.plan.focus.map((f) => f.dimension), filter.dimension]);
  const dimension = DRILL_ORDER.find((d) => !fixed.has(d));
  if (!dimension) return undefined;
  return { kind: "drill", dimension, filter, reason: `${filter.value} explains ${(top.m.share * 100).toFixed(0)}% of the change; find out what inside it moved` };
}

function confounderRequests(ctx: Context): Request[] {
  const delta = ctx.totals?.delta ?? 0;
  const top = ctx.queries
    .filter((q) => q.kind === "breakdown" && q.filters.length === ctx.plan.focus.length && q.dimension)
    .map((q) => ({ q, ms: readMembers(q, delta, ctx.totals?.pct ?? 0).filter(isDriver).sort((a, b) => b.share - a.share) }))
    .filter((x) => x.ms.length);
  if (top.length < 2) return [];
  // The main driver: the coarsest dimension with a driver (segments before customers), then the largest share.
  const coarse = (d: DimensionId) => (d === "customer" ? 1 : 0);
  top.sort((a, b) => coarse(a.q.dimension!) - coarse(b.q.dimension!) || b.ms[0].share - a.ms[0].share);
  const main = { dimension: top[0].q.dimension!, value: top[0].ms[0].member, exclude: true };
  const out: Request[] = [];
  for (const { q, ms } of top.slice(1)) {
    if (q.dimension === "customer") continue; // customers sit inside the main driver; the drill-down covers them
    const done = ctx.queries.some((x) => x.dimension === q.dimension && x.filters.some((f) => f.exclude && f.dimension === main.dimension && f.value === main.value));
    if (!done) out.push({ kind: "breakdown", dimension: q.dimension, filter: main, reason: `${ms[0].member} may only move because of ${main.value}; re-test with ${main.value} excluded` });
  }
  return out;
}

async function modelChallenge(ctx: Context, draft: Draft, trace: Trace): Promise<{ issues: string[]; requests: Request[] }> {
  const tested = [...new Set(ctx.queries.map((q) => q.dimension).filter(Boolean))];
  const system = `You are a sceptical reviewer of a revenue variance analysis. Challenge the draft: is any claim overstated, is a cause asserted that the data only correlates, is an obvious alternative explanation untested?
Reply with ONE JSON object only: {"issues":["<concrete problem with a claim, max 3>"],"test":[{"dimension":"<id>","reason":"..."}]}
"test" may name at most 2 dimensions that are NOT yet tested, from: ${DIMENSION_IDS.join(", ")}. Already tested: ${tested.join(", ")}. Return empty arrays if the draft is sound.`;
  const user = `Question: ${ctx.plan.question}\n\nQuery results:\n${factsText(ctx)}\n\nDraft:\n${draft.summary}\n${draft.claims.map((c) => `${c.id} (${c.kind}, cites ${c.evidence.join(",")}): ${c.text}`).join("\n")}`;
  const { value } = await chatJson(trace, AGENT, "challenge_draft", [
    { role: "system", content: system },
    { role: "user", content: user },
  ], (v) => {
    const o = v as Record<string, any>;
    const issues = (Array.isArray(o.issues) ? o.issues : []).map(String).filter((s: string) => s.trim()).slice(0, 3);
    const fixed = new Set(ctx.plan.focus.map((f) => f.dimension));
    const requests: Request[] = (Array.isArray(o.test) ? o.test : [])
      .filter((t: any) => DIMENSION_IDS.includes(t.dimension) && !tested.includes(t.dimension) && !fixed.has(t.dimension))
      .slice(0, 2)
      .map((t: any) => ({ kind: "breakdown" as const, dimension: t.dimension as DimensionId, reason: String(t.reason ?? `test ${DIMENSIONS[t.dimension as DimensionId].label}`) }));
    return { issues, requests };
  });
  return value;
}

// Every value a claim may legitimately quote from its cited queries.
function figuresFor(queries: EvidenceQuery[], totalDelta: number): number[] {
  const out: number[] = [];
  for (const q of queries) {
    if (q.kind === "totals" || q.kind === "baseline") {
      const t = readTotals(q);
      out.push(t.revA, t.revB, t.delta, t.volumeEffect, t.priceEffect, t.priceA, t.priceB);
    } else {
      for (const m of readMembers(q, totalDelta)) out.push(m.revA, m.revB, m.delta);
    }
  }
  return out;
}

export function moneyFigures(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(-)?\$\s?(\d[\d,]*(?:\.\d+)?)\s*([KMB])?\b/gi)) {
    const unit = (m[3] ?? "").toUpperCase();
    const scale = unit === "B" ? 1e9 : unit === "M" ? 1e6 : unit === "K" ? 1e3 : 1;
    out.push((m[1] ? -1 : 1) * Number(m[2].replace(/,/g, "")) * scale);
  }
  return out;
}

// Rounded figures count as a match: $1.23M matches anything within half the last digit, or 2%.
function close(fig: number, value: number): boolean {
  const a = Math.abs(fig);
  const b = Math.abs(value);
  const unit = a >= 1e9 ? 1e7 : a >= 1e6 ? 1e4 : a >= 1e3 ? 100 : 1;
  return Math.abs(a - b) <= Math.max(unit, 0.02 * b);
}
