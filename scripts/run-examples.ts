// Runs every question in input_examples/ through the real pipeline and writes
// the full result to output_examples/ under the same name. The outputs are a
// record of real runs; Causa never reads them at runtime.
//   npx tsx scripts/run-examples.ts [name ...]

import fs from "node:fs";
import path from "node:path";
import { investigate } from "../src/investigate.ts";

const root = path.join(import.meta.dirname, "..");
const inDir = path.join(root, "input_examples");
const outDir = path.join(root, "output_examples");
fs.mkdirSync(outDir, { recursive: true });

const only = process.argv.slice(2);
const files = fs.readdirSync(inDir).filter((f) => f.endsWith(".json") && (!only.length || only.some((o) => f.startsWith(o))));
for (const f of files) {
  const { question } = JSON.parse(fs.readFileSync(path.join(inDir, f), "utf-8")) as { question: string };
  console.log(`\n== ${f}: ${question}`);
  const result = await investigate(question, (e) => console.log(`  ${String(e.step).padStart(2)} ${e.agent}: ${e.action}${e.model ? ` [${e.model}]` : ""}`));
  fs.writeFileSync(path.join(outDir, f), JSON.stringify(result, null, 2));
  // logs/ is not committed, so the trace of each example run is kept beside its output.
  fs.copyFileSync(path.join(root, result.log_path), path.join(outDir, f.replace(/\.json$/, ".trace.jsonl")));
  fs.writeFileSync(path.join(outDir, f.replace(/\.json$/, ".md")), `# ${question}\n\n${result.report?.markdown ?? `Failed: ${result.error}`}\n\n---\ntrace: ${result.log_path} | ${result.evidence.length} queries on ${result.data_source} | models: ${result.models_used.join(", ") || "rule-based"} | ${(result.duration_ms / 1000).toFixed(0)} s\n`);
  console.log(`  -> ${result.status}, confidence ${result.report ? (result.report.confidence * 100).toFixed(0) + "%" : "-"}, ${(result.duration_ms / 1000).toFixed(0)} s`);
}
