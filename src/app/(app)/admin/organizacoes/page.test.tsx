// @vitest-environment node
import "dotenv/config";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import Page from "./page";

/**
 * SPEC-032 — "provider nunca acessa a rota, mesmo digitando a URL direto": estes testes chamam a
 * página diretamente (sem passar por sidebar/link nenhum) e verificam a negação no servidor, não em
 * UI escondida. `redirect()`/`notFound()` do Next lançam um erro com `.digest` reconhecível — é isso
 * que verificamos aqui (mesmo mecanismo que o App Router usa em produção).
 */

const TAG = "spec032-list";
let org: TestOrg;
let orgName: string;
let adminUserId: string;

async function createAdmin(): Promise<string> {
  const { randomUUID } = await import("node:crypto");
  const id = randomUUID();
  await prisma.user.create({ data: { id, name: `zz-${TAG} admin`, email: `zz-${TAG}-${id.slice(0, 8)}@test.local`, role: "platform_admin" } });
  return id;
}

beforeAll(async () => {
  org = await createTestOrg(TAG);
  orgName = (await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId }, select: { name: true } })).name;
  adminUserId = await createAdmin();
});

afterAll(async () => {
  signOut();
  await prisma.user.deleteMany({ where: { id: adminUserId } });
  await purgeTestOrg(org);
  await prisma.$disconnect();
});

const emptyParams = () => Promise.resolve({});

describe("/admin/organizacoes (SPEC-032) — negação de acesso", () => {
  it("sem sessão -> redireciona para /login (não renderiza nada da lista)", async () => {
    signOut();
    const err = await Page({ searchParams: emptyParams() }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT;replace;\/login;/);
  });

  it("provider comum -> redireciona para /dashboard (nunca vê a lista de organizações)", async () => {
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    const err = await Page({ searchParams: emptyParams() }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT;replace;\/dashboard;/);
  });
});

describe("/admin/organizacoes (SPEC-032) — platform_admin", () => {
  it("renderiza a lista com a organização de teste e paginação", async () => {
    await signInAs(adminUserId, { orgId: null, platformRole: "platform_admin" });
    const el = await Page({ searchParams: emptyParams() });
    const html = renderToStaticMarkup(el);
    expect(html).toContain("Administração");
    expect(html).toContain(orgName);
    expect(html).toContain("Página");
  });

  it("busca por nome filtra e reseta a página (nenhuma quebra ao filtrar)", async () => {
    await signInAs(adminUserId, { orgId: null, platformRole: "platform_admin" });
    const el = await Page({ searchParams: Promise.resolve({ q: "zz-nao-existe-nenhuma-org-com-esse-nome" }) });
    const html = renderToStaticMarkup(el);
    expect(html).toContain("Nenhuma organização");
  });
});
