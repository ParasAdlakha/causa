// Command-line entry point.
//   npx tsx src/cli.ts "Why did revenue from Germany drop in Q3 1996?"
//   npx tsx src/cli.ts --in input_examples/germany_q3_1996.json --out output_examples/germany_q3_1996.json
//   npx tsx src/cli.ts --status

import fs from "node:fs";
import { config } from "./config.ts";
import { warehouse } from "./data/warehouse.ts";
import { investigate } from "./investigate.ts";
import { providerStatus } from "./llm.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };

  if (args.includes("--status")) {
    const [data, ai] = await Promise.all([warehouse().status(), providerStatus()]);
    console.log(`mode:       ${config.sampleMode ? "SAMPLE_MODE" : "live"}`);
    console.log(`data layer: ${warehouse().kind} -> ${data.state}${data.detail ? ` (${data.detail})` : ""}`);
    console.log(`nightshift: ${config.meterless.baseUrl} -> ${ai.state}${ai.detail ? ` (${ai.detail})` : ""}`);
    if (ai.models.length) console.log(`routes:     ${ai.models.join(", ")}`);
    return;
  }

  const inFile = flag("--in");
  const question = inFile ? (JSON.parse(fs.readFileSync(inFile, "utf-8")) as { question: string }).question : args.filter((a, i) => !a.startsWith("--") && !["--out", "--in"].includes(args[i - 1])).join(" ");
  if (!question) {
    console.error('usage: npx tsx src/cli.ts "Why did revenue from Germany drop in Q3 1996?"');
    process.exit(1);
  }
  console.log(`\nQuestion: ${question}\n`);
  const result = await investigate(question);
  console.log("");
  if (result.status === "error") {
    console.error(`Investigation failed: ${result.error}`);
    process.exitCode = 1;
  } else {
    console.log(result.report!.markdown);
    console.log(`\n---\ntrace: ${result.log_path} | ${result.evidence.length} queries on ${result.data_source} | ${result.collaboration.revision_count} revision(s) | models: ${result.models_used.join(", ") || "none (rule-based)"} | ${(result.duration_ms / 1000).toFixed(1)}s`);
  }
  const out = flag("--out");
  if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
