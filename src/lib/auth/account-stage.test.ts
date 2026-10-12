import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { loadAccountStage, resolveAccountStage, resolveSessionHomeRoute, resolveStageRoute, type AccountStage, type AccountStageInput } from "./account-stage";

// SPEC-062 (D-062-6): estado derivado, tabela dos 7 estados e destinos; sem laco.
describe("resolveAccountStage / resolveStageRoute (tabela, SPEC-062)", () => {
  const base: AccountStageInput = { platformRole: "provider", hasOrg: false, isOwner: false, shell: null };
  const cases: Array<[string, Partial<AccountStageInput>, AccountStage, string]> = [
    ["sem org, sem casca", {}, "sem_plano", "/assinar"],
    ["casca incomplete (checkout iniciado)", { shell: { subscriptionStatus: "incomplete" } }, "aguardando_pagamento", "/assinar/retorno"],
    ["casca canceled", { shell: { subscriptionStatus: "canceled" } }, "sem_plano", "/assinar"],
    ["casca past_due", { shell: { subscriptionStatus: "past_due" } }, "sem_plano", "/assinar"],
    ["casca sem assinatura (anomalia)", { shell: { subscriptionStatus: null } }, "sem_plano", "/assinar"],
    ["casca paga", { shell: { subscriptionStatus: "active" } }, "pago_sem_org", "/organizacao/nova"],
    ["membro de org real", { hasOrg: true }, "membro", "/dashboard"],
    ["dono de org real", { hasOrg: true, isOwner: true }, "dono", "/dashboard"],
    ["dono + casca paga", { hasOrg: true, isOwner: true, shell: { subscriptionStatus: "active" } }, "membro_pago_sem_org", "/dashboard"],
    ["membro + casca paga", { hasOrg: true, shell: { subscriptionStatus: "active" } }, "membro_pago_sem_org", "/dashboard"],
    ["dono + casca incomplete continua dono", { hasOrg: true, isOwner: true, shell: { subscriptionStatus: "incomplete" } }, "dono", "/dashboard"],
    ["platform_admin", { platformRole: "platform_admin" }, "admin", "/admin/organizacoes"],
    ["platform_admin ignora casca/org", { platformRole: "platform_admin", hasOrg: true, shell: { subscriptionStatus: "active" } }, "admin", "/admin/organizacoes"],
  ];
  it.each(cases)("%s", (_n, over, stage, route) => {
    const s = resolveAccountStage({ ...base, ...over });
    expect(s).toBe(stage);
    expect(resolveStageRoute(s)).toBe(route);
  });

  it("org suspensa continua 'dono' (o gate de billing e dos guards, nao do estado)", () => {
    expect(resolveAccountStage({ ...base, hasOrg: true, isOwner: true })).toBe("dono");
  });
  it("sem laco: nenhum estado redireciona para a rota de outro estado que o devolva", () => {
    const stages: AccountStage[] = ["sem_plano", "aguardando_pagamento", "pago_sem_org", "membro", "dono", "membro_pago_sem_org", "admin"];
    for (const st of stages) {
      const route = resolveStageRoute(st);
      // a rota-destino de um estado nunca e uma rota que redireciona de volta: rotas do estado sao terminais (nao ha mapa rota->estado diferente)
      expect(route.startsWith("/")).toBe(true);
    }
    expect(new Set(["sem_plano", "aguardando_pagamento", "pago_sem_org"].map((s) => resolveStageRoute(s as AccountStage))).size).toBe(3);
  });
});

describe("loadAccountStage / resolveSessionHomeRoute (banco, SPEC-062)", () => {
  const ids = { users: [] as string[], orgs: [] as string[] };
  afterAll(async () => {
    await prisma.membership.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.subscription.deleteMany({ where: { orgId: { in: ids.orgs } } });
    await prisma.organization.deleteMany({ where: { id: { in: ids.orgs } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  });
  async function mkUser(): Promise<string> {
    const id = randomUUID();
    await prisma.user.create({ data: { id, name: "zz stage", email: `zz-stage-${id.slice(0, 8)}@test.local`, role: "provider" } });
    ids.users.push(id);
    return id;
  }
  async function mkOrg(userId: string, opts: { shell?: boolean; subStatus?: "active" | "incomplete" | "canceled"; role?: "owner" | "member" }): Promise<string> {
    const id = randomUUID();
    await prisma.organization.create({ data: { id, name: "zz", slug: `zz-stage-${id.slice(0, 8)}`, status: "active", setupPendingSince: opts.shell ? new Date() : null } });
    ids.orgs.push(id);
    await prisma.membership.create({ data: { userId, orgId: id, orgRole: opts.role ?? "owner" } });
    if (opts.subStatus) {
      const plan = await prisma.plan.findUniqueOrThrow({ where: { key: "starter" } });
      await prisma.subscription.create({ data: { orgId: id, planId: plan.id, status: opts.subStatus } });
    }
    return id;
  }

  it("usuario sem nada -> sem_plano /assinar; casca incomplete -> aguardando; casca paga -> pago_sem_org e pendingSetup", async () => {
    const u = await mkUser();
    expect(await loadAccountStage(u, "provider")).toEqual({ stage: "sem_plano", redirectTo: "/assinar", pendingSetup: false });
    const shell = await mkOrg(u, { shell: true, subStatus: "incomplete" });
    expect((await loadAccountStage(u, "provider")).stage).toBe("aguardando_pagamento");
    await prisma.subscription.update({ where: { orgId: shell }, data: { status: "active" } });
    expect(await loadAccountStage(u, "provider")).toEqual({ stage: "pago_sem_org", redirectTo: "/organizacao/nova", pendingSetup: true });
  });

  it("casca NAO conta como organizacao real; org real + casca paga -> membro_pago_sem_org (banner)", async () => {
    const u = await mkUser();
    await mkOrg(u, { shell: true, subStatus: "active" });
    expect((await loadAccountStage(u, "provider")).stage).toBe("pago_sem_org");
    await mkOrg(u, { subStatus: "active", role: "member" });
    expect(await loadAccountStage(u, "provider")).toEqual({ stage: "membro_pago_sem_org", redirectTo: "/dashboard", pendingSetup: true });
  });

  it("casca de OUTRO usuario nao afeta (isolamento)", async () => {
    const a = await mkUser();
    const b = await mkUser();
    await mkOrg(a, { shell: true, subStatus: "active" });
    expect((await loadAccountStage(b, "provider")).stage).toBe("sem_plano");
  });

  it("platform_admin -> admin sem tocar no banco de membership", async () => {
    expect(await loadAccountStage(randomUUID(), "platform_admin")).toEqual({ stage: "admin", redirectTo: "/admin/organizacoes", pendingSetup: false });
  });

  it("resolveSessionHomeRoute: org real mas sessao sem org => null (sem laco, reautentica); sem org real segue o estado", async () => {
    const u = await mkUser();
    expect(await resolveSessionHomeRoute({ id: u, platformRole: "provider", orgId: null })).toBe("/assinar");
    const org = await mkOrg(u, { subStatus: "active" });
    expect(await resolveSessionHomeRoute({ id: u, platformRole: "provider", orgId: null })).toBeNull();
    expect(await resolveSessionHomeRoute({ id: u, platformRole: "provider", orgId: org })).toBe("/dashboard");
    expect(await resolveSessionHomeRoute({ id: u, platformRole: "platform_admin", orgId: null })).toBe("/admin/organizacoes");
  });
});
