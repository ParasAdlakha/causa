// Packs each real example run (output_examples/<name>.json + .trace.jsonl) into
// docs/app/runs/<name>.json for the replay page on the project site, which plays
// a recorded run back in Causa's UI. Replays only; the app never reads these.
//   npx tsx scripts/export-replays.ts

import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const src = path.join(root, "output_examples");
const out = path.join(root, "docs", "app", "runs");
fs.mkdirSync(out, { recursive: true });

const index: { name: string; question: string; confidence: number; queries: number; duration_ms: number; models: string[] }[] = [];
for (const f of fs.readdirSync(src).filter((f) => f.endsWith(".json")).sort()) {
  const name = f.replace(/\.json$/, "");
  const result = JSON.parse(fs.readFileSync(path.join(src, f), "utf-8"));
  const events = fs.readFileSync(path.join(src, `${name}.trace.jsonl`), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify({ result, events }));
  index.push({ name, question: result.question, confidence: result.report?.confidence ?? 0, queries: result.evidence.length, duration_ms: result.duration_ms, models: result.models_used });
}
fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(index, null, 1));
console.log(`exported ${index.length} runs to docs/app/runs`);
