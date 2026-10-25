// One query surface for the agents. Normal mode runs SQL in Zetaris, which
// federates two sources: the ERP database (orders, customers, parts, suppliers)
// and the CRM database (accounts, account events). SAMPLE_MODE loads the same
// seed data into an in-memory SQLite database and runs the same SQL there, so
// the project works with no services at all. Sample mode only ever supplies
// input data: every answer is still computed per question.

import fs from "node:fs";
import zlib from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.ts";
import { zetarisSql, zetarisStatus, type QueryRows } from "./zetaris.ts";

export type { QueryRows };

export const ERP_TABLES = ["region", "nation", "customer", "part", "supplier", "orders", "lineitem"] as const;
export const CRM_TABLES = ["accounts", "account_events"] as const;
export type TableName = (typeof ERP_TABLES)[number] | (typeof CRM_TABLES)[number];

export interface Warehouse {
  kind: "zetaris" | "sample";
  table(name: TableName): string;
  sourceOf(name: TableName): string;
  query(sql: string): Promise<QueryRows>;
  status(): Promise<{ state: string; detail?: string }>;
}

const isCrm = (name: TableName) => (CRM_TABLES as readonly string[]).includes(name);

class ZetarisWarehouse implements Warehouse {
  kind = "zetaris" as const;
  sourceOf(name: TableName): string {
    return isCrm(name) ? config.zetaris.crmSource : config.zetaris.erpSource;
  }
  table(name: TableName): string {
    return `${this.sourceOf(name)}.${name}`;
  }
  query(sql: string): Promise<QueryRows> {
    return zetarisSql(sql);
  }
  status() {
    return zetarisStatus();
  }
}

interface SeedFile {
  generated_by: string;
  range: [string, string];
  sources: Record<string, Record<string, { columns: string[]; rows: unknown[][] }>>;
}

class SampleWarehouse implements Warehouse {
  kind = "sample" as const;
  private db = new DatabaseSync(":memory:");
  private loaded = false;

  sourceOf(name: TableName): string {
    return isCrm(name) ? "crm (sample)" : "erp (sample)";
  }
  table(name: TableName): string {
    return name;
  }

  private load(): void {
    if (this.loaded) return;
    if (!fs.existsSync(config.paths.seed)) throw new Error(`seed data not found at ${config.paths.seed}`);
    const seed = JSON.parse(zlib.gunzipSync(fs.readFileSync(config.paths.seed)).toString("utf-8")) as SeedFile;
    for (const tables of Object.values(seed.sources)) {
      for (const [name, t] of Object.entries(tables)) {
        this.db.exec(`CREATE TABLE ${name} (${t.columns.map((c) => `"${c}"`).join(", ")})`);
        const insert = this.db.prepare(`INSERT INTO ${name} VALUES (${t.columns.map(() => "?").join(", ")})`);
        this.db.exec("BEGIN");
        for (const row of t.rows) insert.run(...(row as (string | number | null)[]));
        this.db.exec("COMMIT");
      }
    }
    this.loaded = true;
  }

  async query(sql: string): Promise<QueryRows> {
    this.load();
    const stmt = this.db.prepare(sql);
    const columns = stmt.columns().map((c) => c.name);
    const rows = stmt.all() as Record<string, unknown>[];
    return { columns, rows: rows.map((r) => columns.map((c) => r[c])) };
  }

  async status() {
    try {
      this.load();
      return { state: "online", detail: "sample mode: seed data in SQLite" };
    } catch (err) {
      return { state: "offline", detail: (err as Error).message };
    }
  }
}

let instance: Warehouse | undefined;
export function warehouse(): Warehouse {
  instance ??= config.sampleMode ? new SampleWarehouse() : new ZetarisWarehouse();
  return instance;
}
