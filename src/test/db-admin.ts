// Operações de administração do banco de TESTE (criar/migrar/semear/dropar). Toda função recusa nomes que não terminam em _test.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Client } from "pg";
import { assertTestDatabase, dbNameFromUrl, withDbName } from "./db-guard";

const ROOT = path.resolve(__dirname, "../..");

async function withMaintenance<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: withDbName(url, "postgres") });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export async function createDbIfMissing(testUrl: string): Promise<boolean> {
  assertTestDatabase(testUrl);
  const name = dbNameFromUrl(testUrl);
  return withMaintenance(testUrl, async (c) => {
    const r = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (r.rowCount) return false;
    await c.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`); // fora de transação
    return true;
  });
}

export async function dropDb(testUrl: string): Promise<void> {
  assertTestDatabase(testUrl);
  const name = dbNameFromUrl(testUrl);
  await withMaintenance(testUrl, (c) => c.query(`DROP DATABASE IF EXISTS "${name.replace(/"/g, '""')}" WITH (FORCE)`));
}

function run(bin: string, args: string[], testUrl: string) {
  assertTestDatabase(testUrl);
  const r = spawnSync(path.join(ROOT, "node_modules/.bin", bin), args, {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: testUrl }, // só no processo filho
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")} falhou:\n${r.stdout}\n${r.stderr}`.replaceAll(testUrl, "<url>"));
}

export function migrateAndSeed(testUrl: string): void {
  run("prisma", ["migrate", "deploy"], testUrl);
  run("tsx", ["prisma/seed.ts"], testUrl);
}
