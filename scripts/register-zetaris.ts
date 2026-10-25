// Registers the ERP and CRM Postgres databases (docker-compose.yml) in Zetaris
// as the causa_erp and causa_crm data sources, then registers their tables.
// Safe to re-run: sources and tables that already exist are left alone.

import { config } from "../src/config.ts";
import { zetarisSql } from "../src/data/zetaris.ts";

const host = process.env.CAUSA_DB_HOST || "causa-db:5432";
const password = process.env.CAUSA_DB_PASSWORD;
if (!password) throw new Error("CAUSA_DB_PASSWORD is not set in .env");

const sources = [
  { name: config.zetaris.erpSource, db: "erp", desc: "Causa ERP - orders, customers, parts" },
  { name: config.zetaris.crmSource, db: "crm", desc: "Causa CRM - accounts and account events" },
];

async function run(label: string, sql: string) {
  try {
    await zetarisSql(sql);
    console.log(`${label}: done`);
  } catch (err) {
    const msg = (err as Error).message.replaceAll(password!, "***");
    if (/already exist|already registered|duplicate/i.test(msg)) console.log(`${label}: already registered`);
    else throw new Error(`${label}: ${msg.slice(0, 300)}`);
  }
}

for (const s of sources) {
  await run(
    `source ${s.name}`,
    `CREATE DATASOURCE ${s.name} DESCRIBE BY "${s.desc}" OPTIONS (jdbcdriver "org.postgresql.Driver", jdbcurl "jdbc:postgresql://${host}/${s.db}", username "causa", password "${password}")`,
  );
  await run(`tables of ${s.name}`, `REGISTER DATASOURCE TABLES FROM ${s.name}`);
}

const check = await zetarisSql(`SELECT count(*) FROM ${config.zetaris.crmSource}.account_events e JOIN ${config.zetaris.erpSource}.customer c ON c.c_custkey = e.c_custkey`);
console.log(`federated check: ${check.rows[0]?.[0]} CRM events joined to ERP customers`);
