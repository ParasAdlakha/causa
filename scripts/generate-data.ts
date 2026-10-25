// Generates Causa's demo data: a synthetic wholesale distributor in the TPC-H
// schema (the ERP source) plus a CRM account-events source, 1995 to 1997.
// Deterministic (seeded), so every clone produces identical files.
//
// Three business stories are planted so there is something real to explain.
// The agent is never told about them; it has to find them in the data:
//   1. Germany, Q3 1996: three large automotive key accounts lost a tender and
//      stopped ordering at the end of June (CRM: contract_ended).
//   2. France, Q1 1997: a winter volume-discount programme raised discounts by
//      8 points; more units, less revenue per unit (CRM: price_renegotiated).
//   3. United States, 1997: two machinery customers won in December 1996 start
//      large monthly orders (CRM: new_contract).
// Everything else is background noise: Pareto-sized customers, seasonality,
// random CRM meetings, complaints and renewals.
//
//   npx tsx scripts/generate-data.ts
// writes data/seed/causa_seed.json.gz and docker/initdb/*.sql.gz

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED = 20261025;

// --- deterministic randomness ------------------------------------------------
let state = SEED >>> 0;
function rand(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const round2 = (n: number) => Math.round(n * 100) / 100;
function poisson(lambda: number): number {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > l);
  return k - 1;
}

// --- TPC-H reference data ------------------------------------------------------
const REGIONS = ["AFRICA", "AMERICA", "ASIA", "EUROPE", "MIDDLE EAST"];
const NATIONS: [string, number][] = [
  ["ALGERIA", 0], ["ARGENTINA", 1], ["BRAZIL", 1], ["CANADA", 1], ["EGYPT", 4], ["ETHIOPIA", 0], ["FRANCE", 3], ["GERMANY", 3],
  ["INDIA", 2], ["INDONESIA", 2], ["IRAN", 4], ["IRAQ", 4], ["JAPAN", 2], ["JORDAN", 4], ["KENYA", 0], ["MOROCCO", 0],
  ["MOZAMBIQUE", 0], ["PERU", 1], ["CHINA", 2], ["ROMANIA", 3], ["SAUDI ARABIA", 4], ["VIETNAM", 2], ["RUSSIA", 3],
  ["UNITED KINGDOM", 3], ["UNITED STATES", 1],
];
const NK = Object.fromEntries(NATIONS.map(([n], i) => [n, i]));
const SEGMENTS = ["AUTOMOBILE", "BUILDING", "FURNITURE", "HOUSEHOLD", "MACHINERY"];
const PRIORITIES = ["1-URGENT", "2-HIGH", "3-MEDIUM", "4-NOT SPECIFIED", "5-LOW"];
const SHIPMODES = ["AIR", "FOB", "MAIL", "RAIL", "REG AIR", "SHIP", "TRUCK"];
const TYPE1 = ["STANDARD", "SMALL", "MEDIUM", "LARGE", "ECONOMY", "PROMO"];
const TYPE2 = ["ANODIZED", "BURNISHED", "PLATED", "POLISHED", "BRUSHED"];
const TYPE3 = ["TIN", "NICKEL", "BRASS", "STEEL", "COPPER"];
const MANAGERS = ["Anna Weber", "Luca Rossi", "Claire Martin", "Tom Becker", "Priya Shah", "Diego Santos", "Mei Lin", "Sam Carter"];

// Bigger economies buy more: weight per nation.
const NATION_WEIGHT: Record<string, number> = { "UNITED STATES": 3, GERMANY: 2.2, FRANCE: 2, "UNITED KINGDOM": 2, JAPAN: 2, CHINA: 2, INDIA: 1.5, BRAZIL: 1.4, CANADA: 1.3 };

const START = Date.UTC(1995, 0, 1);
const END = Date.UTC(1998, 0, 1);
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

// --- dimension tables ----------------------------------------------------------
const region = REGIONS.map((name, i) => [i, name]);
const nation = NATIONS.map(([name, r], i) => [i, name, r]);

const parts: { key: number; mfgr: number; brand: string; type: string; price: number }[] = [];
for (let k = 1; k <= 400; k++) {
  const mfgr = int(1, 5);
  parts.push({ key: k, mfgr, brand: `Brand#${mfgr}${int(1, 5)}`, type: `${pick(TYPE1)} ${pick(TYPE2)} ${pick(TYPE3)}`, price: round2((90000 + ((k / 10) % 20001) + 100 * (k % 1000)) / 100) });
}
const suppliers: { key: number; nation: number }[] = [];
for (let k = 1; k <= 60; k++) suppliers.push({ key: k, nation: int(0, 24) });

interface Customer {
  key: number;
  name: string;
  nation: number;
  segment: string;
  size: number; // relative ordering intensity
  manager: string;
  tier: "key" | "standard";
  activeFrom: number;
  activeTo: number;
}
const customers: Customer[] = [];
const nationPool = NATIONS.flatMap(([n]) => Array(Math.round((NATION_WEIGHT[n] ?? 1) * 10)).fill(NK[n]));
const addCustomer = (c: Omit<Customer, "key" | "name" | "manager"> & { manager?: string }): Customer => {
  const key = customers.length + 1;
  const cust: Customer = { key, name: `Customer#${String(key).padStart(9, "0")}`, manager: c.manager ?? pick(MANAGERS), ...c };
  customers.push(cust);
  return cust;
};
for (let i = 0; i < 1500; i++) {
  const size = Math.min(6, Math.exp(rand() * 1.6 - 0.8)); // log-uniform 0.45x..2.2x, a few larger
  addCustomer({ nation: pick(nationPool), segment: pick(SEGMENTS), size, tier: size > 1.8 ? "key" : "standard", activeFrom: START, activeTo: END });
}

// Story 1: German automotive key accounts, lost at the end of June 1996.
const LOST = Date.UTC(1996, 6, 1);
const germanKeys = [0, 1, 2].map(() => addCustomer({ nation: NK.GERMANY, segment: "AUTOMOBILE", size: 9, tier: "key", activeFrom: START, activeTo: LOST, manager: "Anna Weber" }));
// Story 3: US machinery customers won in December 1996.
const WON = Date.UTC(1997, 0, 1);
const usWins = [0, 1].map(() => addCustomer({ nation: NK["UNITED STATES"], segment: "MACHINERY", size: 10, tier: "key", activeFrom: WON, activeTo: END, manager: "Sam Carter" }));

// --- orders and line items ------------------------------------------------------
const orders: unknown[][] = [];
const lineitem: unknown[][] = [];
const FR_PROMO = [Date.UTC(1997, 0, 1), Date.UTC(1997, 3, 1)];
let orderkey = 0;
const BASE_ORDERS_PER_QUARTER = 2.0;

for (const c of customers) {
  for (let q = START; q < END; q = Date.UTC(new Date(q).getUTCFullYear(), new Date(q).getUTCMonth() + 3, 1)) {
    const qEnd = Date.UTC(new Date(q).getUTCFullYear(), new Date(q).getUTCMonth() + 3, 1);
    if (qEnd <= c.activeFrom || q >= c.activeTo) continue;
    const season = new Date(q).getUTCMonth() === 9 ? 1.1 : 1; // Q4 a little busier
    const n = poisson(BASE_ORDERS_PER_QUARTER * c.size * season);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(q, c.activeFrom);
      const hi = Math.min(qEnd, c.activeTo);
      const date = lo + Math.floor(rand() * ((hi - lo) / DAY)) * DAY;
      const key = ++orderkey;
      const frPromo = c.nation === NK.FRANCE && date >= FR_PROMO[0] && date < FR_PROMO[1];
      let total = 0;
      const lines = int(1, 6);
      for (let ln = 1; ln <= lines; ln++) {
        const p = pick(parts);
        let qty = int(1, 50);
        let disc = int(0, 10) / 100;
        if (frPromo) {
          qty = Math.round(qty * 1.15);
          disc = Math.min(0.2, disc + 0.08);
        }
        const ext = round2(qty * p.price);
        total += ext * (1 - disc);
        lineitem.push([key, p.key, pick(suppliers).key, ln, qty, ext, disc, rand() < 0.08 ? "R" : "N", pick(SHIPMODES)]);
      }
      orders.push([key, c.key, iso(date), pick(PRIORITIES), round2(total)]);
    }
  }
}

// --- CRM ---------------------------------------------------------------------------
const events: unknown[][] = [];
const ev = (c: Customer, t: number, type: string, summary: string) => events.push([events.length + 1, c.key, iso(t), type, summary, c.manager]);
const NOISE = [
  ["meeting", "Quarterly business review."],
  ["meeting", "Site visit with purchasing."],
  ["complaint", "Late delivery on two order lines."],
  ["complaint", "Invoice dispute, resolved."],
  ["renewal", "Annual supply agreement renewed on unchanged terms."],
  ["support", "Requested updated price list."],
];
for (let i = 0; i < 900; i++) {
  const c = pick(customers);
  const [type, summary] = pick(NOISE);
  ev(c, START + Math.floor(rand() * ((END - START) / DAY)) * DAY, type, summary);
}
for (const c of germanKeys) {
  ev(c, Date.UTC(1996, 2, 12), "complaint", "Escalation: repeated late deliveries on fleet parts; customer reviewing suppliers.");
  ev(c, Date.UTC(1996, 4, 20), "tender", "Annual fleet-parts tender opened; we submitted a bid.");
  ev(c, Date.UTC(1996, 5, 28), "contract_ended", "Lost the annual fleet-parts tender to a lower-cost competitor. Final deliveries end of June; no orders expected from July.");
}
const french = customers.filter((c) => c.nation === NK.FRANCE).sort((a, b) => b.size - a.size).slice(0, 8);
for (const c of french) ev(c, Date.UTC(1996, 11, 10), "price_renegotiated", "Enrolled in the winter volume-discount programme: extra 8% off all lines from January to March 1997, in exchange for higher volumes.");
for (const c of usWins) {
  ev(c, Date.UTC(1996, 10, 5), "tender", "Bid on the multi-year maintenance-parts contract.");
  ev(c, Date.UTC(1996, 11, 18), "new_contract", "Won the multi-year maintenance-parts contract. Large monthly orders start in January 1997.");
}

const accounts = customers.map((c) => [c.key, c.manager, c.tier]);

// --- write --------------------------------------------------------------------------
const tables = {
  erp: {
    region: { columns: ["r_regionkey", "r_name"], types: ["integer", "varchar(25)"], rows: region },
    nation: { columns: ["n_nationkey", "n_name", "n_regionkey"], types: ["integer", "varchar(25)", "integer"], rows: nation },
    customer: {
      columns: ["c_custkey", "c_name", "c_nationkey", "c_mktsegment"],
      types: ["integer", "varchar(25)", "integer", "varchar(10)"],
      rows: customers.map((c) => [c.key, c.name, c.nation, c.segment]),
    },
    part: {
      columns: ["p_partkey", "p_mfgr", "p_brand", "p_type", "p_retailprice"],
      types: ["integer", "varchar(25)", "varchar(10)", "varchar(25)", "numeric(12,2)"],
      rows: parts.map((p) => [p.key, `Manufacturer#${p.mfgr}`, p.brand, p.type, p.price]),
    },
    supplier: { columns: ["s_suppkey", "s_name", "s_nationkey"], types: ["integer", "varchar(25)", "integer"], rows: suppliers.map((s) => [s.key, `Supplier#${String(s.key).padStart(9, "0")}`, s.nation]) },
    orders: { columns: ["o_orderkey", "o_custkey", "o_orderdate", "o_orderpriority", "o_totalprice"], types: ["integer", "integer", "date", "varchar(15)", "numeric(14,2)"], rows: orders },
    lineitem: {
      columns: ["l_orderkey", "l_partkey", "l_suppkey", "l_linenumber", "l_quantity", "l_extendedprice", "l_discount", "l_returnflag", "l_shipmode"],
      types: ["integer", "integer", "integer", "integer", "numeric(12,2)", "numeric(14,2)", "numeric(4,2)", "char(1)", "varchar(10)"],
      rows: lineitem,
    },
  },
  crm: {
    accounts: { columns: ["c_custkey", "account_manager", "tier"], types: ["integer", "varchar(40)", "varchar(10)"], rows: accounts },
    account_events: {
      columns: ["event_id", "c_custkey", "event_date", "event_type", "summary", "account_manager"],
      types: ["integer", "integer", "date", "varchar(20)", "varchar(200)", "varchar(40)"],
      rows: events.sort((a, b) => String(a[2]).localeCompare(String(b[2]))).map((e, i) => [i + 1, ...e.slice(1)]),
    },
  },
};

fs.mkdirSync(path.join(ROOT, "data", "seed"), { recursive: true });
const seedFile = path.join(ROOT, "data", "seed", "causa_seed.json.gz");
fs.writeFileSync(seedFile, zlib.gzipSync(JSON.stringify({ generated_by: "scripts/generate-data.ts", seed: SEED, range: [iso(START), iso(END)], sources: tables })));

// Postgres init scripts: one database per source, loaded with COPY.
fs.mkdirSync(path.join(ROOT, "docker", "initdb"), { recursive: true });
const copyValue = (v: unknown) => (v === null || v === undefined ? "\\N" : String(v).replace(/\\/g, "\\\\").replace(/\t/g, " ").replace(/\n/g, " "));
for (const [db, ts] of Object.entries(tables)) {
  const out: string[] = [];
  if (db !== "erp") out.push(`CREATE DATABASE ${db};`, `\\connect ${db}`);
  for (const [name, t] of Object.entries(ts)) {
    out.push(`CREATE TABLE ${name} (${t.columns.map((c, i) => `${c} ${t.types[i]}`).join(", ")});`);
    out.push(`COPY ${name} (${t.columns.join(", ")}) FROM stdin;`);
    for (const r of t.rows as unknown[][]) out.push(r.map(copyValue).join("\t"));
    out.push("\\.");
  }
  fs.writeFileSync(path.join(ROOT, "docker", "initdb", `${db === "erp" ? "01" : "02"}_${db}.sql.gz`), zlib.gzipSync(out.join("\n") + "\n"));
}

console.log(`customers ${customers.length}, orders ${orders.length}, line items ${lineitem.length}, CRM events ${events.length}`);
console.log(`wrote ${path.relative(ROOT, seedFile)} (${(fs.statSync(seedFile).size / 1e6).toFixed(2)} MB) and docker/initdb/*.sql.gz`);
