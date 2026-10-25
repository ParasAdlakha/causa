// Types the agents pass to each other, and the TPC-H vocabulary they reason over.

import type { DimensionId, EvidenceQuery, Filter, Period, Totals } from "../analysis.ts";
import type { Recalled } from "../engines/hmem.ts";

export const NATIONS = [
  "ALGERIA", "ARGENTINA", "BRAZIL", "CANADA", "EGYPT", "ETHIOPIA", "FRANCE", "GERMANY", "INDIA", "INDONESIA",
  "IRAN", "IRAQ", "JAPAN", "JORDAN", "KENYA", "MOROCCO", "MOZAMBIQUE", "PERU", "CHINA", "ROMANIA",
  "SAUDI ARABIA", "VIETNAM", "RUSSIA", "UNITED KINGDOM", "UNITED STATES",
];
export const REGIONS = ["AFRICA", "AMERICA", "ASIA", "EUROPE", "MIDDLE EAST"];
export const SEGMENTS = ["AUTOMOBILE", "BUILDING", "FURNITURE", "HOUSEHOLD", "MACHINERY"];
export const SHIP_MODES = ["AIR", "FOB", "MAIL", "RAIL", "REG AIR", "SHIP", "TRUCK"];
export const DATA_RANGE = { start: "1995-01-01", end: "1998-01-01" };

export type Mode = "model" | "offline";

export interface Hypothesis {
  dimension: DimensionId;
  why: string;
}

export interface Plan {
  question: string;
  focus: Filter[];
  focusLabel: string;
  periodA: Period;
  periodB: Period;
  hypotheses: Hypothesis[];
  recalled: Recalled[];
  mode: Mode;
}

export interface Claim {
  id: string;
  text: string;
  evidence: string[]; // query ids, e.g. ["Q3"]
  dimension?: DimensionId;
  member?: string;
  kind: "overall" | "price_volume" | "baseline" | "driver" | "ruled_out" | "drilldown" | "context";
}

export interface Draft {
  summary: string;
  claims: Claim[];
  mode: Mode;
}

export interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

export interface Request {
  kind: "baseline" | "breakdown" | "drill" | "crm";
  dimension?: DimensionId;
  filter?: Filter;
  customers?: string[];
  reason: string;
}

export interface Critique {
  round: number;
  verdict: "approve" | "revise";
  checks: Check[];
  issues: string[];
  requests: Request[];
  mode: Mode;
}

export interface Report {
  markdown: string;
  headline: string;
  confidence: number;
  confidenceReason: string;
  mode: Mode;
}

export interface Context {
  plan: Plan;
  totals?: Totals;
  totalsId?: string;
  baseline?: Totals;
  baselineId?: string;
  queries: EvidenceQuery[];
}

export function focusLabel(focus: Filter[]): string {
  if (!focus.length) return "the whole company";
  return focus.map((f) => titleCase(f.value)).join(" / ");
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
