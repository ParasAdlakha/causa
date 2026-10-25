// Runs the official Meterless H-MEM conformance suite against the engine Causa
// actually uses (src/engines/hmem.ts re-exports it). Exits non-zero on any failure.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const r = spawnSync("npx", ["tsx", "vendor/hmem/conformance/runner.ts"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, HMEM_IMPL: path.join(root, "src", "engines", "hmem.ts") },
});
process.exit(r.status ?? 1);
