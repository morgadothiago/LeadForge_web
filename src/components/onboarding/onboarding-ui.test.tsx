// @vitest-environment node
import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/assinar" }));
vi.mock("@/lib/actions/billing", () => ({
  startPlanCheckout: vi.fn(),
  getPlanCheckoutState: vi.fn(),
  cancelPendingSubscription: vi.fn(),
  completeOrganizationSetup: vi.fn(),
  signUp: vi.fn(),
  createCheckoutSession: vi.fn(),
}));
vi.mock("@/lib/actions/org", () => ({ joinByCode: vi.fn() }));
vi.mock("@/lib/actions/auth", () => ({ resendVerificationEmail: vi.fn(), logout: vi.fn() }));

import { PlanCheckoutSection, type PlanCheckoutSectionProps } from "./PlanCheckoutSection";
import { CheckoutReturn, CheckoutReturnView } from "./CheckoutReturn";
import { OrganizationSetupForm } from "./OrganizationSetupForm";
import { JoinByCodeForm } from "./JoinByCodeForm";
import { EmailVerificationNotice } from "./EmailVerificationNotice";
import { CancelPendingSubscription } from "./CancelPendingSubscription";
import { SetupPendingBadge } from "@/components/admin/OrganizationsList";
import { HeroSection } from "@/components/landing/HeroSection";
import { FinalCtaSection } from "@/components/landing/FinalCtaSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { SocialProofSection } from "@/components/landing/SocialProofSection";
import { applyServerErrors } from "@/components/org/org-format";
import { withoutCodeKey, POLL_MAX_MS } from "@/components/billing/plan-checkout-ui";
import type { PlanView } from "@/lib/billing/plans";

const plans: PlanView[] = [
  { key: "starter", name: "Starter", priceMonthlyCents: 9700, priceYearlyCents: 97000, limits: { maxCampaigns: 3, maxWhatsappInstances: 1, maxLeadsPerMonth: 500 }, selfServiceCheckout: true },
  { key: "pro", name: "Pro", priceMonthlyCents: 29700, priceYearlyCents: 297000, limits: { maxCampaigns: 10, maxWhatsappInstances: 3, maxLeadsPerMonth: 3000 }, selfServiceCheckout: true },
  { key: "business", name: "Business", priceMonthlyCents: 0, priceYearlyCents: null, limits: { maxCampaigns: null, maxWhatsappInstances: null, maxLeadsPerMonth: null }, selfServiceCheckout: false },
];

const base: PlanCheckoutSectionProps = {
  plans,
  initialPlanKey: null,
  initialCadence: "monthly",
  email: "ana@acme.com",
  emailVerified: true,
  cancelled: false,
  another: false,
  shellStatus: "none",
};
const render = (over: Partial<PlanCheckoutSectionProps> = {}) => renderToStaticMarkup(<PlanCheckoutSection {...base} {...over} />);

describe("/assinar (PlanCheckoutSection)", () => {
  it("lista os planos com Assinar (so cartao) e Business = Falar com vendas", () => {
    const html = render();
    expect(html).toContain("Escolha seu plano");
    expect((html.match(/>Assinar (Starter|Pro)</g) ?? []).length).toBe(2);
    expect(html).toContain("Sob consulta");
    expect(html).toContain("Falar com vendas");
    expect(html).toContain("Mensal");
    expect(html).toContain("Anual");
    expect(html).not.toMatch(/PIX|Pix/);
  });
  it("e-mail nao verificado: aviso com reenvio e botoes Assinar desabilitados ligados ao aviso", () => {
    const html = render({ emailVerified: false });
    expect(html).toContain("Confirme seu e-mail para assinar");
    expect(html).toContain("Reenviar e-mail");
    expect(html).toContain('id="email-verification"');
    const buttons = html.match(/<button[^>]*>(?:(?!<\/button>).)*Assinar/g) ?? [];
    expect(buttons.length).toBe(2);
    for (const b of buttons) {
      expect(b).toMatch(/disabled=""/);
      expect(b).toContain('aria-describedby="email-verification"');
    }
  });
  it("e-mail verificado: botoes habilitados, sem aviso", () => {
    const html = render();
    expect(html).not.toContain("Confirme seu e-mail para assinar");
    const buttons = html.match(/<button[^>]*>(?:(?!<\/button>).)*Assinar/g) ?? [];
    for (const b of buttons) expect(b).not.toMatch(/disabled=""/);
  });
  it("?plan= da landing destaca o plano escolhido; invalido nem chega (initialPlanKey null) e usa Mais popular", () => {
    expect(render({ initialPlanKey: "starter" })).toContain("Escolhido por você");
    const none = render();
    expect(none).toContain("Mais popular");
    expect(none).not.toContain("Escolhido por você");
  });
  it("cadencia inicial anual mostra preco anual", () => {
    expect(render({ initialCadence: "yearly" })).toMatch(/970,00/);
  });
  it("?checkout=cancel: aviso sem cobranca; pagamento iniciado e nao confirmado: link para o status", () => {
    expect(render({ cancelled: true })).toContain("Nenhuma cobrança foi feita");
    const waiting = render({ shellStatus: "incomplete" });
    expect(waiting).toContain("ainda não foi confirmado");
    expect(waiting).toContain('href="/assinar/retorno"');
  });
  it("past_due da casca: alerta + cancelar", () => {
    const html = render({ shellStatus: "past_due" });
    expect(html).toContain("Não conseguimos confirmar o último pagamento");
    expect(html).toContain("Cancelar assinatura");
  });
  it("2a organizacao (?nova=1): texto proprio; caminho para entrar por codigo sempre visivel", () => {
    const html = render({ another: true });
    expect(html).toContain("Escolha o plano da nova organização");
    expect(html).toContain("Cada organização tem a sua própria assinatura");
    expect(html).toContain('href="/entrar-em-organizacao"');
  });
  it("sem organizacao (another=false vindo da pagina): texto normal e sem 'Voltar ao painel'", () => {
    const html = render({ another: false });
    expect(html).toContain("Escolha seu plano");
    expect(html).not.toContain("Voltar ao painel");
  });
  it("botao Assinar mantem 'abrindo pagamento' ate a navegacao", () => {
    const src = readFileSync(new URL("./PlanCheckoutSection.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/setNavigating\(true\);\s*window\.location\.href/);
    expect(src).toContain("disabled={pending || navigating || !canPay}");
  });
  it("sem trial, 'gratis' nem 'sem cartao'", () => {
    expect(render({ another: true, cancelled: true })).not.toMatch(/14 dias|grátis|gratis|sem cartão|teste/i);
  });
});

describe("/assinar/retorno (CheckoutReturn)", () => {
  it("nasce em 'confirmando' com aria-live, sem liberar nada e sem ler ?checkout=success", () => {
    const html = renderToStaticMarkup(<CheckoutReturn />);
    expect(html).toContain("Confirmando seu pagamento");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain("/organizacao/nova");
    expect(html).not.toContain("Pagamento confirmado");
    const src = readFileSync(new URL("./CheckoutReturn.tsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/useSearchParams|searchParams\b/);
  });
});

describe("/assinar/retorno: estado de erro apos incomplete", () => {
  it("vista error tem 'Verificar de novo' e nao gira", () => {
    const html = renderToStaticMarkup(<CheckoutReturnView view="error" onCheckAgain={() => {}} />);
    expect(html).toContain("Verificar de novo");
    expect(html).toContain("Não foi possível consultar o pagamento");
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain("/organizacao/nova");
  });
  it("vista confirming nao oferece retry; paid so ela leva a /organizacao/nova", () => {
    const c = renderToStaticMarkup(<CheckoutReturnView view="confirming" onCheckAgain={() => {}} />);
    expect(c).not.toContain("Verificar de novo");
    expect(renderToStaticMarkup(<CheckoutReturnView view="timeout" onCheckAgain={() => {}} />)).toContain("Verificar de novo");
  });
  it("timeout de 3 min e limpeza de timers continuam no componente", () => {
    const src = readFileSync(new URL("./CheckoutReturn.tsx", import.meta.url), "utf8");
    expect(POLL_MAX_MS).toBe(180_000);
    expect(src).toContain("Date.now() - startedAt >= POLL_MAX_MS");
    expect(src).toContain("cancelled = true");
    expect(src).toContain("clearTimeout(timer)");
  });
});

describe("/organizacao/nova: payload no_paid_plan", () => {
  it("a chave code nunca entra na mensagem; so o _form", () => {
    const setError = vi.fn();
    const setFocus = vi.fn();
    const toastMsg = applyServerErrors(withoutCodeKey({ _form: ["Você ainda não tem um plano pago."], code: ["no_paid_plan"] }), setError, setFocus, ["name"]);
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith("root", { type: "server", message: "Você ainda não tem um plano pago." });
    expect(toastMsg).toBe("Você ainda não tem um plano pago.");
    expect(setError.mock.calls[0][1].message).not.toContain("no_paid_plan");
  });
});

describe("/organizacao/nova", () => {
  it("campo de nome (RHF), rotulo e botao", () => {
    const html = renderToStaticMarkup(<OrganizationSetupForm />);
    expect(html).toContain("Nome da organização");
    expect(html).toContain('name="name"');
    expect(html).toContain("Criar organização");
    expect(html).toContain("required");
  });
  it("cancelar assinatura disponivel", () => {
    expect(renderToStaticMarkup(<CancelPendingSubscription />)).toContain("Cancelar assinatura");
  });
});

describe("/entrar-em-organizacao", () => {
  it("campo de codigo e botao", () => {
    const html = renderToStaticMarkup(<JoinByCodeForm />);
    expect(html).toContain("Código de entrada");
    expect(html).toContain('name="code"');
    expect(html).toContain("Entrar na organização");
  });
});

describe("/minha-conta (verificacao de e-mail)", () => {
  it("verificado: selo; nao verificado: reenviar + atualizar", () => {
    expect(renderToStaticMarkup(<EmailVerificationNotice email="a@x.com" verified />)).toContain("confirmado");
    const html = renderToStaticMarkup(<EmailVerificationNotice email="a@x.com" verified={false} />);
    expect(html).toContain("ainda não foi confirmado");
    expect(html).toContain("Reenviar e-mail");
    expect(html).toContain("Já confirmei, atualizar");
  });
});

describe("admin: casca paga", () => {
  it("rotulo 'Em configuração'", () => {
    expect(renderToStaticMarkup(<SetupPendingBadge />)).toContain("Em configuração");
  });
});

describe("landing: teste gratis de 14 dias, sem promessa que nao existe (SPEC-065b, D-065-26)", () => {
  // O teste TEM limites e acaba: nunca prometer "sem limites", "7 dias", gratis permanente ou o que so existe em mock.
  const FORBIDDEN = /7 dias|sem limites|gratuit|para sempre|grátis para sempre|cancele quando quiser|Comece agora/i;
  const html = [
    renderToStaticMarkup(<HeroSection />),
    renderToStaticMarkup(<FinalCtaSection />),
    renderToStaticMarkup(<FeaturesSection />),
    renderToStaticMarkup(<PricingSection plans={plans} />),
    renderToStaticMarkup(<LandingNav initialTheme="light" />),
    renderToStaticMarkup(<LandingFooter />),
    renderToStaticMarkup(<SocialProofSection />),
  ].join("\n");
  it("nenhum texto proibido", () => {
    expect(html).not.toMatch(FORBIDDEN);
  });
  it("CTAs: 'Comece 14 dias grátis', sem cartão, limites reduzidos; o que acontece quando o teste acaba", () => {
    expect(renderToStaticMarkup(<HeroSection />)).toContain("Comece 14 dias grátis");
    expect(renderToStaticMarkup(<HeroSection />)).toContain("Sem cartão de crédito. Limites reduzidos no teste.");
    expect(renderToStaticMarkup(<FinalCtaSection />)).toContain("Comece 14 dias grátis");
    expect(renderToStaticMarkup(<LandingNav initialTheme="light" />)).toContain("Teste grátis");
    expect(renderToStaticMarkup(<LandingFooter />)).toContain("Teste grátis");
    const pricing = renderToStaticMarkup(<PricingSection plans={plans} />);
    expect(pricing).toContain("Teste 14 dias grátis e escolha o plano quando precisar.");
    expect(pricing).toContain("O que acontece quando o teste acaba?");
    expect(pricing).toContain("acesso fica pausado");
    expect(pricing).toContain("Começar 14 dias grátis");
  });
  it("CTAs levam a /signup; precos levam a /signup?plan&cadence; Business = vendas", () => {
    expect(html).toContain('href="/signup"');
    expect(html).toContain("/signup?plan=starter&amp;cadence=monthly");
    expect(html).toContain("no plano Starter");
    expect(html).toContain("Falar com vendas");
  });
  it("FeaturesSection nao promete lembrete automatico ao lead (SPEC-028 so lembra o usuario)", () => {
    const f = renderToStaticMarkup(<FeaturesSection />);
    expect(f).not.toMatch(/para o lead|e para o lead/);
    expect(f).toContain("lembrete automático para você");
  });
});
