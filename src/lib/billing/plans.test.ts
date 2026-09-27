import "dotenv/config";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { listActivePlans } from "./plans";

/** SPEC-034 — catálogo público de planos (D-33-2 seed: starter/pro self-service, business sob consulta). */
describe("listActivePlans", () => {
  it("devolve só planos ativos, do mais barato ao mais caro, sem exigir sessão", async () => {
    const plans = await listActivePlans();
    expect(plans.length).toBeGreaterThanOrEqual(3);
    const keys = plans.map((p) => p.key);
    expect(keys).toContain("starter");
    expect(keys).toContain("pro");
    expect(keys).toContain("business");
    for (let i = 1; i < plans.length; i++) expect(plans[i].priceMonthlyCents).toBeGreaterThanOrEqual(plans[i - 1].priceMonthlyCents);
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
