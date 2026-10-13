import "dotenv/config";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { DAY, ensureTestPlan, setOrgPlan } from "@/lib/test-utils/trial-fixture";
import { handleActionError } from "@/lib/actions/result";
import { PlanLimitError } from "./limits";
import {
  PlanFeatureLockedError,
  assertFeature,
  assertWithinEntitlementLimit,
  getEntitlements,
  hasFeature,
  limitOf,
  resolveEntitlements,
  type EntitlementRow,
} from "./entitlements";
import { FEATURE_KEYS, PLAN_MATRIX, planLimitsJson, requiredPlanForFeature, type FeatureKey, type PlanKey } from "./plan-catalog";
import { parseFeatures, parseLimits } from "./plans";
import { PLAN_SEED, seedPlans } from "../../../prisma/seed";

const NOW = new Date("2026-10-12T12:00:00Z");
const ORG = "org-x";

type Over = { status?: "trialing" | "active" | "past_due" | "canceled" | "incomplete"; trialEndsAt?: Date | null; pastDueSince?: Date | null; limits?: unknown; entitlementOverride?: EntitlementRow["entitlementOverride"] };
const row = (planKey: string, over: Over = {}): EntitlementRow => ({
  status: "active",
  subscription: {
    status: over.status ?? "active",
    pastDueSince: over.pastDueSince ?? null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date(NOW.getTime() + 20 * DAY),
    trialEndsAt: over.trialEndsAt === undefined ? new Date(NOW.getTime() + 10 * DAY) : over.trialEndsAt,
    plan: { key: planKey, limits: over.limits !== undefined ? over.limits : planLimitsJson(planKey as PlanKey) },
  },
  entitlementOverride: over.entitlementOverride ?? null,
});

describe("plan-catalog / matriz (AC-1: cada celula)", () => {
  const EXPECT: Record<"free" | "starter" | "pro", FeatureKey[]> = {
    free: ["inbox.read"],
    starter: ["agents.role.followup", "agents.autonomy.draft", "inbox.read", "inbox.reply"],
    pro: ["agents.role.sdr", "agents.role.followup", "agents.role.closer", "agents.autonomy.draft", "agents.autonomy.sample", "agents.autonomy.auto", "sources.ads", "ingest.api", "inbox.read", "inbox.reply", "inbox.attachments", "inbox.labels"],
  };
  for (const plan of ["free", "starter", "pro"] as const) {
    describe(plan, () => {
      const ent = resolveEntitlements(ORG, row(plan, { status: plan === "free" ? "trialing" : "active" }), NOW);
      for (const f of FEATURE_KEYS) {
        const allowed = EXPECT[plan].includes(f);
        it(`${f} ${allowed ? "liberada" : "bloqueada"}`, () => {
          expect(hasFeature(ent, f)).toBe(allowed);
        });
      }
    });
  }

  it("limites numericos de cada plano conforme a matriz", () => {
    const l = (p: PlanKey, s: "trialing" | "active" = "active") => resolveEntitlements(ORG, row(p, { status: s }), NOW).limits;
    expect(l("free", "trialing")).toMatchObject({ maxCampaigns: 1, maxWhatsappInstances: 1, maxEmailAccounts: 1, maxLeadsPerMonth: 50, maxSendsPerDay: 20, maxActiveAgents: 0, maxAiBudgetCentsMonth: 0, maxAgentMessagesPerDay: 0, maxLeadSearchesPerDay: 2, maxCreativesPerMonth: 0, maxMembers: 1, maxSequenceSteps: 3 });
    expect(l("starter")).toMatchObject({ maxCampaigns: 3, maxEmailAccounts: 1, maxSendsPerDay: 300, maxActiveAgents: 1, maxAiBudgetCentsMonth: 5000, maxAgentMessagesPerDay: 20, maxLeadSearchesPerDay: 10, maxCreativesPerMonth: 3, maxMembers: 3, maxSequenceSteps: 5 });
    expect(l("pro")).toMatchObject({ maxCampaigns: 10, maxWhatsappInstances: 3, maxEmailAccounts: 3, maxSendsPerDay: 1000, maxActiveAgents: 3, maxAiBudgetCentsMonth: 20000, maxAgentMessagesPerDay: 100, maxLeadSearchesPerDay: 30, maxCreativesPerMonth: 20, maxMembers: 10, maxSequenceSteps: null });
  });

  it("requiredPlan: menor plano que libera", () => {
    expect(requiredPlanForFeature("agents.role.followup")).toBe("starter");
    expect(requiredPlanForFeature("agents.role.closer")).toBe("pro");
    expect(requiredPlanForFeature("sources.ads")).toBe("pro");
    expect(requiredPlanForFeature("inbox.reply")).toBe("starter");
    expect(requiredPlanForFeature("llm.byok")).toBe("business");
    expect(requiredPlanForFeature("inbox.read")).toBe("free");
  });
});

describe("estados de acesso (D-069-9/10)", () => {
  it("business e courtesy: tudo liberado e sem limites, mesmo com Plan.limits vazio/antigo", () => {
    for (const k of ["business", "courtesy"]) {
      const ent = resolveEntitlements(ORG, row(k, { limits: { maxCampaigns: 1 } }), NOW);
      expect(FEATURE_KEYS.every((f) => hasFeature(ent, f))).toBe(true);
      expect(limitOf(ent, "maxCampaigns")).toBeNull();
      expect(limitOf(ent, "maxActiveAgents")).toBeNull();
      expect(ent.source).toBe("full");
    }
  });

  it("QA 069a (medio): business/courtesy liberam tudo, MAS org suspensa ou assinatura cancelada/bloqueada cai no ramo bloqueado; courtesy SEM assinatura segue liberada", () => {
    for (const k of ["business", "courtesy"]) {
      const suspendedOrg = resolveEntitlements(ORG, { ...row(k), status: "suspended" }, NOW);
      expect(suspendedOrg.source).toBe("blocked");
      expect(hasFeature(suspendedOrg, "inbox.read")).toBe(true);
      expect(FEATURE_KEYS.filter((f) => f !== "inbox.read").some((f) => hasFeature(suspendedOrg, f))).toBe(false);
      expect(limitOf(suspendedOrg, "maxActiveAgents")).toBe(0);
      const canceled = resolveEntitlements(ORG, row(k, { status: "canceled" }), NOW);
      expect(canceled.source).toBe("blocked");
      expect(hasFeature(canceled, "agents.role.sdr")).toBe(false);
      // plano ainda vale quando a assinatura esta em dia e a org ativa (nao regride o caso feliz)
      expect(resolveEntitlements(ORG, row(k), NOW).source).toBe("full");
      // past_due dentro do grace (org ativa): business/courtesy nao tem o que pausar (plano ilimitado/full), mantem tudo
      expect(resolveEntitlements(ORG, row(k, { status: "past_due", pastDueSince: new Date(NOW.getTime() - DAY) }), NOW).source).toBe("full");
    }
    const courtesyNoSub = resolveEntitlements(ORG, { status: "active", subscription: null, entitlementOverride: null }, NOW);
    expect(courtesyNoSub.source).toBe("none");
    expect(FEATURE_KEYS.every((f) => hasFeature(courtesyNoSub, f))).toBe(true);
  });

  it("sem assinatura (org ativa) = tudo liberado; org suspensa sem assinatura = so leitura", () => {
    const ok = resolveEntitlements(ORG, { status: "active", subscription: null, entitlementOverride: null }, NOW);
    expect(ok.source).toBe("none");
    expect(hasFeature(ok, "agents.role.closer")).toBe(true);
    const blocked = resolveEntitlements(ORG, { status: "suspended", subscription: null, entitlementOverride: null }, NOW);
    expect(hasFeature(blocked, "agents.role.closer")).toBe(false);
    expect(hasFeature(blocked, "inbox.read")).toBe(true);
  });

  it("trial expirado e canceled: so leitura (fail-open somente em leitura)", () => {
    const exp = resolveEntitlements(ORG, row("free", { status: "trialing", trialEndsAt: new Date(NOW.getTime() - DAY) }), NOW);
    expect(exp.source).toBe("blocked");
    expect(hasFeature(exp, "inbox.read")).toBe(true);
    expect(hasFeature(exp, "inbox.reply")).toBe(false);
    expect(limitOf(exp, "maxActiveAgents")).toBe(0);
    const canceled = resolveEntitlements(ORG, row("pro", { status: "canceled" }), NOW);
    expect(canceled.source).toBe("blocked");
    expect(hasFeature(canceled, "agents.role.sdr")).toBe(false);
    expect(hasFeature(canceled, "inbox.read")).toBe(true);
  });

  it("past_due: plano vale, mas IA pausa (costly e limites de agente = 0); resto segue", () => {
    const ent = resolveEntitlements(ORG, row("pro", { status: "past_due", pastDueSince: new Date(NOW.getTime() - 2 * DAY) }), NOW);
    expect(ent.paused).toBe(true);
    expect(hasFeature(ent, "agents.role.sdr")).toBe(false);
    expect(hasFeature(ent, "agents.autonomy.auto")).toBe(false);
    expect(hasFeature(ent, "inbox.reply")).toBe(true);
    expect(hasFeature(ent, "sources.ads")).toBe(true);
    expect(limitOf(ent, "maxActiveAgents")).toBe(0);
    expect(limitOf(ent, "maxCampaigns")).toBe(10);
  });

  it("plano com limits ilegivel (desconhecido): fail-closed", () => {
    for (const bad of [null, "x", [1, 2]]) {
      const ent = resolveEntitlements(ORG, row("pro", { limits: bad }), NOW);
      expect(ent.source).toBe("unknown_plan");
      expect(hasFeature(ent, "agents.role.followup")).toBe(false);
      expect(limitOf(ent, "maxActiveAgents")).toBe(0);
    }
  });

  it("org inexistente/erro de leitura: fail-closed", () => {
    const ent = resolveEntitlements(ORG, null, NOW);
    expect(ent.source).toBe("error");
    expect(hasFeature(ent, "agents.role.followup")).toBe(false);
    expect(hasFeature(ent, "inbox.read")).toBe(true);
  });

  it("plano pago com features/limites novos ausentes (ainda nao semeado): IA bloqueada, equipe/passos ilimitados", () => {
    const ent = resolveEntitlements(ORG, row("starter", { limits: { maxCampaigns: 3, maxWhatsappInstances: 1, maxLeadsPerMonth: 500 } }), NOW);
    expect(hasFeature(ent, "agents.role.followup")).toBe(false);
    expect(limitOf(ent, "maxActiveAgents")).toBe(0);
    expect(limitOf(ent, "maxCreativesPerMonth")).toBe(0);
    expect(limitOf(ent, "maxMembers")).toBeNull();
    expect(limitOf(ent, "maxSequenceSteps")).toBeNull();
    expect(limitOf(ent, "maxCampaigns")).toBe(3);
  });
});

describe("override (prevalece sobre o plano; respeita expiresAt; relogio injetado)", () => {
  const ov = (expiresAt: Date | null) => ({ features: { "llm.byok": true, "agents.role.sdr": true, "sources.ads": false, bogus: true }, limits: { maxActiveAgents: 5, maxMembers: null, maxCampaigns: -3, nope: 1 }, expiresAt });
  it("valido: libera/bloqueia feature e ajusta limite; chaves invalidas ignoradas", () => {
    const ent = resolveEntitlements(ORG, row("starter", { entitlementOverride: ov(new Date(NOW.getTime() + DAY)) }), NOW);
    expect(ent.overrideActive).toBe(true);
    expect(hasFeature(ent, "llm.byok")).toBe(true);
    expect(hasFeature(ent, "agents.role.sdr")).toBe(true);
    expect(limitOf(ent, "maxActiveAgents")).toBe(5);
    expect(limitOf(ent, "maxMembers")).toBeNull();
    expect(limitOf(ent, "maxCampaigns")).toBe(3); // negativo invalido ignorado
    const pro = resolveEntitlements(ORG, row("pro", { entitlementOverride: ov(null) }), NOW);
    expect(hasFeature(pro, "sources.ads")).toBe(false); // override tambem pode bloquear
  });
  it("expirado (expiresAt <= agora): volta ao plano", () => {
    for (const at of [new Date(NOW.getTime() - 1), NOW]) {
      const ent = resolveEntitlements(ORG, row("starter", { entitlementOverride: ov(at) }), NOW);
      expect(ent.overrideActive).toBe(false);
      expect(hasFeature(ent, "llm.byok")).toBe(false);
      expect(limitOf(ent, "maxActiveAgents")).toBe(1);
    }
  });
  it("nao libera IA em past_due nem destrava trial expirado", () => {
    const pd = resolveEntitlements(ORG, row("pro", { status: "past_due", entitlementOverride: ov(null) }), NOW);
    expect(hasFeature(pd, "llm.byok")).toBe(false);
    expect(limitOf(pd, "maxActiveAgents")).toBe(0);
    const exp = resolveEntitlements(ORG, row("free", { status: "trialing", trialEndsAt: new Date(NOW.getTime() - DAY), entitlementOverride: ov(null) }), NOW);
    expect(hasFeature(exp, "agents.role.sdr")).toBe(false);
  });
});

describe("parseLimits / parseFeatures", () => {
  it("parseFeatures: so `true` literal libera; todas as chaves do catalogo; fail-closed", () => {
    const f = parseFeatures({ features: { "inbox.reply": true, "inbox.labels": "true", "agents.role.sdr": 1, x: true } });
    expect(Object.keys(f).sort()).toEqual([...FEATURE_KEYS].sort());
    expect(f["inbox.reply"]).toBe(true);
    expect(f["inbox.labels"]).toBe(false);
    expect(f["agents.role.sdr"]).toBe(false);
    expect(Object.values(parseFeatures(null)).every((v) => v === false)).toBe(true);
    expect(Object.values(parseFeatures({ features: [true] })).every((v) => v === false)).toBe(true);
  });
  it("parseLimits: chaves novas (ausente = 0 nas de custo, ilimitado nas demais; null explicito = ilimitado)", () => {
    const l = parseLimits({});
    expect(l).toMatchObject({ maxActiveAgents: 0, maxAiBudgetCentsMonth: 0, maxAgentMessagesPerDay: 0, maxLeadSearchesPerDay: 0, maxCreativesPerMonth: 0, maxMembers: null, maxSequenceSteps: null });
    expect(parseLimits({ maxActiveAgents: null, maxMembers: 4, maxCreativesPerMonth: -1, maxAiBudgetCentsMonth: "x" })).toMatchObject({ maxActiveAgents: null, maxMembers: 4, maxCreativesPerMonth: 0, maxAiBudgetCentsMonth: 0 });
  });
});

describe("PlanFeatureLockedError / plan_feature_locked", () => {
  it("mensagem PT-BR com o nome do plano necessario e sem dado de org", () => {
    const e = new PlanFeatureLockedError("agents.role.closer");
    expect(e.code).toBe("plan_feature_locked");
    expect(e.requiredPlan).toBe("Pro");
    expect(e.message).toContain("disponível no plano Pro");
    expect(new PlanFeatureLockedError("agents.role.followup").message).toContain("plano Starter");
    expect(new PlanFeatureLockedError("agents.role.sdr", "past_due").message).toContain("pagamento em atraso");
    expect(new PlanFeatureLockedError("inbox.reply", "blocked").message).toContain("assinatura inativa");
  });
  it("handleActionError converte em ActionResult tipado", () => {
    const r = handleActionError(new PlanFeatureLockedError("sources.ads"));
    expect(r).toEqual({ ok: false, errors: { _form: [expect.stringContaining("plano Pro")], code: ["plan_feature_locked"], feature: ["sources.ads"], requiredPlan: ["Pro"] } });
  });
  it("plan_limit continua intacto e aceita as metricas novas", () => {
    const r = handleActionError(new PlanLimitError("agents", 1, 1));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors?.code).toEqual(["plan_limit"]);
    expect(new PlanLimitError("members", 3, 3).message).toContain("3 membros");
    expect(new PlanLimitError("campaigns", 1, 1).message).toContain("1 campanha");
  });
  it("assertFeatureIn escolhe o motivo certo", async () => {
    const { assertFeatureIn } = await import("./entitlements");
    const pd = resolveEntitlements(ORG, row("pro", { status: "past_due" }), NOW);
    expect(() => assertFeatureIn(pd, "agents.role.sdr")).toThrow(/pagamento em atraso/);
    expect(() => assertFeatureIn(pd, "inbox.reply")).not.toThrow();
    const free = resolveEntitlements(ORG, row("free", { status: "trialing" }), NOW);
    expect(() => assertFeatureIn(free, "agents.role.sdr")).toThrow(/plano Pro/);
  });
});

describe("AC-5: nenhuma checagem por plan.key fora do modulo em actions/agents/api", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : []; });
  it("sem `plan.key ===` / `planKey ===` em src/lib/actions, src/lib/agents e src/app/api", () => {
    const offenders = ["src/lib/actions", "src/lib/agents", "src/app/api"]
      .flatMap((d) => (statSync(path.join(process.cwd(), d), { throwIfNoEntry: false }) ? walk(path.join(process.cwd(), d)) : []))
      .filter((f) => !f.endsWith("cancel-subscription.ts") && /(plan\.key|planKey)\s*[!=]==?\s*["'](free|starter|pro|business|courtesy)["']/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("migration 069a (aditiva)", () => {
  const SQL = readFileSync(path.join(process.cwd(), "prisma/migrations/20261022120000_entitlement_override_069a/migration.sql"), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  it("so cria (sem DROP/UPDATE/DELETE/TRUNCATE; o unico ALTER e a FK da tabela nova)", () => {
    expect(SQL.replace(/ON (DELETE|UPDATE) CASCADE/g, "")).not.toMatch(/\b(DROP|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(SQL.match(/ALTER TABLE "[A-Za-z]+"/g) ?? []).toEqual(['ALTER TABLE "OrgEntitlementOverride"']);
    expect(SQL).toMatch(/CREATE TABLE "OrgEntitlementOverride"/);
  });
  it("unique(orgId) e FK Cascade existem no banco migrado", async () => {
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename = 'OrgEntitlementOverride'`;
    expect(idx.map((i) => i.indexname)).toContain("OrgEntitlementOverride_orgId_key");
    const fk = await prisma.$queryRaw<{ delete_rule: string }[]>`SELECT rc.delete_rule FROM information_schema.referential_constraints rc WHERE rc.constraint_name = 'OrgEntitlementOverride_orgId_fkey'`;
    expect(fk[0]?.delete_rule).toBe("CASCADE");
  });
});

describe("seed: matriz gravada nos 5 planos (idempotente)", () => {
  it("Plan.limits == catalogo; rodar de novo nao muda nada; mudar o catalogo e o unico lugar", async () => {
    await seedPlans(prisma);
    const snap = async () => (await prisma.plan.findMany({ where: { key: { in: PLAN_SEED.map((p) => p.key) } }, orderBy: { key: "asc" }, select: { key: true, limits: true } }));
    const a = await snap();
    await seedPlans(prisma);
    expect(await snap()).toEqual(a);
    for (const p of a) {
      const key = p.key as PlanKey;
      expect(parseFeatures(p.limits)).toEqual(PLAN_MATRIX[key].features);
      expect(parseLimits(p.limits)).toMatchObject(PLAN_MATRIX[key].limits);
    }
    expect(PLAN_SEED.map((p) => p.key)).toEqual(["free", "starter", "pro", "business", "courtesy"]);
  });
});

describe("integracao com banco: isolamento multi-tenant A/B/C", () => {
  const orgs: TestOrg[] = [];
  const mk = async (t: string) => { const o = await createTestOrg(t); orgs.push(o); return o; };
  afterAll(async () => {
    for (const o of orgs) { await prisma.orgEntitlementOverride.deleteMany({ where: { orgId: o.orgId } }); await purgeTestOrg(o); }
  });

  it("cada org enxerga so o proprio plano/override; override de A nao vaza para B/C; assertFeature barra so quem nao tem", async () => {
    await seedPlans(prisma);
    const [a, b, c] = [await mk("ent-a"), await mk("ent-b"), await mk("ent-c")];
    await setOrgPlan(a.orgId, { planKey: "starter", status: "active" });
    await setOrgPlan(b.orgId, { planKey: "starter", status: "active" });
    await setOrgPlan(c.orgId, { planKey: "pro", status: "active" });
    await prisma.orgEntitlementOverride.create({ data: { orgId: a.orgId, features: { "llm.byok": true }, limits: { maxActiveAgents: 2 }, reason: "cliente piloto", expiresAt: new Date(Date.now() + DAY), createdBy: "admin-1" } });

    const [ea, eb, ec] = [await getEntitlements(prisma, a.orgId), await getEntitlements(prisma, b.orgId), await getEntitlements(prisma, c.orgId)];
    expect(hasFeature(ea, "llm.byok")).toBe(true);
    expect(limitOf(ea, "maxActiveAgents")).toBe(2);
    expect(hasFeature(eb, "llm.byok")).toBe(false);
    expect(limitOf(eb, "maxActiveAgents")).toBe(1);
    expect(limitOf(ec, "maxActiveAgents")).toBe(3);
    expect(ea.orgId).toBe(a.orgId);

    await expect(assertFeature(prisma, b.orgId, "llm.byok")).rejects.toBeInstanceOf(PlanFeatureLockedError);
    await expect(assertFeature(prisma, a.orgId, "llm.byok")).resolves.toBeUndefined();
    await expect(assertFeature(prisma, b.orgId, "agents.role.closer")).rejects.toThrow(/plano Pro/);
    await expect(assertFeature(prisma, c.orgId, "agents.role.closer")).resolves.toBeUndefined();

    // limite novo: A (override=2) cabe o 2o; B (plano=1) nao; relogio injetado: override expirado volta ao plano.
    await expect(assertWithinEntitlementLimit(prisma, a.orgId, "agents", 1)).resolves.toBeUndefined();
    await expect(assertWithinEntitlementLimit(prisma, b.orgId, "agents", 1)).rejects.toBeInstanceOf(PlanLimitError);
    await expect(assertWithinEntitlementLimit(prisma, a.orgId, "agents", 1, 1, new Date(Date.now() + 2 * DAY))).rejects.toBeInstanceOf(PlanLimitError);
    await expect(assertWithinEntitlementLimit(prisma, c.orgId, "sequence_steps", 99)).resolves.toBeUndefined(); // Pro: ilimitado
  });

  it("org sem assinatura: liberada; org inexistente: fail-closed sem lancar", async () => {
    const o = await mk("ent-none");
    await prisma.subscription.deleteMany({ where: { orgId: o.orgId } });
    expect(hasFeature(await getEntitlements(prisma, o.orgId), "agents.role.closer")).toBe(true);
    const ghost = await getEntitlements(prisma, "00000000-0000-4000-8000-0000000000aa");
    expect(ghost.source).toBe("error");
    expect(hasFeature(ghost, "agents.role.sdr")).toBe(false);
  });

  it("downgrade/upgrade: efeito imediato, sem cache entre chamadas e sem apagar dados", async () => {
    const o = await mk("ent-dg");
    await setOrgPlan(o.orgId, { planKey: "pro", status: "active" });
    expect(hasFeature(await getEntitlements(prisma, o.orgId), "agents.role.closer")).toBe(true);
    await setOrgPlan(o.orgId, { planKey: "starter", status: "active" });
    expect(hasFeature(await getEntitlements(prisma, o.orgId), "agents.role.closer")).toBe(false);
    await setOrgPlan(o.orgId, { planKey: "pro", status: "active" });
    expect(hasFeature(await getEntitlements(prisma, o.orgId), "agents.role.closer")).toBe(true);
  });

  it("plano de teste com JSON antigo (so chaves legadas): IA bloqueada, limites legados intactos", async () => {
    // JSON ANTIGO de verdade (`ensureTestPlan` agora abre as chaves novas por padrao): grava so as chaves legadas.
    const legacy = { maxCampaigns: 2, maxWhatsappInstances: 1, maxLeadsPerMonth: 10 };
    await prisma.plan.upsert({ where: { key: "zz-ent-legacy" }, update: { limits: legacy }, create: { key: "zz-ent-legacy", name: "zz-ent-legacy", priceMonthlyCents: 0, priceYearlyCents: null, limits: legacy, active: false, selfServiceCheckout: false } });
    const o = await mk("ent-leg");
    await setOrgPlan(o.orgId, { planKey: "zz-ent-legacy", status: "active" });
    const e = await getEntitlements(prisma, o.orgId);
    expect(hasFeature(e, "agents.role.followup")).toBe(false);
    expect(limitOf(e, "maxCampaigns")).toBe(2);
  });
});
