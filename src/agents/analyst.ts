// AnalystAgent: executes the plan against the data layer. It measures the
// change, splits it into price and volume, compares it with the company-wide
// trend, breaks it down along every hypothesis, and drafts claims that cite
// the query behind each number. When the Critic sends work back, it runs the
// extra queries asked for and redrafts.

import { DIMENSIONS, Evidence, breakdownSql, crmSql, isDriver, money, pct, readMembers, readTotals, totalsSql, type EvidenceQuery, type Filter } from "../analysis.ts";
import type { Warehouse } from "../data/warehouse.ts";
import { chatJson } from "../llm.ts";
import type { Trace } from "../trace.ts";
import { titleCase, type Claim, type Context, type Critique, type Draft, type Mode } from "./shared.ts";

const AGENT = "AnalystAgent";

export async function analyse(ctx: Context, ev: Evidence, wh: Warehouse, trace: Trace, mode: Mode): Promise<Draft> {
  const { plan } = ctx;
  const t = await ev.run(AGENT, `Measure revenue for ${plan.focusLabel}, ${plan.periodA.label} vs ${plan.periodB.label}`, "totals", totalsSql(wh, plan.periodA, plan.periodB, plan.focus), plan.focus);
  ctx.totals = readTotals(t);
  ctx.totalsId = t.id;
  if (ctx.totals.revA === 0 && ctx.totals.revB === 0) throw new Error(`no orders found for ${plan.focusLabel} in ${plan.periodA.label} or ${plan.periodB.label}`);
  if (plan.focus.length) await runBaseline(ctx, ev, wh);
  for (const h of plan.hypotheses) {
    await ev.run(AGENT, `Break the change down by ${DIMENSIONS[h.dimension].label}`, "breakdown", breakdownSql(wh, plan.periodA, plan.periodB, plan.focus, h.dimension), plan.focus, h.dimension);
  }
  ctx.queries = ev.queries;
  await runCrm(ctx, ev, wh, driverCustomers(ctx));
  return draft(ctx, trace, mode, []);
}

export async function revise(ctx: Context, critique: Critique, ev: Evidence, wh: Warehouse, trace: Trace, mode: Mode): Promise<Draft> {
  trace.log({ agent: AGENT, action: "receive_critique", status: "info", input_summary: `${critique.requests.length} requests, ${critique.issues.length} issues` });
  const { plan } = ctx;
  for (const r of critique.requests) {
    try {
      if (r.kind === "baseline" && !ctx.baselineId) await runBaseline(ctx, ev, wh);
      if (r.kind === "crm") await runCrm(ctx, ev, wh, r.customers ?? []);
      if ((r.kind === "breakdown" || r.kind === "drill") && r.dimension) {
        const filters: Filter[] = r.filter ? [...plan.focus, r.filter] : plan.focus;
        const where = r.filter ? ` ${r.filter.exclude ? "excluding" : "within"} ${titleCase(r.filter.value)}` : "";
        if (ev.queries.some((q) => q.dimension === r.dimension && JSON.stringify(q.filters) === JSON.stringify(filters))) continue;
        await ev.run(AGENT, `Break the change down by ${DIMENSIONS[r.dimension].label}${where} (asked by Critic: ${r.reason})`, "breakdown", breakdownSql(wh, plan.periodA, plan.periodB, filters, r.dimension), filters, r.dimension);
      }
    } catch (err) {
      trace.log({ agent: AGENT, action: "request_failed", status: "error", output_summary: (err as Error).message.slice(0, 200) });
    }
  }
  ctx.queries = ev.queries;
  return draft(ctx, trace, mode, critique.issues);
}

// Cross-source evidence: what the CRM recorded for the accounts behind the change.
async function runCrm(ctx: Context, ev: Evidence, wh: Warehouse, customers: string[]): Promise<void> {
  const { plan } = ctx;
  const who = customers.length ? customers.map(titleCase).join(", ") : plan.focusLabel;
  await ev.run(AGENT, `CRM account events for ${who} around the change (CRM joined to ERP customers)`, "crm", crmSql(wh, plan.periodA, plan.periodB, plan.focus, customers), plan.focus);
  ctx.queries = ev.queries;
}

// Customers that individually carry a large part of the change.
export function driverCustomers(ctx: Context): string[] {
  const delta = ctx.totals?.delta ?? 0;
  return ctx.queries
    .filter((q) => q.kind === "breakdown" && q.dimension === "customer")
    .flatMap((q) => readMembers(q, delta, ctx.totals?.pct ?? 0).filter((m) => m.share >= 0.08 && Math.abs(m.z) >= 2.5))
    .sort((a, b) => b.share - a.share)
    .map((m) => m.member)
    .filter((m, i, all) => all.indexOf(m) === i)
    .slice(0, 6);
}

async function runBaseline(ctx: Context, ev: Evidence, wh: Warehouse): Promise<void> {
  const { plan } = ctx;
  const b = await ev.run(AGENT, `Company-wide revenue for the same periods, to tell a local change from a general one`, "baseline", totalsSql(wh, plan.periodA, plan.periodB, []), []);
  ctx.baseline = readTotals(b);
  ctx.baselineId = b.id;
}

async function draft(ctx: Context, trace: Trace, mode: Mode, issues: string[]): Promise<Draft> {
  const computed = computeClaims(ctx);
  if (mode === "model") {
    try {
      const d = await modelDraft(ctx, computed, issues, trace);
      trace.log({ agent: AGENT, action: "submit_draft", target_agent: "CriticAgent", status: "success", output_summary: `${d.claims.length} claims citing ${new Set(d.claims.flatMap((c) => c.evidence)).size} queries` });
      return d;
    } catch (err) {
      trace.log({ agent: AGENT, action: "model_draft_failed", status: "fallback", output_summary: `${(err as Error).message}; using computed claims` });
    }
  }
  const d: Draft = { summary: computed[0]?.text ?? "", claims: computed, mode: "offline" };
  trace.log({ agent: AGENT, action: "submit_draft", target_agent: "CriticAgent", status: "success", output_summary: `${d.claims.length} computed claims` });
  return d;
}

async function modelDraft(ctx: Context, computed: Claim[], issues: string[], trace: Trace): Promise<Draft> {
  const system = `You are a careful financial analyst explaining a revenue change. You get query results (each with an id like Q3) and pre-computed findings.
Write claims a business reader can act on. Every claim must cite the query ids whose numbers it uses, and every number must come from those queries.
Reply with ONE JSON object only:
{"summary":"<two sentences: what changed and the main reason>",
 "claims":[{"kind":"overall|price_volume|baseline|driver|drilldown|context|ruled_out","text":"...","evidence":["Q1"],"dimension":"<dimension id or omit>","member":"<member or omit>"}]}
Include one overall claim, the price/volume split, the company-wide comparison when there is one, the main drivers, any drill-downs, what the CRM events say about why (kind "context", citing the CRM query), and what was ruled out. Only call something a cause when the CRM or the data shows the mechanism; otherwise call it a driver.`;
  const user = `Question: ${ctx.plan.question}\n\nQuery results:\n${factsText(ctx)}\n\nPre-computed findings:\n${computed.map((c) => `- (${c.kind}) ${c.text}`).join("\n")}${
    issues.length ? `\n\nThe Critic rejected the previous draft. Fix every one of these:\n${issues.map((i) => `- ${i}`).join("\n")}` : ""
  }`;
  const { value } = await chatJson(trace, AGENT, issues.length ? "redraft_claims" : "draft_claims", [
    { role: "system", content: system },
    { role: "user", content: user },
  ], (v) => {
    const o = v as Record<string, any>;
    if (!Array.isArray(o.claims) || !o.claims.length) throw new Error("claims must be a non-empty array");
    const claims: Claim[] = o.claims.map((c: any, i: number) => ({
      id: `C${i + 1}`,
      kind: ["overall", "price_volume", "baseline", "driver", "drilldown", "ruled_out", "context"].includes(c.kind) ? c.kind : "driver",
      text: String(c.text ?? ""),
      evidence: Array.isArray(c.evidence) ? c.evidence.map(String) : [],
      dimension: c.dimension && c.dimension in DIMENSIONS ? c.dimension : undefined,
      member: c.member ? String(c.member) : undefined,
    }));
    return { summary: String(o.summary ?? ""), claims, mode: "model" as const };
  });
  return value;
}

// The deterministic findings: what the numbers say before any model writes prose.
export function computeClaims(ctx: Context): Claim[] {
  const t = ctx.totals!;
  const { plan } = ctx;
  const claims: Claim[] = [];
  const add = (c: Omit<Claim, "id">) => claims.push({ id: `C${claims.length + 1}`, ...c });
  const direction = t.delta < 0 ? "fell" : "rose";

  add({
    kind: "overall",
    evidence: [ctx.totalsId!],
    text: `Revenue for ${plan.focusLabel} ${direction} from ${money(t.revA)} in ${plan.periodA.label} to ${money(t.revB)} in ${plan.periodB.label} (${pct(t.pct)}, ${money(t.delta)}), on ${t.ordersA} vs ${t.ordersB} orders.`,
  });
  add({
    kind: "price_volume",
    evidence: [ctx.totalsId!],
    text: `Units sold went from ${Math.round(t.qtyA).toLocaleString("en-US")} to ${Math.round(t.qtyB).toLocaleString("en-US")} and net revenue per unit from $${t.priceA.toFixed(2)} to $${t.priceB.toFixed(2)}: volume accounts for ${money(t.volumeEffect)} and price/discount for ${money(t.priceEffect)} of the change, so this is mainly a ${Math.abs(t.volumeEffect) >= Math.abs(t.priceEffect) ? "volume" : "price/discount"} effect${Math.sign(t.volumeEffect) !== Math.sign(t.priceEffect) ? ", with the two pulling in opposite directions" : ""}.`,
  });
  if (ctx.baseline && ctx.baselineId) {
    const b = ctx.baseline;
    const gap = t.pct - b.pct;
    add({
      kind: "baseline",
      evidence: [ctx.baselineId],
      text: `Company-wide revenue moved ${pct(b.pct)} over the same periods, so ${plan.focusLabel} ${Math.abs(gap) < 0.03 ? "followed the general trend" : `${gap < 0 ? "under" : "out"}performed the company by ${(Math.abs(gap) * 100).toFixed(1)} points`}.`,
    });
  }
  // The latest CRM lookup is the most specific one (the Critic narrows it to the driver accounts).
  const crm = ctx.queries.filter((q) => q.kind === "crm").at(-1);
  if (crm) {
    const c = crmClaim(crm);
    if (c) add(c);
  }
  // Confounder tests: a breakdown re-run with the main driver excluded.
  const sideEffects = new Set<string>();
  for (const q of ctx.queries.filter((q) => q.kind === "breakdown" && q.filters.some((f) => f.exclude))) {
    const ex = q.filters.find((f) => f.exclude)!;
    const label = DIMENSIONS[q.dimension!].label;
    const original = ctx.queries.find((o) => o.kind === "breakdown" && o.dimension === q.dimension && o.filters.length === plan.focus.length);
    const suspect = original && readMembers(original, t.delta, t.pct).filter(isDriver).sort((a, b) => b.share - a.share)[0];
    if (!suspect) continue;
    const now = readMembers(q, t.delta, t.pct).find((m) => m.member === suspect.member);
    const z = now?.z ?? 0;
    if (Math.abs(z) < suspect.zNeeded) {
      sideEffects.add(q.dimension!);
      add({ kind: "ruled_out", evidence: [original!.id, q.id], dimension: q.dimension, text: `${titleCase(suspect.member)} (${label}) looked like a driver, but excluding ${titleCase(ex.value)} it moves in line with the trend (${Math.abs(z).toFixed(1)} standard deviations), so it is a side effect of ${titleCase(ex.value)}, not a separate cause.` });
    } else {
      add({ kind: "driver", evidence: [original!.id, q.id], dimension: q.dimension, member: suspect.member, text: `${titleCase(suspect.member)} (${label}) is a separate driver: even excluding ${titleCase(ex.value)} it moves ${Math.abs(z).toFixed(1)} standard deviations.` });
      sideEffects.add(q.dimension!); // reported by the claim above instead
    }
  }
  const drilled = new Set(ctx.queries.filter((q) => q.kind === "breakdown" && q.filters.length > plan.focus.length && !q.filters.some((f) => f.exclude)).map((q) => q.dimension));
  for (const q of ctx.queries.filter((q) => q.kind === "breakdown" && q.dimension && !q.filters.some((f) => f.exclude))) {
    const members = readMembers(q, t.delta, t.pct).sort((a, b) => b.share - a.share);
    const top = members[0];
    if (!top) continue;
    const label = DIMENSIONS[q.dimension!].label;
    const drill = q.filters.length > plan.focus.length ? q.filters[q.filters.length - 1] : undefined;
    const within = drill ? ` within ${titleCase(drill.value)}` : "";
    const drivers = members.filter(isDriver);
    if (!drill && sideEffects.has(q.dimension!)) continue;
    if (drivers.length) {
      if (!drill && drilled.has(q.dimension)) continue; // the drill-down says the same, more precisely
      const [first, second] = drivers;
      const size = first.share > 1 ? "more than the whole net change, which other values partly offset" : `${(first.share * 100).toFixed(0)}% of the change`;
      const also = second ? `, followed by ${titleCase(second.member)} (${money(second.delta)})` : "";
      add({
        kind: drill ? "drilldown" : "driver",
        evidence: [q.id],
        dimension: q.dimension,
        member: first.member,
        text: `By ${label}${within}, ${titleCase(first.member)} went from ${money(first.revA)} to ${money(first.revB)}: ${money(first.delta)}, ${size}, and ${Math.abs(first.z).toFixed(1)} standard deviations away from the overall trend${also}.`,
      });
    } else {
      const loudest = [...members].sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
      add({
        kind: "ruled_out",
        evidence: [q.id],
        dimension: q.dimension,
        text: `By ${label}${within}, every value moves in line with the overall trend (largest: ${titleCase(loudest.member)}, ${Math.abs(loudest.z).toFixed(1)} standard deviations), so ${label} does not explain the change.`,
      });
    }
  }
  return claims;
}

const EVENT_WEIGHT: Record<string, number> = { contract_ended: 5, new_contract: 5, price_renegotiated: 4, tender: 3, complaint: 2, renewal: 1 };

// Summarises the notable CRM events in one query into a context claim.
function crmClaim(q: EvidenceQuery): Omit<Claim, "id"> | undefined {
  if (!q.rows.length) return { kind: "context", evidence: [q.id], text: `The CRM has no notable account events (contracts, tenders, pricing, complaints) for these accounts around the change.` };
  const byType = new Map<string, { customers: Set<string>; first: string; summary: string }>();
  for (const [customer, date, type, summary] of q.rows.map((r) => r.map(String))) {
    const t = byType.get(type) ?? { customers: new Set<string>(), first: date, summary };
    t.customers.add(customer);
    byType.set(type, t);
  }
  const ranked = [...byType.entries()].sort((a, b) => (EVENT_WEIGHT[b[0]] ?? 0) - (EVENT_WEIGHT[a[0]] ?? 0) || b[1].customers.size - a[1].customers.size);
  const [type, top] = ranked[0];
  const others = ranked.slice(1, 3).map(([t, v]) => `${v.customers.size} ${t.replace(/_/g, " ")}`).join(", ");
  return {
    kind: "context",
    evidence: [q.id],
    text: `The CRM records ${top.customers.size} "${type.replace(/_/g, " ")}" event(s) from ${top.first} (${[...top.customers].slice(0, 3).map(titleCase).join(", ")}${top.customers.size > 3 ? ", ..." : ""}): "${top.summary}"${others ? ` Other events: ${others}.` : ""}`,
  };
}

export function factsText(ctx: Context): string {
  const lines: string[] = [];
  for (const q of ctx.queries) {
    if (q.kind === "crm") {
      lines.push(`${q.id} [${q.purpose}]: ${q.rows.length} events`);
      for (const r of q.rows.slice(0, 12)) lines.push(`   ${r[1]} ${r[0]} ${r[2]}: ${r[3]}`);
    } else if (q.kind === "totals" || q.kind === "baseline") {
      const t = readTotals(q);
      lines.push(`${q.id} [${q.purpose}]: ${money(t.revA)} -> ${money(t.revB)} (${pct(t.pct)}, change ${money(t.delta)}); orders ${t.ordersA} -> ${t.ordersB}; units ${Math.round(t.qtyA)} -> ${Math.round(t.qtyB)}; revenue per unit $${t.priceA.toFixed(2)} -> $${t.priceB.toFixed(2)}; volume effect ${money(t.volumeEffect)}, price effect ${money(t.priceEffect)}`);
    } else {
      const members = readMembers(q, ctx.totals?.delta ?? 0, ctx.totals?.pct ?? 0).slice(0, 8);
      lines.push(`${q.id} [${q.purpose}]:`);
      for (const m of members) lines.push(`   ${m.member}: ${money(m.revA)} -> ${money(m.revB)}, change ${money(m.delta)} (${(m.share * 100).toFixed(0)}% of total change, z=${m.z.toFixed(1)}${isDriver(m) ? ", significant driver" : ""})`);
    }
  }
  return lines.join("\n");
}

export function queriesById(queries: EvidenceQuery[]): Map<string, EvidenceQuery> {
  return new Map(queries.map((q) => [q.id, q]));
}
