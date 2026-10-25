// PlannerAgent: turns the analyst's question into a testable plan: which slice
// of the business (focus), which two periods to compare, and which hypotheses
// (dimensions) to test first. It recalls past investigations from H-MEM and
// uses them to reorder its hypotheses. On the model path Nemotron writes the
// plan through Nightshift; the offline path parses the question with rules.

import { DIMENSIONS, DIMENSION_IDS, type DimensionId, type Filter, type Period } from "../analysis.ts";
import type { InvestigationMemory, Recalled } from "../engines/hmem.ts";
import { chatJson } from "../llm.ts";
import type { Trace } from "../trace.ts";
import { DATA_RANGE, NATIONS, REGIONS, SEGMENTS, focusLabel, type Hypothesis, type Mode, type Plan } from "./shared.ts";

const AGENT = "PlannerAgent";
const DEFAULT_ORDER: DimensionId[] = ["customer_segment", "part_brand", "ship_mode", "order_priority", "supplier_nation", "customer_nation", "customer"];

export async function plan(question: string, mode: Mode, memory: InvestigationMemory, trace: Trace): Promise<Plan> {
  trace.log({ agent: AGENT, action: "receive_question", status: "info", input_summary: question });
  const recalled = memory.recall(question, trace, AGENT);

  if (mode === "model") {
    try {
      const p = await modelPlan(question, recalled, trace);
      trace.log({ agent: AGENT, action: "delegate_plan", target_agent: "AnalystAgent", status: "success", output_summary: describe(p) });
      return p;
    } catch (err) {
      trace.log({ agent: AGENT, action: "model_plan_failed", status: "fallback", output_summary: `${(err as Error).message}; using rule-based planning` });
    }
  }
  const p = rulePlan(question, recalled);
  trace.log({ agent: AGENT, action: "delegate_plan", target_agent: "AnalystAgent", status: "success", output_summary: describe(p) });
  return p;
}

function describe(p: Plan): string {
  return `${p.focusLabel}: ${p.periodA.label} vs ${p.periodB.label}; test ${p.hypotheses.map((h) => h.dimension).join(", ")}`;
}

async function modelPlan(question: string, recalled: Recalled[], trace: Trace): Promise<Plan> {
  const dims = DIMENSION_IDS.map((d) => `- ${d}: ${DIMENSIONS[d].label}`).join("\n");
  const memories = recalled.length ? recalled.map((m) => `- [${m.id}] ${m.content}`).join("\n") : "(none)";
  const system = `You plan revenue variance investigations over a wholesale distributor's order data (TPC-H schema, orders ${DATA_RANGE.start} to ${DATA_RANGE.end}).
Revenue = extended price x (1 - discount), by order date.
Reply with ONE JSON object only:
{"focus":[{"dimension":"customer_nation|customer_region|customer_segment","value":"..."}],
 "periodA":{"label":"...","start":"YYYY-MM-DD","end":"YYYY-MM-DD"},
 "periodB":{"label":"...","start":"YYYY-MM-DD","end":"YYYY-MM-DD"},
 "hypotheses":[{"dimension":"<id>","why":"<one short sentence>"}]}
Rules: periodA is the earlier comparison period, periodB the one being explained; end dates are exclusive. If the question names one period, compare it with the period of equal length just before it.
Focus values must be upper case and from: nations ${NATIONS.join(", ")}; regions ${REGIONS.join(", ")}; segments ${SEGMENTS.join(", ")}. Use an empty focus for company-wide questions.
Choose 3 to 5 hypotheses from these dimensions, most promising first, never a dimension already fixed by the focus:
${dims}
Past investigations recalled from memory (use them: test dimensions that explained earlier changes first, and say so in "why"):
${memories}`;
  const { value } = await chatJson(trace, AGENT, "plan_investigation", [
    { role: "system", content: system },
    { role: "user", content: question },
  ], (v) => validatePlan(v, question, recalled));
  return value;
}

function validatePlan(v: unknown, question: string, recalled: Recalled[]): Plan {
  const o = v as Record<string, any>;
  const focus: Filter[] = (Array.isArray(o.focus) ? o.focus : []).map((f: any) => {
    const dimension = String(f.dimension) as DimensionId;
    const value = String(f.value).toUpperCase();
    const allowed = dimension === "customer_nation" ? NATIONS : dimension === "customer_region" ? REGIONS : dimension === "customer_segment" ? SEGMENTS : null;
    if (!allowed) throw new Error(`focus dimension ${dimension} is not allowed`);
    if (!allowed.includes(value)) throw new Error(`focus value ${value} is not a valid ${dimension}`);
    return { dimension, value };
  });
  const periodA = validatePeriod(o.periodA, "periodA");
  const periodB = validatePeriod(o.periodB, "periodB");
  const fixed = new Set(focus.map((f) => f.dimension));
  const hypotheses: Hypothesis[] = (Array.isArray(o.hypotheses) ? o.hypotheses : [])
    .filter((h: any) => DIMENSION_IDS.includes(h.dimension) && !fixed.has(h.dimension))
    .slice(0, 5)
    .map((h: any) => ({ dimension: h.dimension as DimensionId, why: String(h.why ?? "") }));
  if (hypotheses.length < 2) throw new Error("need at least two valid hypotheses");
  return { question, focus, focusLabel: focusLabel(focus), periodA, periodB, hypotheses, recalled, mode: "model" };
}

function validatePeriod(p: any, name: string): Period {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!p || !re.test(p.start) || !re.test(p.end)) throw new Error(`${name} needs start and end as YYYY-MM-DD`);
  if (p.start >= p.end) throw new Error(`${name} start must be before end`);
  if (p.end <= DATA_RANGE.start || p.start >= DATA_RANGE.end) throw new Error(`${name} is outside the data (${DATA_RANGE.start} to ${DATA_RANGE.end})`);
  return { label: String(p.label || `${p.start} to ${p.end}`), start: p.start, end: p.end };
}

// ---- rule-based path (offline, and the fallback when the model fails) -------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const ALIASES: Record<string, string> = {
  "\\bUSA?\\b": "UNITED STATES", "\\bU\\.S\\.?\\b": "UNITED STATES", "\\bAMERICAN\\b": "UNITED STATES", "\\bUK\\b": "UNITED KINGDOM", "\\bBRITAIN\\b": "UNITED KINGDOM", "\\bBRITISH\\b": "UNITED KINGDOM",
  "\\bFRENCH\\b": "FRANCE", "\\bGERMAN\\b": "GERMANY", "\\bJAPANESE\\b": "JAPAN", "\\bCHINESE\\b": "CHINA", "\\bINDIAN\\b": "INDIA", "\\bBRAZILIAN\\b": "BRAZIL",
  "\\bCANADIAN\\b": "CANADA", "\\bRUSSIAN\\b": "RUSSIA", "\\bEGYPTIAN\\b": "EGYPT", "\\bPERUVIAN\\b": "PERU", "\\bKENYAN\\b": "KENYA", "\\bROMANIAN\\b": "ROMANIA",
};

export function rulePlan(question: string, recalled: Recalled[]): Plan {
  const focus = parseFocus(question);
  const [periodA, periodB] = parsePeriods(question);
  return { question, focus, focusLabel: focusLabel(focus), periodA, periodB, hypotheses: orderHypotheses(focus, recalled), recalled, mode: "offline" };
}

export function parseFocus(question: string): Filter[] {
  const q = ` ${question.toUpperCase()} `;
  const focus: Filter[] = [];
  const has = (name: string) => new RegExp(`\\b${name}\\b`).test(q);
  const nation = NATIONS.filter(has).sort((a, b) => b.length - a.length)[0] ?? Object.entries(ALIASES).find(([re]) => new RegExp(re).test(q))?.[1];
  if (nation) focus.push({ dimension: "customer_nation", value: nation });
  else {
    const region = REGIONS.find(has);
    if (region) focus.push({ dimension: "customer_region", value: region });
  }
  const segment = SEGMENTS.find(has);
  if (segment) focus.push({ dimension: "customer_segment", value: segment });
  return focus;
}

interface Span {
  start: string;
  end: string;
  label: string;
  months: number;
}

export function parsePeriods(question: string): [Period, Period] {
  const spans: { at: number; span: Span }[] = [];
  const q = question.toLowerCase();
  for (const m of q.matchAll(/\bq([1-4])\s*(?:of\s*)?(\d{4})\b|\b(\d{4})\s*q([1-4])\b/g)) {
    const quarter = Number(m[1] ?? m[4]);
    const year = Number(m[2] ?? m[3]);
    spans.push({ at: m.index!, span: monthSpan(year, (quarter - 1) * 3, 3, `Q${quarter} ${year}`) });
  }
  for (const m of q.matchAll(new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{4})\\b`, "g"))) {
    spans.push({ at: m.index!, span: monthSpan(Number(m[2]), MONTHS.indexOf(m[1]), 1, `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}`) });
  }
  const covered = (i: number) => spans.some((s) => i >= s.at && i < s.at + 14);
  for (const m of q.matchAll(/\b(199[5-7])\b/g)) {
    if (!covered(m.index!)) spans.push({ at: m.index!, span: monthSpan(Number(m[1]), 0, 12, m[1]) });
  }
  const ordered = spans.sort((a, b) => a.at - b.at).map((s) => s.span);
  if (ordered.length >= 2) {
    const [x, y] = ordered[0].start <= ordered[1].start ? [ordered[0], ordered[1]] : [ordered[1], ordered[0]];
    return [x, y];
  }
  const target = ordered[0] ?? monthSpan(1997, 9, 3, "Q4 1997");
  const prior = shift(target, -target.months);
  return [prior, target];
}

function monthSpan(year: number, month0: number, months: number, label: string): Span {
  const start = new Date(Date.UTC(year, month0, 1));
  const end = new Date(Date.UTC(year, month0 + months, 1));
  return { start: iso(start), end: iso(end), label, months };
}

function shift(s: Span, months: number): Span {
  const d = new Date(`${s.start}T00:00:00Z`);
  const year = d.getUTCFullYear();
  const month0 = d.getUTCMonth() + months;
  const start = new Date(Date.UTC(year, month0, 1));
  const label = s.months === 3 ? `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()}` : s.months === 12 ? String(start.getUTCFullYear()) : `${MONTHS[start.getUTCMonth()].replace(/^\w/, (c) => c.toUpperCase())} ${start.getUTCFullYear()}`;
  return monthSpan(start.getUTCFullYear(), start.getUTCMonth(), s.months, label);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function orderHypotheses(focus: Filter[], recalled: Recalled[]): Hypothesis[] {
  const fixed = new Set<DimensionId>(focus.map((f) => f.dimension));
  if (fixed.has("customer_nation")) fixed.add("customer_region");
  const strong = new Set(recalled.flatMap((m) => m.tags.filter((t) => t.startsWith("driver:")).map((t) => t.slice(7))));
  const weak = new Set(recalled.flatMap((m) => m.tags.filter((t) => t.startsWith("weak:")).map((t) => t.slice(5))));
  const order = DEFAULT_ORDER.filter((d) => !fixed.has(d));
  const rank = (d: DimensionId) => (strong.has(d) ? 0 : weak.has(d) ? 2 : 1);
  return order
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i)
    .slice(0, 5)
    .map(({ d }) => ({
      dimension: d,
      why: strong.has(d)
        ? `Explained an earlier change (recalled from memory), so test it first.`
        : weak.has(d)
          ? `Did not explain earlier changes (recalled from memory); tested last as a control.`
          : `Checks whether the change is concentrated in one ${DIMENSIONS[d].label}.`,
    }));
}
