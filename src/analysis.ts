// The analytical core. Agents decide WHAT to test; this module turns each test
// into SQL over the TPC-H schema, runs it through the warehouse, and computes
// the numbers (deltas, shares, price/volume split) so no figure in an answer
// is ever invented by a model.

import type { Warehouse } from "./data/warehouse.ts";
import type { Trace } from "./trace.ts";

export interface Period {
  label: string;
  start: string; // inclusive, YYYY-MM-DD
  end: string; // exclusive, YYYY-MM-DD
}

export interface Filter {
  dimension: DimensionId;
  value: string;
  exclude?: boolean; // true: everything except this value (used to test for confounding)
}

export const DIMENSIONS = {
  customer_region: { label: "customer region", expr: "cr.r_name", needs: ["customer", "cnation", "cregion"] },
  customer_nation: { label: "customer nation", expr: "cn.n_name", needs: ["customer", "cnation"] },
  customer_segment: { label: "customer market segment", expr: "c.c_mktsegment", needs: ["customer"] },
  customer: { label: "individual customer", expr: "c.c_name", needs: ["customer"] },
  order_priority: { label: "order priority", expr: "o.o_orderpriority", needs: [] },
  ship_mode: { label: "shipping mode", expr: "l.l_shipmode", needs: [] },
  return_flag: { label: "return status (R = returned)", expr: "l.l_returnflag", needs: [] },
  part_manufacturer: { label: "part manufacturer", expr: "p.p_mfgr", needs: ["part"] },
  part_brand: { label: "part brand", expr: "p.p_brand", needs: ["part"] },
  part_type: { label: "part type", expr: "p.p_type", needs: ["part"] },
  supplier_nation: { label: "supplier nation", expr: "sn.n_name", needs: ["supplier", "snation"] },
} as const;

export type DimensionId = keyof typeof DIMENSIONS;
export const DIMENSION_IDS = Object.keys(DIMENSIONS) as DimensionId[];

export const REVENUE = "l.l_extendedprice * (1 - l.l_discount)";

export interface EvidenceQuery {
  id: string;
  purpose: string;
  kind: "totals" | "baseline" | "breakdown" | "crm";
  dimension?: DimensionId;
  filters: Filter[];
  sql: string;
  columns: string[];
  rows: unknown[][];
  ms: number;
  requestedBy: string;
  compared?: number; // breakdowns: how many values were compared (rows keep only the largest movers)
}

export interface Totals {
  revA: number;
  revB: number;
  delta: number;
  pct: number;
  ordersA: number;
  ordersB: number;
  qtyA: number;
  qtyB: number;
  priceA: number; // net revenue per unit
  priceB: number;
  volumeEffect: number; // change explained by units sold
  priceEffect: number; // change explained by net price per unit (incl. discount)
}

export interface Member {
  member: string;
  revA: number;
  revB: number;
  delta: number;
  share: number; // of the total change; >1 or <0 when members move against the total
  ordersA: number;
  ordersB: number;
  expected: number; // change if this value had followed the overall trend
  z: number; // gap from the overall trend, in standard deviations of its own random variation
  zNeeded: number; // significance bar for this comparison
}

// Revenue in a slice is a sum of line items. Treating line items as independent
// (a compound Poisson process), the variance of a period's sum is the sum of
// squared line revenues, so a change can be compared with its own noise level.
// Testing many values at once makes a large z likely by chance, so the bar
// rises with the number of values compared (a Bonferroni correction at 1%).
export const DRIVER_SHARE = 0.3;
export function zThreshold(valuesCompared: number): number {
  return Math.max(3.5, inverseNormal(1 - 0.005 / Math.max(1, valuesCompared)));
}
export function isDriver(m: Member): boolean {
  return m.share >= DRIVER_SHARE && Math.abs(m.z) >= m.zNeeded;
}

// Acklam's rational approximation of the standard normal quantile.
function inverseNormal(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

export class Evidence {
  readonly queries: EvidenceQuery[] = [];

  constructor(
    private wh: Warehouse,
    private trace: Trace,
    private maxQueries: number,
  ) {}

  get count(): number {
    return this.queries.length;
  }

  get(id: string): EvidenceQuery | undefined {
    return this.queries.find((q) => q.id === id);
  }

  async run(requestedBy: string, purpose: string, kind: EvidenceQuery["kind"], sql: string, filters: Filter[], dimension?: DimensionId): Promise<EvidenceQuery> {
    if (this.queries.length >= this.maxQueries) throw new Error(`query budget of ${this.maxQueries} reached`);
    const id = `Q${this.queries.length + 1}`;
    const started = Date.now();
    try {
      const res = await this.wh.query(sql);
      const { columns } = res;
      let rows = res.rows;
      let compared: number | undefined;
      if (kind === "breakdown") {
        // Every value is compared (it sets the significance bar); only the 12 largest movers are kept as evidence.
        compared = rows.length;
        rows = [...rows].sort((a, b) => Math.abs(Number(b[2]) - Number(b[1])) - Math.abs(Number(a[2]) - Number(a[1]))).slice(0, 12);
      }
      const q: EvidenceQuery = { id, purpose, kind, dimension, filters, sql, columns, rows, ms: Date.now() - started, requestedBy, compared };
      this.queries.push(q);
      this.trace.log({
        agent: requestedBy,
        action: `query_${this.wh.kind}`,
        query_id: id,
        duration_ms: q.ms,
        status: "success",
        input_summary: purpose,
        output_summary: `${id}: ${rows.length} rows from ${this.wh.kind === "zetaris" ? "Zetaris" : "sample data"}`,
        detail: { sql },
      });
      return q;
    } catch (err) {
      this.trace.log({ agent: requestedBy, action: `query_${this.wh.kind}`, status: "error", input_summary: purpose, output_summary: (err as Error).message.slice(0, 200), detail: { sql } });
      throw err;
    }
  }
}

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

function inPeriod(p: Period): string {
  return `o.o_orderdate >= ${lit(p.start)} AND o.o_orderdate < ${lit(p.end)}`;
}

function fromClause(wh: Warehouse, needs: Set<string>): string {
  const parts = [`${wh.table("lineitem")} l`, `JOIN ${wh.table("orders")} o ON l.l_orderkey = o.o_orderkey`];
  if (needs.has("customer") || needs.has("cnation") || needs.has("cregion")) parts.push(`JOIN ${wh.table("customer")} c ON o.o_custkey = c.c_custkey`);
  if (needs.has("cnation") || needs.has("cregion")) parts.push(`JOIN ${wh.table("nation")} cn ON c.c_nationkey = cn.n_nationkey`);
  if (needs.has("cregion")) parts.push(`JOIN ${wh.table("region")} cr ON cn.n_regionkey = cr.r_regionkey`);
  if (needs.has("part")) parts.push(`JOIN ${wh.table("part")} p ON l.l_partkey = p.p_partkey`);
  if (needs.has("supplier") || needs.has("snation")) parts.push(`JOIN ${wh.table("supplier")} s ON l.l_suppkey = s.s_suppkey`);
  if (needs.has("snation")) parts.push(`JOIN ${wh.table("nation")} sn ON s.s_nationkey = sn.n_nationkey`);
  return parts.join("\n  ");
}

function whereClause(a: Period, b: Period, filters: Filter[]): string {
  const conds = [`((${inPeriod(a)}) OR (${inPeriod(b)}))`];
  for (const f of filters) conds.push(`${DIMENSIONS[f.dimension].expr} ${f.exclude ? "<>" : "="} ${lit(f.value)}`);
  return conds.join("\n  AND ");
}

function needsFor(filters: Filter[], dimension?: DimensionId): Set<string> {
  const needs = new Set<string>();
  for (const f of filters) for (const n of DIMENSIONS[f.dimension].needs) needs.add(n);
  if (dimension) for (const n of DIMENSIONS[dimension].needs) needs.add(n);
  return needs;
}

export function totalsSql(wh: Warehouse, a: Period, b: Period, filters: Filter[]): string {
  const ra = `CASE WHEN ${inPeriod(a)} THEN ${REVENUE} ELSE 0 END`;
  const rb = `CASE WHEN ${inPeriod(b)} THEN ${REVENUE} ELSE 0 END`;
  return `SELECT
  SUM(${ra}) AS revenue_a,
  SUM(${rb}) AS revenue_b,
  COUNT(DISTINCT CASE WHEN ${inPeriod(a)} THEN o.o_orderkey END) AS orders_a,
  COUNT(DISTINCT CASE WHEN ${inPeriod(b)} THEN o.o_orderkey END) AS orders_b,
  SUM(CASE WHEN ${inPeriod(a)} THEN l.l_quantity ELSE 0 END) AS units_a,
  SUM(CASE WHEN ${inPeriod(b)} THEN l.l_quantity ELSE 0 END) AS units_b
FROM ${fromClause(wh, needsFor(filters))}
WHERE ${whereClause(a, b, filters)}`;
}

export function breakdownSql(wh: Warehouse, a: Period, b: Period, filters: Filter[], dimension: DimensionId, limit = 5000): string {
  const expr = DIMENSIONS[dimension].expr;
  return `SELECT
  ${expr} AS member,
  SUM(CASE WHEN ${inPeriod(a)} THEN ${REVENUE} ELSE 0 END) AS revenue_a,
  SUM(CASE WHEN ${inPeriod(b)} THEN ${REVENUE} ELSE 0 END) AS revenue_b,
  COUNT(DISTINCT CASE WHEN ${inPeriod(a)} THEN o.o_orderkey END) AS orders_a,
  COUNT(DISTINCT CASE WHEN ${inPeriod(b)} THEN o.o_orderkey END) AS orders_b,
  SUM(CASE WHEN ${inPeriod(a)} THEN (${REVENUE}) * (${REVENUE}) ELSE 0 END) AS sumsq_a,
  SUM(CASE WHEN ${inPeriod(b)} THEN (${REVENUE}) * (${REVENUE}) ELSE 0 END) AS sumsq_b
FROM ${fromClause(wh, needsFor(filters, dimension))}
WHERE ${whereClause(a, b, filters)}
GROUP BY ${expr}
LIMIT ${limit}`;
}

// CRM account events for the customers in focus (or a named list of them), from
// a quarter before the comparison until its end. A cross-source join: events
// live in the CRM database, customers in the ERP database.
export const CRM_NOISE = ["meeting", "support"];
export function crmSql(wh: Warehouse, a: Period, b: Period, filters: Filter[], customers: string[] = [], limit = 25): string {
  const from = new Date(`${a.start}T00:00:00Z`);
  const customerFilters = filters.filter((f) => f.dimension.startsWith("customer"));
  const needs = needsFor(customerFilters);
  needs.add("customer");
  const joins = fromClause(wh, needs).split("\n  ").filter((j) => !/lineitem|orders/.test(j)).map((j) => j.replace(/ ON o\.o_custkey = c\.c_custkey/, " ON e.c_custkey = c.c_custkey"));
  const conds = [`e.event_date >= ${lit(from.toISOString().slice(0, 10))}`, `e.event_date < ${lit(b.end)}`, `e.event_type NOT IN (${CRM_NOISE.map(lit).join(", ")})`];
  for (const f of customerFilters) conds.push(`${DIMENSIONS[f.dimension].expr} = ${lit(f.value)}`);
  if (customers.length) conds.push(`c.c_name IN (${customers.map(lit).join(", ")})`);
  return `SELECT c.c_name AS customer, e.event_date, e.event_type, e.summary, e.account_manager
FROM ${wh.table("account_events")} e
  ${joins.join("\n  ")}
WHERE ${conds.join("\n  AND ")}
ORDER BY e.event_date
LIMIT ${limit}`;
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export function readTotals(q: EvidenceQuery): Totals {
  // Columns are read by position: totalsSql fixes their order.
  const row = q.rows[0] ?? [];
  const [revA, revB, ordersA, ordersB, qtyA, qtyB] = [0, 1, 2, 3, 4, 5].map((i) => num(row[i]));
  const priceA = qtyA ? revA / qtyA : 0;
  const priceB = qtyB ? revB / qtyB : 0;
  return {
    revA,
    revB,
    delta: revB - revA,
    pct: revA ? (revB - revA) / revA : 0,
    ordersA,
    ordersB,
    qtyA,
    qtyB,
    priceA,
    priceB,
    // Standard price/volume split: volume at old price, price change on new volume.
    volumeEffect: (qtyB - qtyA) * priceA,
    priceEffect: (priceB - priceA) * qtyB,
  };
}

// trendPct: the overall rate of change; a value is only a driver if it moves
// significantly differently from it (a uniform seasonal dip explains nothing).
export function readMembers(q: EvidenceQuery, totalDelta: number, trendPct = 0): Member[] {
  const zNeeded = zThreshold(q.compared ?? q.rows.length);
  return q.rows.map((r) => {
    const revA = num(r[1]);
    const revB = num(r[2]);
    const delta = revB - revA;
    const sd = Math.sqrt(num(r[5]) + num(r[6]));
    const expected = revA * trendPct;
    return { member: String(r[0]), revA, revB, delta, share: totalDelta ? delta / totalDelta : 0, ordersA: num(r[3]), ordersB: num(r[4]), expected, z: sd ? (delta - expected) / sd : 0, zNeeded };
  });
}

export function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
}
