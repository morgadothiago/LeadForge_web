import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbIfMissing, dropDb } from "./db-admin";
import { assertTestDatabase, deriveTestUrl, withDbName } from "./db-guard";

/**
 * SPEC-028 AC1: a migration de Meeting e ADITIVA e preserva dados. Banco descartavel `<base>_mig_test` (termina em _test; nunca o de dev):
 * aplica todas as migrations ANTERIORES, insere Meetings no formato antigo, aplica a migration nova e confere.
 */
const MIG = "20260921100000_meeting";
const root = path.resolve(__dirname, "../../prisma/migrations");
const base = deriveTestUrl()!;
const scratch = withDbName(base, "leadforge_mig_test");
let c: Client;

async function fill(table: string, over: Record<string, unknown>): Promise<void> {
  // preenche colunas NOT NULL sem default com valores neutros por tipo (schema antigo), respeitando `over`
  const cols = (
    await c.query(
      `SELECT column_name AS n, data_type AS t, udt_name AS u FROM information_schema.columns WHERE table_name = $1 AND is_nullable = 'NO' AND column_default IS NULL`,
      [table],
    )
  ).rows as { n: string; t: string; u: string }[];
  const vals: Record<string, unknown> = {};
  for (const col of cols) {
    if (col.n in over) continue;
    if (col.t === "USER-DEFINED") vals[col.n] = (await c.query(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY enumsortorder LIMIT 1`, [col.u])).rows[0].enumlabel;
    else if (/timestamp/.test(col.t)) vals[col.n] = new Date();
    else if (/int|double|numeric/.test(col.t)) vals[col.n] = 0;
    else if (col.t === "boolean") vals[col.n] = false;
    else if (col.t === "jsonb") vals[col.n] = "{}";
    else vals[col.n] = `zz-${Math.random().toString(36).slice(2, 10)}`;
  }
  const all = { ...vals, ...over };
  const keys = Object.keys(all);
  await c.query(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, keys.map((k) => all[k]));
}

beforeAll(async () => {
  assertTestDatabase(scratch);
  await dropDb(scratch);
  await createDbIfMissing(scratch);
  c = new Client({ connectionString: scratch });
  await c.connect();
  const dirs = readdirSync(root).filter((d) => /^\d+_/.test(d)).sort();
  for (const d of dirs.filter((x) => x < MIG)) await c.query(readFileSync(path.join(root, d, "migration.sql"), "utf8"));
}, 120_000);
afterAll(async () => {
  await c?.end();
  await dropDb(scratch);
});

describe("migration 20260921100000_meeting", () => {
  it("preserva Meetings antigas (scheduledAt->startsAt, duration->endsAt, status->enum, campaignId derivado) e cria MeetingSettings", async () => {
    await fill("User", { id: "u1", email: "zz-mig@x.test" });
    await fill("IcpProfile", { id: "icp1" });
    await fill("Campaign", { id: "camp1", userId: "u1", icpId: "icp1" });
    await fill("Lead", { id: "l1", campaignId: "camp1" });
    await fill("Opportunity", { id: "o1", leadId: "l1", campaignId: "camp1" });
    const t0 = new Date("2026-03-10T15:00:00Z");
    for (const [id, status, dur] of [["m1", "scheduled", 30], ["m2", "done", 90], ["m3", "cancelled", 15], ["m4", "status-legado-estranho", 45]] as const)
      await c.query(`INSERT INTO "Meeting" (id, "opportunityId", "leadId", "scheduledAt", duration, status, "createdAt") VALUES ($1,'o1','l1',$2,$3,$4,$5)`, [id, t0, dur, status, new Date("2026-03-01T10:00:00Z")]);

    await c.query(readFileSync(path.join(root, MIG, "migration.sql"), "utf8"));

    const rows = (await c.query(`SELECT id, "startsAt", "endsAt", duration, status::text AS status, "campaignId", timezone, source::text AS source, "cancelledAt", "externalId", "createdAt" FROM "Meeting" ORDER BY id`)).rows;
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.startsAt.toISOString()).toBe(t0.toISOString());
      expect(r.endsAt.getTime() - r.startsAt.getTime()).toBe(r.duration * 60_000);
      expect(r.campaignId).toBe("camp1");
      expect(r.timezone).toBe("America/Sao_Paulo");
      expect(r.source).toBe("manual");
      expect(r.externalId).toBeNull();
      expect(r.createdAt.toISOString()).toBe("2026-03-01T10:00:00.000Z"); // metrica do dashboard (createdAt) inalterada
    }
    expect(rows.map((r) => r.status)).toEqual(["scheduled", "done", "cancelled", "scheduled"]); // desconhecido -> scheduled
    // externalId: NULLs multiplos permitidos; valor duplicado nao
    await expect(c.query(`UPDATE "Meeting" SET "externalId" = 'x' WHERE id IN ('m1','m2')`)).rejects.toThrow();
    // singleton com defaults
    await c.query(`INSERT INTO "MeetingSettings" (id, "updatedAt") VALUES ('global', now())`);
    const s = (await c.query(`SELECT "remindersEnabled", "offsetsMin" FROM "MeetingSettings"`)).rows[0];
    expect(s).toEqual({ remindersEnabled: true, offsetsMin: [1440, 60, 15] });
  });
});
