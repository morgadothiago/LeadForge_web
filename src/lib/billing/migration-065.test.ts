import "dotenv/config";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertTestDatabase } from "@/test/db-guard";
import { prisma } from "@/lib/prisma";

const DIR = path.resolve(process.cwd(), "prisma/migrations");
const NAME = readdirSync(DIR).find((d) => d.endsWith("_free_trial_065a"))!;

describe("migration 065a e ADITIVA (D-065-25, plano de testes 9)", () => {
  const sql = () => readFileSync(path.join(DIR, NAME, "migration.sql"), "utf8").replace(/--[^\n]*/g, "");

  it("so CREATE TABLE/INDEX, ADD CONSTRAINT (FK nova) e ALTER TYPE ADD VALUE: sem DROP/DELETE/UPDATE/TRUNCATE/ALTER COLUMN", () => {
    const s = sql();
    // `ON DELETE/UPDATE CASCADE` das FKs novas nao e DML: remove antes de procurar comandos destrutivos.
    expect(s.replace(/ON (DELETE|UPDATE) (CASCADE|RESTRICT|SET NULL|NO ACTION)/gi, "")).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|RENAME)\b/i);
    expect(s).not.toMatch(/ALTER TABLE\s+"[A-Za-z]+"\s+(ALTER|DROP)/i);
    for (const stmt of s.split(";").map((x) => x.trim()).filter(Boolean)) {
      expect(stmt, stmt.slice(0, 60)).toMatch(/^(CREATE TABLE|CREATE UNIQUE INDEX|CREATE INDEX|ALTER TABLE "UsageCounter" ADD CONSTRAINT|ALTER TYPE "BillingReminderKind" ADD VALUE)/);
    }
    expect(s).toContain('CREATE TABLE "UsageCounter"');
    expect(s).toContain('CREATE TABLE "TrialClaim"');
    expect(s).toContain("ADD VALUE 'trial_ending_d1'");
    expect(s).toContain("ADD VALUE 'trial_expired'");
  });

  it("a migration existe e o plano `free` NAO entra por migration (so pelo seed)", () => {
    const all = readdirSync(DIR).filter((d) => /^\d{14}_/.test(d)).sort();
    expect(all).toContain(NAME); // migrations posteriores (ex.: 066a) sao permitidas; a 065a deixou de ser a ultima
    expect(sql()).not.toMatch(/INSERT/i);
  });

  it("`prisma migrate diff` do banco de TESTE (migrations aplicadas) contra schema.prisma: sem diferenca", () => {
    const url = process.env.DATABASE_URL!;
    assertTestDatabase(url);
    const r = spawnSync(path.join(process.cwd(), "node_modules/.bin/prisma"), ["migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
    });
    expect(`${r.stdout}\n${r.stderr}`.replaceAll(url, "<url>")).toMatch(/No difference detected/);
    expect(r.status).toBe(0);
  }, 60_000);

  it("o seed cria o plano `free` (limites placeholder) e o seed repoe os limites (SPEC-069a: dos 5 planos; precos intocados)", async () => {
    const { seedPlans } = await import("../../../prisma/seed");
    const { PrismaClient } = await import("@prisma/client");
    expect(PrismaClient).toBeDefined();
    const free = await prisma.plan.findUniqueOrThrow({ where: { key: "free" } });
    expect(free).toMatchObject({ name: "Teste grátis", priceMonthlyCents: 0, selfServiceCheckout: false, active: true });
    expect(free.limits).toMatchObject({ maxCampaigns: 1, maxWhatsappInstances: 1, maxEmailAccounts: 1, maxLeadsPerMonth: 50, maxSendsPerDay: 20 }); // 069a: + chaves novas e `features`
    const starterBefore = await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } });
    try {
      await prisma.plan.update({ where: { key: "free" }, data: { limits: { maxCampaigns: 99 } } });
      await prisma.plan.update({ where: { key: "starter" }, data: { limits: { maxCampaigns: 77 } } });
      await seedPlans(prisma);
      expect((await prisma.plan.findUniqueOrThrow({ where: { key: "free" } })).limits).toEqual(free.limits); // free: o seed e a fonte
      expect((await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } })).limits).toMatchObject({ maxCampaigns: 3, maxSendsPerDay: 300 }); // 069a (Q-069-8): o seed tambem repoe os demais
    } finally {
      await prisma.plan.update({ where: { key: "starter" }, data: { limits: starterBefore.limits ?? {} } });
      await seedPlans(prisma);
    }
  });
});
