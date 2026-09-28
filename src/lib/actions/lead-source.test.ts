import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { seed, SEED_IDS } from "../../../prisma/seed";
import { signInAs, signInAsSeedAdmin, signOut } from "@/lib/auth/test-helpers";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { metaPageTokenName, readIntegrationSecretValue } from "@/lib/lead-source/secrets";
import { listLeadSourceBindings, listLeadSourceCampaigns } from "@/lib/queries/lead-source";
import { removeLeadSourceBinding, saveLeadSourceBinding } from "./lead-source";

const TAG = "zz-ls041";
const G_KEY = `${TAG}-gkey`; // casou com o GOOGLE_KEY_RE do webhook
const PAGE_A = "111222333444555"; // page_id Meta (<= 32)
const PAGE_B = "999888777666555";
const TOKEN_1 = `EAA${"x".repeat(40)}`;
const TOKEN_2 = `EAA${"y".repeat(40)}`;

let orgB: TestOrg;
let campSeed: string;
let campArchived: string;
let campB: string;
const savedEnc = process.env.ENCRYPTION_KEY;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64"); // chave falsa, só em memória
  await seed(prisma);
  // higiene de execuções anteriores (o banco de teste não é recriado por arquivo)
  await prisma.campaign.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.integrationSecret.deleteMany({ where: { integration: "meta_leads" } });
  await prisma.integrationAuditLog.deleteMany({ where: { integration: { in: ["meta_leads", "google_ads_leads"] } } });

  await signInAsSeedAdmin();
  campSeed = (await prisma.campaign.create({ data: { name: `${TAG} seed`, orgId: SEED_IDS.org, icpId: SEED_IDS.icp, userId: SEED_IDS.user } })).id;
  campArchived = (await prisma.campaign.create({ data: { name: `${TAG} arquivada`, orgId: SEED_IDS.org, icpId: SEED_IDS.icp, userId: SEED_IDS.user, status: "archived" } })).id;

  orgB = await createTestOrg("ls041");
  const icpB = await prisma.icpProfile.create({
    data: { orgId: orgB.orgId, name: `${TAG} icp-b`, niche: "Teste", signals: [], keywords: [], sources: [], desiredData: [] },
  });
  campB = (await prisma.campaign.create({ data: { name: `${TAG} camp-b`, orgId: orgB.orgId, icpId: icpB.id, userId: orgB.userId } })).id;
}, 30000);

afterAll(async () => {
  await signOut();
  await prisma.campaign.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.integrationSecret.deleteMany({ where: { integration: "meta_leads" } });
  await prisma.integrationAuditLog.deleteMany({ where: { integration: { in: ["meta_leads", "google_ads_leads"] } } });
  await purgeTestOrg(orgB);
  if (savedEnc === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = savedEnc;
  await prisma.$disconnect();
});

const tokenName = metaPageTokenName(PAGE_A);

describe("validação (zod + ações pré-transação)", () => {
  it("google_ads: charset do identificador, token proibido, campanha inválida/arquivada — nada é salvo", async () => {
    await signInAsSeedAdmin();
    const badId = await saveLeadSourceBinding({ provider: "google_ads", externalAccountId: "com espaço", campaignId: campSeed });
    expect(badId.ok).toBe(false);
    if (!badId.ok) expect(badId.errors.externalAccountId?.[0]).toMatch(/letras, números/);

    const withToken = await saveLeadSourceBinding({ provider: "google_ads", externalAccountId: G_KEY, campaignId: campSeed, pageToken: TOKEN_1 });
    expect(withToken.ok).toBe(false);
    if (!withToken.ok) expect(withToken.errors.pageToken?.[0]).toMatch(/não usa Page Access Token/);

    const missing = await saveLeadSourceBinding({ provider: "google_ads", externalAccountId: G_KEY, campaignId: "00000000-0000-4000-8000-000000000000" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.campaignId?.[0]).toBe("Campanha inválida.");

    const archived = await saveLeadSourceBinding({ provider: "google_ads", externalAccountId: G_KEY, campaignId: campArchived });
    expect(archived.ok).toBe(false);
    if (!archived.ok) expect(archived.errors.campaignId?.[0]).toMatch(/arquivada/);

    expect(await prisma.leadSourceBinding.count({ where: { externalAccountId: G_KEY } })).toBe(0);
  });

  it("meta: criação exige Page Access Token; token curto e page_id > 32 caracteres recusados", async () => {
    await signInAsSeedAdmin();
    const noToken = await saveLeadSourceBinding({ provider: "meta", externalAccountId: PAGE_A, campaignId: campSeed });
    expect(noToken.ok).toBe(false);
    if (!noToken.ok) expect(noToken.errors.pageToken?.[0]).toMatch(/Page Access Token/);

    const shortToken = await saveLeadSourceBinding({ provider: "meta", externalAccountId: PAGE_A, campaignId: campSeed, pageToken: "curto" });
    expect(shortToken.ok).toBe(false);
    if (!shortToken.ok) expect(shortToken.errors.pageToken?.[0]).toMatch(/ao menos 12/);

    const longId = await saveLeadSourceBinding({ provider: "meta", externalAccountId: "1".repeat(33), campaignId: campSeed, pageToken: TOKEN_1 });
    expect(longId.ok).toBe(false);
    if (!longId.ok) expect(longId.errors.externalAccountId?.[0]).toMatch(/32 caracteres/);

    expect(await prisma.leadSourceBinding.count({ where: { externalAccountId: PAGE_A } })).toBe(0);
    expect(await prisma.integrationSecret.count({ where: { name: tokenName } })).toBe(0);
  });
});

describe("criar / editar / listar", () => {
  it("google_ads: cria e faz upsert sem duplicar; lista expõe campanha e nunca token", async () => {
    await signInAsSeedAdmin();
    const created = await saveLeadSourceBinding({ provider: "google_ads", externalAccountId: G_KEY, label: `${TAG} conta`, campaignId: campSeed });
    expect(created.ok).toBe(true);
    const row = (await listLeadSourceBindings()).find((b) => b.externalAccountId === G_KEY);
    expect(row).toMatchObject({
      provider: "google_ads",
      label: `${TAG} conta`,
      campaignId: campSeed,
      campaignName: `${TAG} seed`,
      tokenHint: null,
    });

    const again = await saveLeadSourceBinding({ provider: "google_ads", externalAccountId: G_KEY, label: "", campaignId: campSeed });
    expect(again.ok).toBe(true);
    expect(again.ok ? again.data.id : null).toBe(created.ok ? created.data.id : null);
    const rows = (await listLeadSourceBindings()).filter((b) => b.externalAccountId === G_KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBeNull();

    expect(await prisma.integrationAuditLog.count({ where: { orgId: SEED_IDS.org, integration: "google_ads_leads", action: "create" } })).toBe(1);
  });

  it("meta: token cifrado + hint + auditoria; edição sem token mantém; troca gira (rotate)", async () => {
    await signInAsSeedAdmin();
    const created = await saveLeadSourceBinding({
      provider: "meta",
      externalAccountId: PAGE_A,
      label: `${TAG} página`,
      campaignId: campSeed,
      pageToken: TOKEN_1,
    });
    expect(created.ok).toBe(true);
    expect(JSON.stringify(created)).not.toContain(TOKEN_1); // nunca ecoa o valor

    const saved = await prisma.integrationSecret.findUnique({
      where: { orgId_integration_name: { orgId: SEED_IDS.org, integration: "meta_leads", name: tokenName } },
    });
    expect(saved).not.toBeNull();
    expect(saved!.encryptedValue).toMatch(/^v1:/);
    expect(saved!.encryptedValue).not.toContain(TOKEN_1);
    expect(saved!.hint).toBe(TOKEN_1.slice(-4));
    expect(await readIntegrationSecretValue(SEED_IDS.org, "meta_leads", tokenName)).toBe(TOKEN_1);
    expect((await listLeadSourceBindings()).find((b) => b.externalAccountId === PAGE_A)?.tokenHint).toBe(TOKEN_1.slice(-4));
    expect(await prisma.integrationAuditLog.count({ where: { orgId: SEED_IDS.org, integration: "meta_leads", action: "create" } })).toBeGreaterThan(0);

    // edição sem token (vazio) mantém o atual
    const keep = await saveLeadSourceBinding({ provider: "meta", externalAccountId: PAGE_A, campaignId: campSeed, pageToken: "" });
    expect(keep.ok).toBe(true);
    expect(await readIntegrationSecretValue(SEED_IDS.org, "meta_leads", tokenName)).toBe(TOKEN_1);

    // troca gira o token e audita "rotate"
    const rotated = await saveLeadSourceBinding({ provider: "meta", externalAccountId: PAGE_A, campaignId: campSeed, pageToken: TOKEN_2 });
    expect(rotated.ok).toBe(true);
    expect(await readIntegrationSecretValue(SEED_IDS.org, "meta_leads", tokenName)).toBe(TOKEN_2);
    expect(await prisma.integrationAuditLog.count({ where: { orgId: SEED_IDS.org, integration: "meta_leads", action: "rotate" } })).toBe(1);
    expect(JSON.stringify(rotated)).not.toContain(TOKEN_2);
  });
});

describe("campanhas do seletor", () => {
  it("arquivadas aparecem sinalizadas e cada org só enxerga as próprias", async () => {
    await signInAsSeedAdmin();
    const opts = await listLeadSourceCampaigns();
    expect(opts.find((o) => o.id === campArchived)?.name).toMatch(/\(arquivada\)/);
    expect(opts.some((o) => o.id === campB)).toBe(false);

    await signInAs(orgB.userId);
    const optsB = await listLeadSourceCampaigns();
    expect(optsB.some((o) => o.id === campSeed)).toBe(false);
    expect(optsB.some((o) => o.id === campB)).toBe(true);
  });
});

describe("isolamento cross-org (D-041-3)", () => {
  it("org B não vê nem remove o vínculo da org A; re-vincular o mesmo identificador é recusado", async () => {
    await signInAs(orgB.userId);
    expect(await listLeadSourceBindings()).toEqual([]);

    const bindingA = await prisma.leadSourceBinding.findFirstOrThrow({ where: { externalAccountId: G_KEY } });
    const removed = await removeLeadSourceBinding({ id: bindingA.id, confirm: true });
    expect(removed.ok === false && removed.errors?._form?.[0]).toBe("Vínculo não encontrado.");
    expect(await prisma.leadSourceBinding.findUnique({ where: { id: bindingA.id } })).not.toBeNull();

    const clash = await saveLeadSourceBinding({ provider: "google_ads", externalAccountId: G_KEY, campaignId: campB });
    expect(clash.ok === false && clash.errors?._form?.[0]).toMatch(/outra organização/);

    await signInAsSeedAdmin();
    expect((await listLeadSourceBindings()).some((b) => b.externalAccountId === G_KEY)).toBe(true);
  });

  it("org B cria o próprio vínculo e o token fica escopado na org dela", async () => {
    await signInAs(orgB.userId);
    const r = await saveLeadSourceBinding({ provider: "meta", externalAccountId: PAGE_B, campaignId: campB, pageToken: TOKEN_1 });
    expect(r.ok).toBe(true);
    expect(await readIntegrationSecretValue(orgB.orgId, "meta_leads", metaPageTokenName(PAGE_B))).toBe(TOKEN_1);
    expect(await readIntegrationSecretValue(SEED_IDS.org, "meta_leads", metaPageTokenName(PAGE_B))).toBeNull();
    expect((await listLeadSourceBindings()).map((b) => b.externalAccountId)).toEqual([PAGE_B]);
  });
});

describe("remover", () => {
  it("exige confirm, apaga vínculo + Page Access Token e audita; id inexistente -> não encontrada", async () => {
    await signInAsSeedAdmin();
    const binding = await prisma.leadSourceBinding.findFirstOrThrow({ where: { externalAccountId: PAGE_A } });

    const noConfirm = await removeLeadSourceBinding({ id: binding.id, confirm: false });
    expect(noConfirm.ok).toBe(false);
    if (!noConfirm.ok) expect(noConfirm.errors.confirm?.[0]).toBe("Confirme a remoção.");
    expect(await prisma.leadSourceBinding.findUnique({ where: { id: binding.id } })).not.toBeNull();

    const removed = await removeLeadSourceBinding({ id: binding.id, confirm: true });
    expect(removed.ok).toBe(true);
    expect(await prisma.leadSourceBinding.findUnique({ where: { id: binding.id } })).toBeNull();
    expect(await prisma.integrationSecret.findUnique({ where: { orgId_integration_name: { orgId: SEED_IDS.org, integration: "meta_leads", name: tokenName } } })).toBeNull();
    expect(await prisma.integrationAuditLog.count({ where: { orgId: SEED_IDS.org, integration: "meta_leads", action: "delete" } })).toBe(1);

    const missing = await removeLeadSourceBinding({ id: "00000000-0000-4000-8000-000000000000", confirm: true });
    expect(missing.ok === false && missing.errors?._form?.[0]).toBe("Vínculo não encontrado.");
  });
});

describe("guardas de sessão / permissão", () => {
  it("org suspensa: escrita bloqueada com a mensagem da assinatura", async () => {
    await prisma.organization.update({ where: { id: orgB.orgId }, data: { status: "suspended" } });
    await signInAs(orgB.userId);
    const r = await saveLeadSourceBinding({ provider: "google_ads", externalAccountId: `${TAG}-susp`, campaignId: campB });
    expect(r.ok === false && r.errors?._form?.[0]).toMatch(/Assinatura pendente ou cancelada/);
    await prisma.organization.update({ where: { id: orgB.orgId }, data: { status: "active" } });
    expect(await prisma.leadSourceBinding.count({ where: { externalAccountId: `${TAG}-susp` } })).toBe(0);
  });

  it("platform_admin: sem permissão em action e query", async () => {
    await signInAs(SEED_IDS.user, { orgId: null, platformRole: "platform_admin" });
    const r = await saveLeadSourceBinding({ provider: "google_ads", externalAccountId: `${TAG}-adm`, campaignId: campSeed });
    expect(r.ok === false && r.errors?._form?.[0]).toBe("Sem permissão.");
    await expect(listLeadSourceBindings()).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(listLeadSourceCampaigns()).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("sem sessão: sessão expirada", async () => {
    signOut();
    const r = await removeLeadSourceBinding({ id: "00000000-0000-4000-8000-000000000000", confirm: true });
    expect(r.ok === false && r.errors?._form?.[0]).toMatch(/Sessão expirada/);
    await expect(listLeadSourceBindings()).rejects.toMatchObject({ name: "UnauthorizedError" });
  });
});
