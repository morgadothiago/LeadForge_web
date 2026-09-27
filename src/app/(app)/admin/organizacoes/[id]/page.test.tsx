// @vitest-environment node
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// SPEC-032: a página renderiza `OrganizationStatusActions` (client component), que chama `useRouter()`.
// `redirect()`/`notFound()` (também de "next/navigation") continuam reais — só `useRouter` precisa de
// mock aqui, porque `renderToStaticMarkup` não passa pelo pipeline de request do App Router.
vi.mock("next/navigation", async (importActual) => {
  const actual = await importActual<typeof import("next/navigation")>();
  return { ...actual, useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) };
});

import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import Page from "./page";

/** SPEC-032 — mesma negação de acesso do teste da lista, agora para o detalhe (URL direta com id válido). */

const TAG = "spec032-detail";
let org: TestOrg;
let orgName: string;
let adminUserId: string;

async function createAdmin(): Promise<string> {
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

const p = (id: string) => Promise.resolve({ id });

describe("/admin/organizacoes/[id] (SPEC-032) — negação de acesso", () => {
  it("sem sessão -> redireciona para /login", async () => {
    signOut();
    const err = await Page({ params: p(org.orgId) }).catch((e) => e);
    expect((err as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT;replace;\/login;/);
  });

  it("provider comum -> redireciona para /dashboard, mesmo acessando o id real de uma org existente", async () => {
    await signInAs(org.userId, { orgId: org.orgId, platformRole: "provider" });
    const err = await Page({ params: p(org.orgId) }).catch((e) => e);
    expect((err as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT;replace;\/dashboard;/);
  });
});

describe("/admin/organizacoes/[id] (SPEC-032) — platform_admin", () => {
  it("id com formato inválido -> 404", async () => {
    await signInAs(adminUserId, { orgId: null, platformRole: "platform_admin" });
    const err = await Page({ params: p("nao-e-um-uuid") }).catch((e) => e);
    expect((err as { digest?: string }).digest).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("uuid válido mas organização inexistente -> 404", async () => {
    await signInAs(adminUserId, { orgId: null, platformRole: "platform_admin" });
    const err = await Page({ params: p(randomUUID()) }).catch((e) => e);
    expect((err as { digest?: string }).digest).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("renderiza o detalhe com nome, status e botão de suspender (org ativa)", async () => {
    await signInAs(adminUserId, { orgId: null, platformRole: "platform_admin" });
    const el = await Page({ params: p(org.orgId) });
    const html = renderToStaticMarkup(el);
    expect(html).toContain(orgName);
    expect(html).toContain("Ativa");
    expect(html).toContain("Suspender organização");
  });

  it("org suspensa mostra botão de reativar, não de suspender", async () => {
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "suspended" } });
    await signInAs(adminUserId, { orgId: null, platformRole: "platform_admin" });
    const el = await Page({ params: p(org.orgId) });
    const html = renderToStaticMarkup(el);
    expect(html).toContain("Reativar organização");
    expect(html).not.toContain("Suspender organização");
    await prisma.organization.update({ where: { id: org.orgId }, data: { status: "active" } });
  });
});
