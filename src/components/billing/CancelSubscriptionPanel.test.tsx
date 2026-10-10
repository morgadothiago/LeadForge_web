// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/billing", () => ({ cancelSubscription: vi.fn(), reactivateSubscription: vi.fn(), createPortalSession: vi.fn(), createCheckoutSession: vi.fn() }));

import { CancelSubscriptionPanel, cancelConsequences } from "./CancelSubscriptionPanel";
import { cancelUiState, purgeDateFor } from "./billing-format";
import { cancelConfirmSchema } from "@/lib/schemas/billing";
import type { SubscriptionView } from "@/lib/queries/billing";

const NOW = new Date("2026-10-10T12:00:00Z");
const base: SubscriptionView = {
  planKey: "pro", planName: "Pro", status: "active", cadence: "monthly",
  currentPeriodEnd: new Date("2026-11-01T12:00:00Z"), cancelAtPeriodEnd: false, trialEndsAt: null, canceledAt: null,
};

describe("cancelUiState / purgeDateFor", () => {
  it("ativa sem agendamento = none; agendada no futuro = scheduled; agendada vencida ou canceled = canceled", () => {
    expect(cancelUiState(base, NOW)).toBe("none");
    expect(cancelUiState({ ...base, cancelAtPeriodEnd: true }, NOW)).toBe("scheduled");
    expect(cancelUiState({ ...base, cancelAtPeriodEnd: true, currentPeriodEnd: new Date("2026-10-01T00:00:00Z") }, NOW)).toBe("canceled");
    expect(cancelUiState({ ...base, status: "canceled" }, NOW)).toBe("canceled");
  });
  it("expurgo: agendado = fim do período + 90d; efetivado = canceledAt + 90d", () => {
    expect(purgeDateFor(base, "scheduled")?.toISOString()).toBe("2027-01-30T12:00:00.000Z");
    expect(purgeDateFor({ ...base, canceledAt: new Date("2026-10-01T00:00:00Z") }, "canceled")?.toISOString()).toBe("2026-12-30T00:00:00.000Z");
    expect(purgeDateFor(base, "none")).toBeNull();
  });
});

describe("CancelSubscriptionPanel (SSR)", () => {
  it("owner com plano normal vê o botão Cancelar assinatura; não-owner não vê nada", () => {
    expect(renderToStaticMarkup(<CancelSubscriptionPanel subscription={base} isOwner now={NOW} />)).toContain("Cancelar assinatura");
    expect(renderToStaticMarkup(<CancelSubscriptionPanel subscription={base} isOwner={false} now={NOW} />)).toBe("");
  });
  it("cancelamento agendado: mostra data, retenção e Manter assinatura (só owner)", () => {
    const sub = { ...base, cancelAtPeriodEnd: true };
    const owner = renderToStaticMarkup(<CancelSubscriptionPanel subscription={sub} isOwner now={NOW} />);
    expect(owner).toContain("Cancelamento agendado");
    expect(owner).toContain("Manter assinatura");
    expect(owner).toContain("90 dias");
    const member = renderToStaticMarkup(<CancelSubscriptionPanel subscription={sub} isOwner={false} now={NOW} />);
    expect(member).toContain("Cancelamento agendado");
    expect(member).not.toContain("Manter assinatura");
  });
  it("cancelada: aviso de retenção e botão Reassinar para owner", () => {
    const sub = { ...base, status: "canceled" as const, canceledAt: new Date("2026-10-01T00:00:00Z") };
    const owner = renderToStaticMarkup(<CancelSubscriptionPanel subscription={sub} isOwner now={NOW} />);
    expect(owner).toContain("Assinatura cancelada");
    expect(owner).toContain('href="#planos"');
    expect(owner).toContain("Reassinar");
    expect(renderToStaticMarkup(<CancelSubscriptionPanel subscription={sub} isOwner={false} now={NOW} />)).not.toContain("Reassinar");
  });
});

describe("cancelConsequences + schema", () => {
  it("plano pago: acesso até o fim do período, retenção 90 dias e sem reembolso", () => {
    const t = cancelConsequences(base, purgeDateFor(base, "scheduled")).join(" ");
    expect(t).toContain("mantém o acesso completo até");
    expect(t).toContain("90 dias");
    expect(t).toContain("Não há reembolso");
  });
  it("trial: efeito imediato", () => {
    const trial = { ...base, status: "trialing" as const };
    expect(cancelConsequences(trial, null)[0]).toContain("vale imediatamente");
  });
  it("zod exige a confirmação marcada", () => {
    expect(cancelConfirmSchema.safeParse({ confirm: false }).success).toBe(false);
    expect(cancelConfirmSchema.safeParse({ confirm: true }).success).toBe(true);
  });
});
