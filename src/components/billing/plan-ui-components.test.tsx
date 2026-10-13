// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiBudgetNotice, aiBudgetNoticeText } from "./AiBudgetNotice";
import { FeatureLockNotice, PlatformManagedNote, featureLockId, featureLockMessage } from "./FeatureLockNotice";
import { PlanComparison } from "./PlanComparison";
import { PlanFeaturesCard, featureRows } from "./PlanFeaturesCard";
import { UsageMeter } from "./UsageMeter";
import { LimitNotice } from "./LimitNotice";
import { buildAiBudget, toTenantView } from "@/lib/queries/entitlements";
import { resolveEntitlements, type EntitlementRow } from "@/lib/billing/entitlements";
import { planLimitsJson } from "@/lib/billing/plan-catalog";
import type { UsageItem } from "./trial-ui";

const NOW = new Date("2026-10-13T12:00:00Z");
const row = (key: "free" | "starter" | "pro" | "business", status: "active" | "past_due" = "active"): EntitlementRow => ({
  status: "active",
  subscription: { status, pastDueSince: status === "past_due" ? new Date("2026-10-10T00:00:00Z") : null, cancelAtPeriodEnd: false, currentPeriodEnd: new Date("2026-11-13T00:00:00Z"), trialEndsAt: null, plan: { key, limits: planLimitsJson(key) } },
  entitlementOverride: null,
});

describe("FeatureLockNotice / textos de bloqueio (069d)", () => {
  it("por plano: nome do plano necessario + upgrade; por pagamento: ver assinatura", () => {
    expect(featureLockMessage("agents.role.closer", "plan")).toEqual({ text: "Agente Closer: disponível no plano Pro.", cta: "Fazer upgrade" });
    expect(featureLockMessage("agents.role.closer", "past_due").cta).toBe("Ver assinatura");
    expect(featureLockMessage("agents.role.closer", "blocked").text).toMatch(/assinatura inativa/);
    const html = renderToStaticMarkup(<FeatureLockNotice feature="sources.ads" />);
    expect(html).toContain('role="note"');
    expect(html).toContain(`id="${featureLockId("sources.ads")}"`);
    expect(html).toContain("disponível no plano Pro");
    expect(html).toContain('href="/configuracoes/assinatura"');
    expect(renderToStaticMarkup(<PlatformManagedNote />)).toContain("Definido pela plataforma");
  });
});

describe("AiBudgetNotice (aviso ao owner 80%/100%)", () => {
  it("80% = atencao (status); 100% = pausado (alert); abaixo/sem teto = nada", () => {
    const cap = 5000;
    expect(aiBudgetNoticeText(buildAiBudget(1000 * 10_000, cap))).toBeNull(); // 20%
    const warn = buildAiBudget(4000 * 10_000, cap); // 80%
    expect(warn.state).toBe("alert");
    expect(aiBudgetNoticeText(warn)).toMatchObject({ tone: "warn" });
    const full = buildAiBudget(5000 * 10_000, cap);
    expect(full.state).toBe("exhausted");
    expect(aiBudgetNoticeText(full)).toMatchObject({ tone: "full" });
    expect(aiBudgetNoticeText(buildAiBudget(1e9, null))).toBeNull();
    expect(buildAiBudget(0, 0).state).toBe("not_included");
    expect(aiBudgetNoticeText(buildAiBudget(0, 0))).toBeNull();
    expect(renderToStaticMarkup(<AiBudgetNotice budget={full} />)).toMatch(/role="alert"[\s\S]*Teto de IA do mês atingido/);
    const html = renderToStaticMarkup(<AiBudgetNotice budget={warn} variant="banner" />).replace(/\u00a0/g, " ");
    expect(html).toContain('role="status"');
    expect(html).toContain("R$ 40,00 de R$ 50,00");
    expect(html).toContain("Fazer upgrade");
    expect(renderToStaticMarkup(<AiBudgetNotice budget={buildAiBudget(0, cap)} />)).toBe("");
  });
});

describe("AiBudgetNotice 100% (SPEC-069e): upgrade x suporte", () => {
  it("teto do plano: orienta upgrade; teto de override: orienta falar com o suporte, sem 'Faça upgrade'", () => {
    const plan = renderToStaticMarkup(<AiBudgetNotice budget={buildAiBudget(5000 * 10_000, 5000)} />);
    expect(plan).toContain("Faça upgrade");
    expect(plan).not.toContain("suporte");
    const ov = renderToStaticMarkup(<AiBudgetNotice budget={buildAiBudget(5000 * 10_000, 5000, true)} />);
    expect(ov).toContain("fale com o suporte");
    expect(ov).not.toContain("Faça upgrade");
    expect(ov).not.toContain("Fazer upgrade");
    expect(ov).toContain('href="/configuracoes/assinatura"');
  });
});

describe("PlanComparison (069d)", () => {
  it("tabela (desktop) + cartoes por grupo (mobile), com texto em toda celula e plano atual marcado", () => {
    const html = renderToStaticMarkup(<PlanComparison columns={["free", "starter", "pro", "business"]} currentKey="starter" />);
    expect(html).toContain("<caption");
    expect(html).toContain('scope="row"');
    expect(html).toContain("Seu plano");
    expect(html).toContain("Agente Closer");
    expect(html).toContain("Não inclui");
    expect(html).toContain("Ilimitado");
    expect(html).toContain("md:hidden"); // versao mobile
    expect(html).toContain("hidden overflow-hidden rounded-xl border border-border md:block"); // tabela so >= md (sem rolagem horizontal no mobile)
  });
});

describe("PlanFeaturesCard e medidores (069d)", () => {
  it("recursos incluidos x bloqueados do plano efetivo; sem BYOK na lista", () => {
    const view = toTenantView(resolveEntitlements("o", row("starter"), NOW), true);
    const rows = featureRows(view);
    expect(rows.find((r) => r.key === "agents.role.followup")).toMatchObject({ included: true, hint: null });
    expect(rows.find((r) => r.key === "agents.role.closer")).toMatchObject({ included: false, hint: "Disponível no plano Pro" });
    expect(rows.some((r) => r.key === "llm.byok")).toBe(false);
    const html = renderToStaticMarkup(<PlanFeaturesCard view={view} />);
    expect(html).toContain("O que o seu plano inclui");
    expect(html).toContain("não incluído");
    expect(html).toContain("Ver planos");
  });
  it("past_due: aviso de IA pausada; override ativo e informado", () => {
    const v = toTenantView(resolveEntitlements("o", row("pro", "past_due"), NOW), true);
    expect(v.paused).toBe(true);
    expect(v.costlyBlocked).toBe(true);
    expect(renderToStaticMarkup(<PlanFeaturesCard view={v} />)).toContain("pausados por pagamento em atraso");
    const ov = toTenantView(resolveEntitlements("o", { ...row("starter"), entitlementOverride: { features: { "sources.ads": true }, limits: {}, expiresAt: new Date("2030-01-31T23:59:59Z") } }, NOW), false);
    expect(ov.overrideActive).toBe(true);
    expect(ov.features["sources.ads"]).toBe(true);
    expect(renderToStaticMarkup(<PlanFeaturesCard view={ov} />)).toContain("ajustes liberados pela plataforma");
  });
  it("UsageMeter com itens extras: limite 0 = 'Não incluído', R$ formatado, ilimitado sem barra", () => {
    const items: UsageItem[] = [{ metric: "campaigns", label: "Campanhas ativas", scope: "ao mesmo tempo", used: 1, limit: 3 }];
    const extra: UsageItem[] = [
      { metric: "agents", label: "Agentes de IA ativos", scope: "ao mesmo tempo", used: 0, limit: 0 },
      { metric: "ai_budget", label: "Custo de IA", scope: "neste mês", used: 4000, limit: 5000, unit: "brl_cents" },
      { metric: "members", label: "Membros da equipe", scope: "na organização", used: 2, limit: null },
    ];
    const html = renderToStaticMarkup(<UsageMeter items={items} extraItems={extra} trialing={false} />).replace(/\u00a0/g, " ");
    expect(html).toContain("IA, equipe e conteúdo");
    expect(html).toContain("Não incluído no seu plano");
    expect(html).toContain("R$ 40,00 de R$ 50,00");
    expect(html).toContain("2 (sem limite)");
    expect(html).not.toMatch(/0 de 0/);
    expect(html).not.toContain("Limite atingido"); // nenhum item cheio: 0 = nao incluido, nao 'atingido'
  });
  it("LimitNotice de recurso nao incluido no plano (limite 0)", () => {
    const html = renderToStaticMarkup(<LimitNotice item={{ metric: "creatives", label: "Criativos de vídeo", scope: "neste mês", used: 0, limit: 0 }} />);
    expect(html).toContain("Criativos de vídeo: não incluído no seu plano.");
    expect(html).toContain("Fazer upgrade");
  });
});
