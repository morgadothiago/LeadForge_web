import "dotenv/config";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { listActivePlans } from "./plans";

/** SPEC-034 — catálogo público de planos (D-33-2 seed: starter/pro self-service, business sob consulta). */
describe("listActivePlans", () => {
  it("devolve só planos ativos (self-service do mais barato ao mais caro; sob consulta por último), sem exigir sessão", async () => {
    const plans = await listActivePlans();
    expect(plans.length).toBeGreaterThanOrEqual(3);
    const keys = plans.map((p) => p.key);
    expect(keys).toContain("starter");
    expect(keys).toContain("pro");
    expect(keys).toContain("business");
    const selfService = plans.filter((p) => p.selfServiceCheckout);
    for (let i = 1; i < selfService.length; i++) expect(selfService[i].priceMonthlyCents).toBeGreaterThanOrEqual(selfService[i - 1].priceMonthlyCents);
    // SPEC-062b: "sob consulta" (sem checkout self-service, ex. Business) nunca vem antes de um plano self-service.
    const firstConsult = plans.findIndex((p) => !p.selfServiceCheckout);
    if (firstConsult >= 0) expect(plans.slice(firstConsult).every((p) => !p.selfServiceCheckout)).toBe(true);
  });

  it("starter/pro são self-service; business não", async () => {
    const plans = await listActivePlans();
    const byKey = new Map(plans.map((p) => [p.key, p]));
    expect(byKey.get("starter")?.selfServiceCheckout).toBe(true);
    expect(byKey.get("pro")?.selfServiceCheckout).toBe(true);
    expect(byKey.get("business")?.selfServiceCheckout).toBe(false);
  });

  it("limites (D-33-2, placeholder) vêm parseados; null = ilimitado", async () => {
    const plans = await listActivePlans();
    const starter = plans.find((p) => p.key === "starter")!;
    expect(starter.limits.maxCampaigns).toBe(3);
    const business = plans.find((p) => p.key === "business")!;
    expect(business.limits.maxCampaigns).toBeNull();
  });

  it("plano 'courtesy' (SPEC-040, D-040-2) nunca aparece na vitrine pública, mesmo ativo", async () => {
    const plans = await listActivePlans();
    expect(plans.map((p) => p.key)).not.toContain("courtesy");
  });

  it("plano inativo não aparece na lista", async () => {
    await prisma.plan.update({ where: { key: "business" }, data: { active: false } });
    try {
      const plans = await listActivePlans();
      expect(plans.map((p) => p.key)).not.toContain("business");
    } finally {
      await prisma.plan.update({ where: { key: "business" }, data: { active: true } });
    }
  });
});
