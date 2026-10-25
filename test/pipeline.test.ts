// End-to-end tests of the investigation pipeline. They run in SAMPLE_MODE with
// the rule-based agents (no Zetaris, Nightshift or keys) and a throwaway H-MEM
// directory, so they are fast and repeatable. The same agents, SQL and memory
// code run in live mode.

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const memDir = fs.mkdtempSync(path.join(os.tmpdir(), "causa-hmem-"));
process.env.SAMPLE_MODE = "true";
process.env.CAUSA_OFFLINE = "true";
process.env.CAUSA_MEMORY_DIR = memDir;

const { investigate, memory } = await import("../src/investigate.ts");
const { warehouse } = await import("../src/data/warehouse.ts");
type Investigation = Awaited<ReturnType<typeof investigate>>;

const GERMANY = "Why did revenue in Germany drop in Q3 1996 compared with Q3 1995?";
const FRANCE = "Why did revenue per unit fall in France in Q1 1997 compared with Q1 1996?";
let germany: Investigation;
let france: Investigation;

before(async () => {
  germany = await investigate(GERMANY);
  france = await investigate(FRANCE);
});
after(() => fs.rmSync(memDir, { recursive: true, force: true }));

const readTrace = (r: Investigation) =>
  fs.readFileSync(path.join(import.meta.dirname, "..", r.log_path), "utf-8").trim().split("\n").map((l) => JSON.parse(l));

test("the investigation finds the planted Germany story from the data", () => {
  assert.equal(germany.status, "success");
  assert.equal(germany.data_source, "sample");
  const md = germany.report!.markdown;
  assert.match(md, /automobile/i, "names the segment that drove the drop");
  assert.match(md, /contract ended/i, "cites the CRM events behind it");
  assert.match(md, /\[Q\d+\]/, "every figure is cited to a query");
});

test("anti-hardcoding: report totals equal an independent SQL query on the data", async () => {
  const wh = warehouse();
  const sql = `SELECT SUM(l.l_extendedprice * (1 - l.l_discount))
    FROM ${wh.table("lineitem")} l
    JOIN ${wh.table("orders")} o ON o.o_orderkey = l.l_orderkey
    JOIN ${wh.table("customer")} c ON c.c_custkey = o.o_custkey
    JOIN ${wh.table("nation")} n ON n.n_nationkey = c.c_nationkey
    WHERE n.n_name = 'GERMANY' AND o.o_orderdate >= '1996-07-01' AND o.o_orderdate < '1996-10-01'`;
  const independent = Number((await wh.query(sql)).rows[0][0]);
  assert.ok(Math.abs(independent - germany.totals!.revB) < 1, `${independent} vs ${germany.totals!.revB}`);
});

test("anti-hardcoding: different questions give different, data-derived answers", () => {
  assert.equal(france.status, "success");
  assert.notEqual(germany.report!.headline, france.report!.headline);
  assert.notEqual(germany.totals!.delta, france.totals!.delta);
  // France's planted story: a discount programme sold more units at less revenue per unit.
  const t = france.totals!;
  assert.ok(t.priceB < t.priceA, "revenue per unit fell");
  assert.ok(t.priceEffect < 0 && t.volumeEffect > 0, "price pulled down while volume pulled up");
  assert.match(france.report!.markdown, /price renegotiated/i, "cites the CRM discount events");
});

test("a control question with no planted cause is not reported with high confidence", async () => {
  const japan = await investigate("Why did revenue in Japan change in Q2 1996 compared with Q2 1995?");
  assert.equal(japan.status, "success");
  assert.ok(japan.report!.confidence <= 0.75, `confidence ${japan.report!.confidence}`);
  assert.ok(germany.report!.confidence > japan.report!.confidence, "a corroborated cause scores higher than an unexplained one");
  assert.match(japan.report!.confidenceReason, /cause is not established/);
});

test("anti-hardcoding: runtime code never reads the example outputs", () => {
  const src = path.join(import.meta.dirname, "..", "src");
  const files = fs.readdirSync(src, { recursive: true }).map(String).filter((f) => f.endsWith(".ts"));
  const code = (f: string) => fs.readFileSync(path.join(src, f), "utf-8").replace(/^\s*\/\/.*$/gm, "");
  for (const f of files) assert.doesNotMatch(code(f), /output_examples/, f);
});

test("the trace shows 3+ agents, a critique, handoffs and every query", () => {
  const events = readTrace(germany);
  const agents = new Set(events.map((e) => e.agent).filter((a: string) => a.endsWith("Agent")));
  assert.ok(agents.size >= 3, [...agents].join(", "));
  for (const a of ["PlannerAgent", "AnalystAgent", "CriticAgent", "ReporterAgent"]) assert.ok(agents.has(a), a);
  assert.ok(events.some((e) => e.agent === "CriticAgent" && /request_revision|approve/.test(e.action)), "critic verdict");
  assert.ok(events.filter((e) => e.target_agent).length >= 3, "handoffs between agents");
  assert.equal(events.filter((e) => /^query_/.test(e.action)).length, germany.evidence.length, "one trace event per query");
  for (const e of events) for (const k of ["timestamp", "trace_id", "step", "agent", "action", "status"]) assert.ok(k in e, `${k} in step ${e.step}`);
  assert.ok(germany.collaboration.feedback_loop_completed);
});

test("H-MEM: a finding is remembered, recalled by the next plan, and moves its hypotheses", async () => {
  assert.equal(germany.memory.stored.length, 1);
  const stored = memory().all().find((m) => m.id === germany.memory.stored[0])!;
  assert.ok(stored.tags.includes("driver:customer_segment"), stored.tags.join(", "));

  const followUp = await investigate("Why did revenue in Germany change in Q4 1996 compared with Q4 1995?");
  assert.ok(followUp.memory.recalled.includes(germany.memory.stored[0]), "the follow-up recalls the Germany finding");
  const first = followUp.plan!.hypotheses[0];
  assert.equal(first.dimension, "customer_segment", "the dimension that explained the earlier drop is tested first");
  assert.match(first.why, /recalled from memory/);
  assert.ok(readTrace(followUp).some((e) => e.action === "hmem_recall" && /recalled mem-/.test(e.output_summary)));
});

test("H-MEM: feedback on an answer changes the memory's confidence", () => {
  const id = germany.memory.stored[0];
  const before = memory().all().find((m) => m.id === id)!.confidence;
  memory().feedback([id], "wrong");
  const afterFeedback = memory().all().find((m) => m.id === id)!.confidence;
  assert.ok(afterFeedback < before, `${afterFeedback} < ${before}`);
  assert.ok(memory().history(id).length >= 2, "the trust ledger records the change");
});
