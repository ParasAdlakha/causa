// Registers the ERP and CRM Postgres databases (docker-compose.yml) in Zetaris
// by running scripts/register_zetaris_sources.sql, then checks a federated
// query across both. Safe to re-run: what already exists is left alone.
//   npm run zetaris:register

import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.ts";
import { zetarisSql } from "../src/data/zetaris.ts";

const password = process.env.CAUSA_DB_PASSWORD;
if (!password) throw new Error("CAUSA_DB_PASSWORD is not set in .env");
const vars: Record<string, string> = {
  ZETARIS_ERP_SOURCE: config.zetaris.erpSource,
  ZETARIS_CRM_SOURCE: config.zetaris.crmSource,
  CAUSA_DB_HOST: process.env.CAUSA_DB_HOST || "causa-db:5432",
  CAUSA_DB_PASSWORD: password,
};

const file = path.join(import.meta.dirname, "register_zetaris_sources.sql");
const statements = fs
  .readFileSync(file, "utf-8")
  .replace(/^\s*--.*$/gm, "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => s.replace(/\$\{(\w+)\}/g, (_, k: string) => vars[k] ?? `\${${k}}`));

for (const sql of statements) {
  const label = sql.split(/\s+/).slice(0, 4).join(" ");
  try {
    await zetarisSql(sql);
    console.log(`${label}: done`);
  } catch (err) {
    const msg = (err as Error).message.replaceAll(password, "***");
    if (/already exist|already registered|duplicate/i.test(msg)) console.log(`${label}: already registered`);
    else throw new Error(`${label}: ${msg.slice(0, 300)}`);
  }
}

const check = await zetarisSql(`SELECT count(*) FROM ${config.zetaris.crmSource}.account_events e JOIN ${config.zetaris.erpSource}.customer c ON c.c_custkey = e.c_custkey`);
console.log(`federated check: ${check.rows[0]?.[0]} CRM events joined to ERP customers`);
