// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { pathname: "/dashboard" };
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/actions/auth", () => ({ logout: vi.fn() }));
vi.mock("@/lib/actions/billing", () => ({ renameOrganization: vi.fn(), createPortalSession: vi.fn(), createCheckoutSession: vi.fn(), cancelSubscription: vi.fn(), reactivateSubscription: vi.fn(), signUp: vi.fn() }));
vi.mock("@/lib/actions/org", () => ({ switchActiveOrganization: vi.fn(), inviteMember: vi.fn() }));

import { TrialBanner } from "./TrialBanner";
import { TrialChip } from "@/components/layout/TrialChip";
import { Header } from "@/components/layout/Header";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { SidebarProvider } from "@/components/ui/sidebar";
import { NotificationsProvider } from "@/components/notifications/NotificationsProvider";
import { EMPTY_SUMMARY } from "@/lib/notifications/client-types";
import { NAV_ITEMS, RESTRICTED_NAV_SECTIONS } from "@/components/layout/nav-items";
import { UsageMeter } from "./UsageMeter";
import { LimitNotice, limitNoticeId } from "./LimitNotice";
import { TrialBlockedPanel } from "./TrialBlockedPanel";
import { UpgradeReturnNotice } from "./CheckoutReturnHandler";
import { SubscriptionSummaryCard } from "./SubscriptionSummaryCard";
import { PlanSelectionSection } from "./PlanSelectionSection";
import { GettingStartedCard, pendingSteps } from "@/components/dashboard/GettingStartedCard";
import { OrgNameCard } from "@/components/dashboard/OrgNameCard";
import { PlanIntentNote } from "@/components/dashboard/PlanIntentNote";
import { WhatsAppCreateButton } from "@/components/settings/WhatsAppCreateButton";
import type { UsageItem } from "./trial-ui";
import type { BillingSummary } from "@/lib/queries/billing";
import type { PlanView } from "@/lib/billing/plans";

beforeEach(() => {
  state.pathname = "/dashboard";
});

const user = { name: "Ana Souza", email: "ana@x.com" };
const item = (metric: UsageItem["metric"], used: number, limit: number | null, scope = "ativas"): UsageItem => ({ metric, label: metric, scope, used, limit });

describe("chip e banner (D-065-24): chip no Header, banner nos ultimos 3 dias", () => {
  it("TrialChip: rotulo completo para leitor de tela, link para a assinatura e botao 'Fazer upgrade'", () => {
    const html = renderToStaticMarkup(<TrialChip daysLeft={12} expiring={false} />);
    expect(html).toContain('aria-label="Teste grátis: 12 dias. Ver assinatura"');
    expect(html).toContain("Teste grátis: 12 dias");
    expect(html).toContain("Fazer upgrade");
    expect(html.match(/href="\/configuracoes\/assinatura"/g)).toHaveLength(2);
    // celular: chip compacto "12 d" e botao escondido (< md); area de toque 44px
    expect(html).toContain("12 d");
    expect(html).toContain("min-h-11");
    expect(html).toMatch(/hidden[^"]*md:inline-flex/);
  });
  it("TrialChip expirando usa o tom de aviso (e nao so cor: o texto tambem muda no banner)", () => {
    expect(renderToStaticMarkup(<TrialChip daysLeft={2} expiring />)).toContain("border-warning/50");
    expect(renderToStaticMarkup(<TrialChip daysLeft={2} expiring={false} />)).not.toContain("border-warning/50");
  });
  it("TrialBanner: role=status, texto de dias, CTA com foco visivel", () => {
    const html = renderToStaticMarkup(<TrialBanner daysLeft={3} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Faltam 3 dias do seu teste grátis");
    expect(html).toContain("Fazer upgrade");
    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain("flex-wrap"); // 390px: quebra de linha, sem scroll horizontal
  });
  it("Header: com trial mostra o chip; sem trial nao; restrito sem busca nem sino", () => {
    const wrap = (el: React.ReactNode) =>
      renderToStaticMarkup(
        <SidebarProvider>
          <NotificationsProvider initial={EMPTY_SUMMARY}>{el}</NotificationsProvider>
        </SidebarProvider>,
      );
    const withTrial = wrap(<Header user={user} initialTheme="light" trial={{ daysLeft: 9, expiring: false }} />);
    expect(withTrial).toContain("Teste grátis: 9 dias");
    expect(withTrial).toContain('aria-label="Buscar"');
    const noTrial = wrap(<Header user={user} initialTheme="dark" />);
    expect(noTrial).not.toContain("Teste grátis");
    const restricted = wrap(<Header user={user} initialTheme="light" restricted trial={{ daysLeft: 9, expiring: false }} />);
    expect(restricted).not.toContain('aria-label="Buscar"');
    expect(restricted).not.toContain("Teste grátis");
    expect(restricted).not.toMatch(/Notifica/);
    expect(restricted).toContain("Ativar tema escuro");
  });
});

describe("shell reduzido no trial expirado (D-065-13.4)", () => {
  const sidebar = (restricted: boolean) =>
    renderToStaticMarkup(
      <SidebarProvider defaultOpen>
        <NotificationsProvider initial={EMPTY_SUMMARY}>
          <AppSidebar user={user} restricted={restricted} />
        </NotificationsProvider>
      </SidebarProvider>,
    );
  it("so Assinatura e Minha conta; nenhum item do tenant", () => {
    state.pathname = "/configuracoes/assinatura";
    const html = sidebar(true);
    expect(html).toContain('href="/configuracoes/assinatura"');
    expect(html).toContain('href="/configuracoes/conta"');
    expect(html).toContain("Assinatura");
    expect(html).toContain("Minha conta");
    // (o logo continua apontando para /dashboard, que redireciona 1 salto para a assinatura)
    for (const { href } of NAV_ITEMS.filter((i) => i.href !== "/dashboard")) expect(html, href).not.toContain(`href="${href}"`);
    expect(html).not.toContain(">Dashboard<");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(RESTRICTED_NAV_SECTIONS.flatMap((s) => s.items).map((i) => i.href)).toEqual(["/configuracoes/assinatura", "/configuracoes/conta"]);
  });
  it("shell normal continua com todos os itens (sem regressao)", () => {
    const html = sidebar(false);
    for (const { href } of NAV_ITEMS) expect(html, href).toContain(`href="${href}"`);
    expect(html).not.toContain("Minha conta");
  });
  it("abas de Configuracoes: restrito mostra so Assinatura e Conta", () => {
    state.pathname = "/configuracoes/assinatura";
    const restricted = renderToStaticMarkup(<SettingsTabs isAdmin restricted />);
    expect(restricted).toContain("Assinatura");
    expect(restricted).toContain("Conta");
    for (const t of ["E-mail", "WhatsApp", "Supressão", "Equipe", "Agentes", "Integrações"]) expect(restricted, t).not.toContain(`>${t}<`);
    const normal = renderToStaticMarkup(<SettingsTabs isAdmin />);
    expect(normal).toContain(">E-mail<");
    expect(normal).toContain(">Equipe<");
  });
});

describe("tela de bloqueio (dono x membro) e retorno do checkout", () => {
  it("dono: titulo com data, dados guardados, role=status, titulo focavel e CTA 'Escolher plano'", () => {
    const html = renderToStaticMarkup(<TrialBlockedPanel isOwner ownerName="Ana" endedAt={new Date("2026-10-10T12:00:00Z")} neverGranted={false} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toMatch(/Seu teste grátis terminou em \d{2}\/\d{2}\/\d{4}/);
    expect(html).toContain("Seus dados estão guardados");
    expect(html).toContain('href="#planos"');
    expect(html).toContain("Escolher plano");
  });
  it("membro: sem botao de pagar e com o nome do proprietario", () => {
    const html = renderToStaticMarkup(<TrialBlockedPanel isOwner={false} ownerName="Ana" endedAt={new Date()} neverGranted={false} />);
    expect(html).toContain("Peça ao proprietário (Ana)");
    expect(html).not.toContain("Escolher plano");
    expect(html).not.toContain('href="#planos"');
  });
  it("ja usou o teste: mensagem generica", () => {
    const html = renderToStaticMarkup(<TrialBlockedPanel isOwner ownerName="Ana" endedAt={new Date()} neverGranted />);
    expect(html).toContain("Não foi possível liberar o teste grátis para este cadastro");
  });
  it("retorno do checkout: confirmando/timeout em role=status; idle nao renderiza; pago anuncia", () => {
    const confirming = renderToStaticMarkup(<UpgradeReturnNotice view="confirming" />);
    expect(confirming).toContain('role="status"');
    expect(confirming).toContain('aria-live="polite"');
    expect(confirming).toContain("Confirmando seu pagamento...");
    expect(renderToStaticMarkup(<UpgradeReturnNotice view="timeout" />)).toContain("nenhuma nova cobrança é feita");
    expect(renderToStaticMarkup(<UpgradeReturnNotice view="idle" />)).toBe("");
    expect(renderToStaticMarkup(<UpgradeReturnNotice view="paid" />)).toContain("Pagamento confirmado!");
  });
});

describe("UsageMeter e avisos de limite", () => {
  const items = [item("campaigns", 1, 1), item("whatsapp", 0, 1, "conectados"), item("email_accounts", 1, 1, "conectadas"), item("leads", 12, 50, "durante o teste"), item("sends", 3, null, "hoje")];
  it("uma linha por metrica; barra com aria-valuenow/max; cheio = texto 'Limite atingido' (nao so cor)", () => {
    const html = renderToStaticMarkup(<UsageMeter items={items} trialing />);
    expect(html).toContain("Uso do plano");
    expect(html).toMatch(/role="region"[^>]*aria-labelledby="usage-meter-title"|aria-labelledby="usage-meter-title"[^>]*role="region"/);
    expect(html.match(/data-metric=/g)).toHaveLength(5);
    expect(html.match(/role="progressbar"/g)).toHaveLength(4); // ilimitado nao tem barra
    expect(html).toContain('aria-valuemax="50"');
    expect(html).toContain('aria-valuenow="12"');
    expect(html).toContain("12 de 50");
    expect(html).toContain("Limite atingido");
    expect(html).toContain("3 (sem limite)");
    expect(html).toContain("aquecimento do número");
    expect(html).toContain('href="#planos"');
    expect(html).toContain("bg-destructive"); // barra cheia
  });
  it("plano pago: sem aviso de aquecimento do trial e sem link quando nada esta cheio", () => {
    const html = renderToStaticMarkup(<UsageMeter items={[item("campaigns", 1, 5)]} trialing={false} />);
    expect(html).not.toContain("aquecimento do número");
    expect(html).not.toContain("Chegou no limite?");
  });
  it("LimitNotice: so aparece no limite, com id para aria-describedby e CTA de upgrade", () => {
    expect(renderToStaticMarkup(<LimitNotice item={item("whatsapp", 0, 1)} />)).toBe("");
    expect(renderToStaticMarkup(<LimitNotice item={item("whatsapp", 1, null)} />)).toBe("");
    expect(renderToStaticMarkup(<LimitNotice item={undefined} />)).toBe("");
    const html = renderToStaticMarkup(<LimitNotice item={item("whatsapp", 1, 1)} />);
    expect(html).toContain(`id="${limitNoticeId("whatsapp")}"`);
    expect(html).toContain('role="note"');
    expect(html).toContain("Você já conectou 1 de 1 número de WhatsApp");
    expect(html).toContain("Fazer upgrade");
    const soft = renderToStaticMarkup(<LimitNotice item={item("campaigns", 1, 1)} soft hint="Salve como pausada." />);
    expect(soft).toContain("Salve como pausada.");
    expect(soft).not.toContain("Para continuar, faça upgrade do plano.");
  });
  it("botao de criar fica desabilitado e ligado ao aviso quando no limite", () => {
    const off = renderToStaticMarkup(<WhatsAppCreateButton disabled describedBy={limitNoticeId("whatsapp")} />);
    expect(off).toMatch(/<button[^>]*\sdisabled=""/);
    expect(off).toContain(`aria-describedby="${limitNoticeId("whatsapp")}"`);
    const on = renderToStaticMarkup(<WhatsAppCreateButton />);
    expect(on).not.toMatch(/<button[^>]*\sdisabled=""/);
    expect(on).not.toContain("aria-describedby");
  });
});

describe("Configuracoes > Assinatura no teste gratis", () => {
  const sub = (over: Partial<NonNullable<BillingSummary["subscription"]>> = {}): BillingSummary => ({
    ownerName: "Ana",
    trialNeverGranted: false,
    orgStatus: "active",
    isOwner: true,
    subscription: { planKey: "free", planName: "Teste gratis", status: "trialing", cadence: "monthly", currentPeriodEnd: null, cancelAtPeriodEnd: false, trialEndsAt: new Date("2026-10-20T12:00:00Z"), canceledAt: null, ...over },
  });
  const now = new Date("2026-10-15T12:00:00Z");
  it("free: prazo + dias, sem portal nem cancelar, com 'Fazer upgrade'", () => {
    const html = renderToStaticMarkup(<SubscriptionSummaryCard summary={sub()} now={now} />);
    expect(html).toContain("Teste grátis até");
    expect(html).toContain("faltam 5 dias");
    expect(html).toContain("nada é renovado sozinho");
    expect(html).toContain("Fazer upgrade");
    expect(html).not.toContain("Gerenciar assinatura");
    expect(html).not.toContain("Cancelar");
  });
  it("assinante pago continua com portal/cancelar (sem regressao)", () => {
    const html = renderToStaticMarkup(<SubscriptionSummaryCard summary={sub({ planKey: "starter", planName: "Starter", status: "active", trialEndsAt: null, currentPeriodEnd: new Date("2026-11-01T12:00:00Z") })} now={now} />);
    expect(html).toContain("Gerenciar assinatura");
    expect(html).not.toContain("Teste grátis até");
  });
  const plans: PlanView[] = [
    { key: "starter", name: "Starter", priceMonthlyCents: 9900, priceYearlyCents: 99000, limits: { maxCampaigns: 3, maxWhatsappInstances: 1, maxLeadsPerMonth: 500 }, selfServiceCheckout: true },
  ];
  it("selecao de plano: trial = 'Fazer upgrade' (sem 'Trocar'); bloqueado = 'Escolha um plano para voltar'; membro ve aviso e botoes desabilitados", () => {
    const trial = renderToStaticMarkup(<PlanSelectionSection plans={plans} currentPlanKey={null} hasSubscription={false} isOwner trialing />);
    expect(trial).toContain("Fazer upgrade");
    expect(trial).toContain("não viram crédito");
    expect(trial).not.toContain("Trocar para este plano");
    expect(trial).toContain('id="planos"');
    const blocked = renderToStaticMarkup(<PlanSelectionSection plans={plans} currentPlanKey={null} hasSubscription={false} isOwner blocked />);
    expect(blocked).toContain("Escolha um plano para voltar");
    expect(blocked).toContain("exatamente de onde parou");
    const member = renderToStaticMarkup(<PlanSelectionSection plans={plans} currentPlanKey={null} hasSubscription={false} isOwner={false} trialing />);
    expect(member).toContain("Somente o proprietário");
    expect(member).toMatch(/<button[^>]*\sdisabled=""[^>]*>(?:(?!<\/button>).)*Assinar/);
  });
});

describe("dashboard: cartoes de primeiro acesso (D-065-22/23)", () => {
  it("OrgNameCard: pergunta, campo pre-preenchido, salvar e 'Agora nao'; dispensar tem nome acessivel", () => {
    const html = renderToStaticMarkup(<OrgNameCard orgId="o1" currentName="Empresa de Ana" />);
    expect(html).toContain("Como se chama a sua empresa?");
    expect(html).toContain('value="Empresa de Ana"');
    expect(html).toContain('autoComplete="organization"');
    expect(html).toContain("Salvar nome");
    expect(html).toContain("Agora não");
    expect(html).toContain('aria-label="Dispensar: perguntar o nome da empresa mais tarde"');
    expect(html).toContain('role="region"');
    expect(html).toContain("min-h-11"); // toque >= 44px no celular
  });
  it("GettingStartedCard: 3 passos, feitos riscados com texto '(feito)'; tudo feito = some", () => {
    const html = renderToStaticMarkup(<GettingStartedCard orgId="o1" steps={{ channel: true, campaign: false, leads: false }} />);
    expect(html).toContain("Primeiros passos");
    expect(html).toContain("1 de 3");
    expect(html).toContain("(feito)");
    expect(html).toContain("(a fazer)");
    expect(html).toContain('href="/campanhas/nova"');
    expect(html).toContain('href="/leads"');
    expect(html).not.toContain('href="/configuracoes/email"'); // passo feito perde o CTA
    expect(pendingSteps({ channel: true, campaign: true, leads: true })).toBe(0);
    expect(renderToStaticMarkup(<GettingStartedCard orgId="o1" steps={{ channel: true, campaign: true, leads: true }} />)).toBe("");
  });
});

describe("intencao de plano da landing (D-065-23): so lembra e pre-seleciona, nunca abre checkout", () => {
  it("nota no dashboard aponta para a assinatura com plano e cadencia", () => {
    const html = renderToStaticMarkup(<PlanIntentNote planName="Pro" planKey="pro" cadence="yearly" />);
    expect(html).toContain("Você escolheu o plano");
    expect(html).toContain("/configuracoes/assinatura?plan=pro&amp;cadence=yearly#planos");
    expect(html).not.toMatch(/checkout/i);
  });
  it("PlanSelectionSection destaca o plano de intencao ('Escolhido por você') e a cadencia anual", () => {
    const plans: PlanView[] = [
      { key: "starter", name: "Starter", priceMonthlyCents: 9900, priceYearlyCents: 99000, limits: { maxCampaigns: 3, maxWhatsappInstances: 1, maxLeadsPerMonth: 500 }, selfServiceCheckout: true },
      { key: "pro", name: "Pro", priceMonthlyCents: 19900, priceYearlyCents: 199000, limits: { maxCampaigns: 10, maxWhatsappInstances: 3, maxLeadsPerMonth: 3000 }, selfServiceCheckout: true },
    ];
    const html = renderToStaticMarkup(<PlanSelectionSection plans={plans} currentPlanKey={null} hasSubscription={false} isOwner trialing initialPlanKey="starter" initialCadence="yearly" />);
    expect(html).toContain("Escolhido por você");
    expect(html).not.toContain("Mais popular");
    expect(html).toContain("/ ano");
  });
});
