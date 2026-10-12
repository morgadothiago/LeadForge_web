// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/dashboard" }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/lib/actions/org", () => ({
  switchActiveOrganization: vi.fn(), leaveOrganization: vi.fn(), acceptInvite: vi.fn(), signUpAndJoin: vi.fn(),
  inviteMember: vi.fn(), revokeInvite: vi.fn(), changeMemberRole: vi.fn(), removeMember: vi.fn(), generateJoinCode: vi.fn(), disableJoinCode: vi.fn(), previewInvite: vi.fn(),
}));
vi.mock("@/lib/actions/auth", () => ({ logout: vi.fn() }));
vi.mock("@/lib/actions/billing", () => ({ signUp: vi.fn(), createCheckoutSession: vi.fn() }));

import { SidebarProvider } from "@/components/ui/sidebar";
import { OrgSwitcher } from "./OrgSwitcher";
import { InviteLanding } from "./InviteLanding";
import { TeamPanel } from "./TeamPanel";
import { MyOrganizations } from "./MyOrganizations";
import { SignupForm } from "@/components/auth/SignupForm";
import type { MyOrganization, TeamView } from "@/lib/actions/org";

const orgs: MyOrganization[] = [
  { orgId: "a", name: "Acme Ltda", slug: "acme", status: "active", orgRole: "owner", isActive: true },
  { orgId: "b", name: "Beta SA", slug: "beta", status: "suspended", orgRole: "member", isActive: false },
];

describe("OrgSwitcher", () => {
  it("com 1 organização também renderiza (D-049-16), para achar o Criar organização", () => {
    const html = renderToStaticMarkup(<SidebarProvider><OrgSwitcher organizations={[orgs[0]]} /></SidebarProvider>);
    expect(html).toContain("Acme Ltda");
    expect(html).toContain("Organização ativa: Acme Ltda. Trocar de organização");
  });
  it("owner ativo vê Convidar pessoas e Criar organização no menu; member não vê Convidar", () => {
    const owner = renderToStaticMarkup(<SidebarProvider><OrgSwitcher organizations={orgs} /></SidebarProvider>);
    expect(owner).toContain("Organização ativa: Acme Ltda");
    const member = renderToStaticMarkup(<SidebarProvider><OrgSwitcher organizations={[{ ...orgs[0], orgRole: "member" }]} /></SidebarProvider>);
    expect(member).toContain("Acme Ltda");
    expect(member).not.toContain("Convidar");
  });
  it("sem organizações não renderiza", () => {
    expect(renderToStaticMarkup(<SidebarProvider><OrgSwitcher organizations={[]} /></SidebarProvider>)).not.toContain("Organização ativa");
  });
  it("com 2+ mostra a org ativa e rótulo acessível", () => {
    const html = renderToStaticMarkup(<SidebarProvider><OrgSwitcher organizations={orgs} /></SidebarProvider>);
    expect(html).toContain("Acme Ltda");
    expect(html).toContain("Organização ativa: Acme Ltda. Trocar de organização");
  });
});

describe("MyOrganizations", () => {
  it("lista com selo de ativa/suspensa e ações por linha", () => {
    const html = renderToStaticMarkup(<MyOrganizations organizations={orgs} />);
    expect(html).toContain("Ativa agora");
    expect(html).toContain("Suspensa");
    expect(html).toContain("Usar esta organização");
    expect(html).toContain("Nova organização");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>\s*<svg[^>]*><[^>]*><\/svg>\s*Sair/);
  });
  it("owner: Convidar e Equipe só na linha ativa; Gerenciar equipe nas outras que é owner", () => {
    const two = [orgs[0], { ...orgs[1], status: "active", orgRole: "owner" as const }];
    const html = renderToStaticMarkup(<MyOrganizations organizations={two} />);
    expect((html.match(/Convidar/g) ?? []).length).toBe(1);
    expect(html).toContain('href="/configuracoes/equipe"');
    expect(html).toContain("Gerenciar equipe");
  });
  it("member: sem Convidar/Equipe/Gerenciar equipe", () => {
    const html = renderToStaticMarkup(<MyOrganizations organizations={[{ ...orgs[0], orgRole: "member" }, orgs[1]]} />);
    expect(html).not.toContain("Convidar");
    expect(html).not.toContain("Gerenciar equipe");
    expect(html).not.toContain("/configuracoes/equipe");
  });
  it("org única: Sair desabilitado + explicação", () => {
    const html = renderToStaticMarkup(<MyOrganizations organizations={[orgs[0]]} />);
    expect(html).toContain("não pode sair da sua única organização");
    expect(html).toMatch(/disabled[^>]*aria-describedby="leave-hint"|aria-describedby="leave-hint"[^>]*disabled/);
  });
  it("estado vazio", () => {
    expect(renderToStaticMarkup(<MyOrganizations organizations={[]} />)).toContain("ainda não participa");
  });
});

describe("InviteLanding", () => {
  it("inválido é genérico, sem dizer o motivo", () => {
    const html = renderToStaticMarkup(<InviteLanding token="t" state={{ kind: "invalid" }} />);
    expect(html).toContain("Convite inválido ou expirado");
    expect(html).not.toMatch(/revogad|já foi usado|não existe/i);
  });
  it("usuário novo: form com e-mail somente leitura, nome e senha", () => {
    const html = renderToStaticMarkup(<InviteLanding token="t" state={{ kind: "signup", orgName: "Acme", email: "n@x.com", orgRole: "member" }} />);
    expect(html).toContain("Criar conta e entrar");
    expect(html).toContain('value="n@x.com"');
    expect(html).toContain("readOnly");
  });
  it("e-mail já cadastrado: leva ao login com next do convite", () => {
    const html = renderToStaticMarkup(<InviteLanding token="tok" state={{ kind: "login", orgName: "Acme", email: "n@x.com", orgRole: "owner" }} />);
    expect(html).toContain("/login?next=%2Fconvite%2Ftok");
  });
  it("logado com e-mail certo: aceitar; com outro: orienta sair", () => {
    expect(renderToStaticMarkup(<InviteLanding token="t" state={{ kind: "accept", orgName: "Acme", email: "n@x.com", orgRole: "member" }} />)).toContain("Aceitar convite");
    const wrong = renderToStaticMarkup(<InviteLanding token="t" state={{ kind: "wrong-account", orgName: "Acme", inviteEmail: "n@x.com", currentEmail: "o@x.com" }} />);
    expect(wrong).toContain("outro e-mail");
    expect(wrong).toContain("Sair");
    expect(wrong).not.toContain("n@x.com");
    expect(wrong).toContain("n***@x.com");
  });
});

describe("TeamPanel", () => {
  const base: TeamView = {
    orgRole: "owner",
    members: [
      { userId: "1", name: "Dona", email: "d@x.com", orgRole: "owner", joinedAt: new Date("2026-01-02"), isSelf: true },
      { userId: "2", name: "Zé", email: "z@x.com", orgRole: "member", joinedAt: new Date("2026-02-02"), isSelf: false },
    ],
    invites: [{ id: "i1", email: "novo@x.com", orgRole: "member", expiresAt: new Date("2026-10-20"), createdAt: new Date("2026-10-10") }],
    joinCode: { code: "ABCD-EFGH-JKLM-NPQR-STUV", expiresAt: new Date("2026-10-20"), maxUses: 10, uses: 1, expired: false, exhausted: false },
  };
  it("owner: convida, gere código, altera papel, remove e revoga; último owner não pode ser rebaixado", () => {
    const html = renderToStaticMarkup(<TeamPanel team={base} />);
    expect(html).toContain("Convidar por e-mail");
    expect(html).toContain("ABCD-EFGH-JKLM-NPQR-STUV");
    expect(html).toContain("Gerar novo código");
    expect(html).toContain("Revogar convite de novo@x.com");
    expect(html).toContain("Remover Zé");
    expect(html).not.toContain("Remover Dona");
    expect(html).toContain("Tornar proprietário");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Tornar membro/);
  });
  it("member: lista somente leitura, sem ações nem seções de convite/código", () => {
    const html = renderToStaticMarkup(<TeamPanel team={{ ...base, orgRole: "member", invites: [], joinCode: null }} />);
    expect(html).toContain("Dona");
    expect(html).not.toContain("Convidar por e-mail");
    expect(html).not.toContain("Código de entrada");
    expect(html).not.toContain("Remover");
    expect(html).toContain("Só proprietários");
  });
  it("owner sem convites/código: estados vazios", () => {
    const html = renderToStaticMarkup(<TeamPanel team={{ ...base, invites: [], joinCode: null }} />);
    expect(html).toContain("Nenhum convite pendente");
    expect(html).toContain("Gerar código de entrada");
  });
});

describe("SignupForm (SPEC-062: so usuario)", () => {
  beforeEach(() => vi.clearAllMocks());
  it("campos nome, e-mail, CPF ou CNPJ (SPEC-065, minimo) e senha; sem empresa, plano, trial nem escolha de organizacao", () => {
    const html = renderToStaticMarkup(<SignupForm />);
    for (const label of ["Nome", "E-mail", "CPF ou CNPJ", "Senha"]) expect(html).toContain(label);
    expect(html).not.toContain("Nome da empresa");
    expect(html).not.toContain('type="radio"');
    expect(html).not.toMatch(/14 dias|grátis|sem cartão|Participar de uma organização/);
  });
});
