import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { seed, SEED_IDS } from "../../../prisma/seed";
import { archiveCampaign, createCampaign, deleteCampaign, duplicateCampaign, pauseCampaign, resumeCampaign, updateCampaign } from "./campaign";
import { createIcp, deleteIcp, updateIcp } from "./icp";
import { handleActionError } from "./result";
import { UnauthorizedError } from "@/lib/auth/require-user";
import { Prisma } from "@prisma/client";
import { getCampaign, listCampaigns, listIcps } from "@/lib/queries/campaigns";

const TAG = "zz-test-spec005";
const icpInline = { name: `${TAG} icp`, niche: "Teste", signals: ["a", "a", "b"] };
const campIds: string[] = [];
const icpIds: string[] = [];

beforeAll(async () => {
  await seed(prisma);
});

afterAll(async () => {
  await prisma.lead.deleteMany({ where: { campaign: { name: { startsWith: TAG } } } });
  await prisma.campaign.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.icpProfile.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("validação", () => {
  it("erros por campo em PT-BR", async () => {
    const r = await createCampaign({ name: "  ", icp: { name: "", niche: "x" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.name?.[0]).toBe("Nome da campanha é obrigatório.");
    expect(r.errors["icp.name"]?.[0]).toBe("Nome do ICP é obrigatório.");
  });
  it("exige ICP existente ou inline", async () => {
    const r = await createCampaign({ name: `${TAG} x` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.icpId?.[0]).toMatch(/ICP/);
  });
  it("uuid inexistente de sequência vira erro de campo", async () => {
    const r = await createCampaign({
      name: `${TAG} y`,
      icpId: SEED_IDS.icp,
      sequenceId: "00000000-0000-4000-8000-0000000000ff",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.sequenceId?.[0]).toBe("Sequência não encontrada.");
  });
});

describe("campanha", () => {
  it("cria com ICP inline, sequence/instance nulos, e revalida", async () => {
    const r = await createCampaign({ name: `${TAG} a`, icp: icpInline });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    campIds.push(r.data.id);
    expect(revalidatePath).toHaveBeenCalledWith("/campanhas");
    const c = await getCampaign(r.data.id);
    expect(c?.sequence).toBeNull();
    expect(c?.whatsappInstance).toBeNull();
    expect(c?.status).toBe("active");
    expect(c?.icp.signals).toEqual(["a", "b"]);
    icpIds.push(c!.icp.id);
  });

  it("ICP reutilizável entre campanhas + edição + listagem com contagem", async () => {
    const r = await createCampaign({ name: `${TAG} b`, icpId: icpIds[0] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    campIds.push(r.data.id);
    expect((await getCampaign(r.data.id))?.icp.campaignCount).toBe(2);
    const u = await updateCampaign({ id: r.data.id, name: `${TAG} b2`, status: "paused", icpId: icpIds[0] });
    expect(u.ok).toBe(true);
    const list = await listCampaigns();
    const item = list.find((c) => c.id === r.data.id);
    expect(item).toMatchObject({ name: `${TAG} b2`, status: "paused", leadCount: 0 });
  });

  it("pausar, retomar, arquivar (oculta da lista padrão)", async () => {
    const id = campIds[0];
    expect((await pauseCampaign(id)).ok).toBe(true);
    expect((await resumeCampaign(id)).ok).toBe(true);
    expect((await archiveCampaign(id)).ok).toBe(true);
    expect((await listCampaigns()).some((c) => c.id === id)).toBe(false);
    expect((await listCampaigns({ includeArchived: true })).some((c) => c.id === id)).toBe(true);
  });

  it("duplica nascendo pausada, sem leads", async () => {
    const r = await duplicateCampaign(campIds[0]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    campIds.push(r.data.id);
    const c = await getCampaign(r.data.id);
    expect(c).toMatchObject({ status: "paused", leadCount: 0 });
    expect(c?.name).toContain("(cópia)");
  });

  it("bloqueia exclusão de campanha com leads; exclui sem leads", async () => {
    const withLead = campIds[1];
    await prisma.lead.create({ data: { campaignId: withLead, name: "L", email: `${TAG}@x.com` } });
    const blocked = await deleteCampaign(withLead);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.errors._form?.[0]).toMatch(/possui 1 lead/);
    const ok = await deleteCampaign(campIds[2]);
    expect(ok.ok).toBe(true);
    expect(await prisma.campaign.count({ where: { id: campIds[2] } })).toBe(0);
  });
});

describe("ICP", () => {
  it("CRUD e bloqueio de exclusão em uso", async () => {
    const c = await createIcp({ name: `${TAG} solo`, niche: "N" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const up = await updateIcp({ id: c.data.id, name: `${TAG} solo2`, niche: "N2", keywords: ["k"] });
    expect(up.ok).toBe(true);
    expect((await listIcps()).find((i) => i.id === c.data.id)).toMatchObject({ niche: "N2", keywords: ["k"] });
    expect((await deleteIcp(c.data.id)).ok).toBe(true);

    const inUse = await deleteIcp(icpIds[0]);
    expect(inUse.ok).toBe(false);
    if (!inUse.ok) expect(inUse.errors._form?.[0]).toMatch(/em uso por 2 campanhas/);
  });
});

describe("tratamento de erros", () => {
  it("UnauthorizedError e P2025 viram ActionResult sem vazar mensagem interna", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const u = handleActionError(new UnauthorizedError());
    expect(u).toEqual({ ok: false, errors: { _form: [expect.stringMatching(/Sessão expirada/)] } });
    const p = handleActionError(new Prisma.PrismaClientKnownRequestError("secret table x", { code: "P2025", clientVersion: "t" }));
    expect(p.ok === false && p.errors._form?.[0]).toBe("Registro não encontrado.");
    const g = handleActionError(new Error("segredo interno SELECT *"));
    expect(JSON.stringify(g)).not.toMatch(/segredo|SELECT/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("delete concorrente: apenas um sucesso, sem exceção", async () => {
    const c = await createCampaign({ name: `${TAG} race`, icpId: SEED_IDS.icp });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const rs = await Promise.all([deleteCampaign(c.data.id), deleteCampaign(c.data.id)]);
    expect(rs.filter((r) => r.ok).length).toBeGreaterThanOrEqual(1);
    rs.filter((r) => !r.ok).forEach((r) => !r.ok && expect(r.errors._form?.[0]).toBeTruthy());
    expect(await prisma.campaign.count({ where: { id: c.data.id } })).toBe(0);
  });

  it("id inexistente em delete retorna erro de formulário", async () => {
    const r = await deleteIcp("00000000-0000-4000-8000-0000000000fe");
    expect(r.ok).toBe(false);
  });
});
