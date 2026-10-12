import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

/** SPEC-066a — migration ADITIVA escrita a mao: so CREATE TYPE/TABLE/INDEX + FK da tabela nova; sem DROP/UPDATE/DELETE. */
const SQL = readFileSync(path.join(process.cwd(), "prisma/migrations/20261020120000_billing_charge_066a/migration.sql"), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 066a", () => {
  it("so cria (sem DROP/UPDATE/DELETE/TRUNCATE; o unico ALTER e a FK da tabela nova)", () => {
    expect(SQL.replace(/ON (DELETE|UPDATE) CASCADE/g, "")).not.toMatch(/\b(DROP|UPDATE|DELETE|TRUNCATE)\b/i);
    const alters = SQL.match(/ALTER TABLE "[A-Za-z]+"/g) ?? [];
    expect(alters).toEqual(['ALTER TABLE "BillingCharge"']);
    expect(SQL).toMatch(/CREATE TABLE "BillingCharge"/);
  });

  it("unique (provider, externalId) e FK Cascade existem no banco migrado", async () => {
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename = 'BillingCharge'`;
    expect(idx.map((i) => i.indexname)).toContain("BillingCharge_provider_externalId_key");
    const fk = await prisma.$queryRaw<{ delete_rule: string }[]>`SELECT rc.delete_rule FROM information_schema.referential_constraints rc WHERE rc.constraint_name = 'BillingCharge_orgId_fkey'`;
    expect(fk[0]?.delete_rule).toBe("CASCADE");
  });
});
