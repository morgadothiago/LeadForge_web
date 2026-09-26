import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { purgeTestCampaigns } from "@/lib/test-utils/purge";
import { signInAsSeedAdmin } from "@/lib/auth/test-helpers";
import { seed } from "../../../prisma/seed";
import { moveOpportunity, updateOpportunity } from "./pipeline";
import { getPipelineBoard } from "@/lib/queries/pipeline";

const TAG = "zz-test-spec007";
let campId = "";
const ids: string[] = [];

async function col(stage: "novo_lead" | "contactado" | "fechado") {
  return prisma.opportunity.findMany({ where: { campaignId: campId, stage }, orderBy: { position: "asc" } });
}

beforeAll(async () => {
  await purgeTestCampaigns(TAG);
  await seed(prisma);
  await signInAsSeedAdmin();
  const icp = await prisma.icpProfile.findFirstOrThrow();
  const user = await prisma.user.findFirstOrThrow();
  const c = await prisma.campaign.create({ data: { name: TAG, userId: user.id, icpId: icp.id, orgId: icp.orgId } });
  campId = c.id;
  for (let i = 0; i < 4; i++) {
    const lead = await prisma.lead.create({
      data: { campaignId: campId, name: `${TAG} lead${i}`, company: i === 0 ? "Acme Zz" : null, score: 10 * i },
    });
    const o = await prisma.opportunity.create({
      data: { leadId: lead.id, campaignId: campId, stage: "novo_lead", position: i, value: 100 * (i + 1) },
    });
    ids.push(o.id);
  }
}, 30000);

afterAll(async () => {
  await purgeTestCampaigns(TAG).catch(() => {});
  await prisma.lead.deleteMany({ where: { campaignId: campId } });
  await prisma.campaign.deleteMany({ where: { id: campId } });
  await prisma.$disconnect();
});

describe("pipeline", () => {
  it("board: colunas na ordem, contagem, soma, filtro e busca", async () => {
    const b = await getPipelineBoard({ campaignId: campId });
    expect(b.map((c) => c.stage)).toEqual([
      "novo_lead", "contactado", "em_followup", "interessado", "reuniao_agendada", "fechado", "perdido",
    ]);
    expect(b[0].count).toBe(4);
    expect(b[0].totalValue).toBe(1000);
    expect(b[0].cards.map((c) => c.id)).toEqual(ids);
    expect(b[0].cards[0].campaign.id).toBe(campId);
    const s = await getPipelineBoard({ campaignId: campId, q: "acme zz" });
    expect(s[0].count).toBe(1);
    const all = await getPipelineBoard();
    expect(all.reduce((a, c) => a + c.count, 0)).toBe(await prisma.opportunity.count());
  });

  it("move entre colunas reindexa sem lacunas e grava histórico", async () => {
    const r = await moveOpportunity({ opportunityId: ids[1], toStage: "contactado", toIndex: 0, campaignId: campId });
    expect(r.ok).toBe(true);
    const src = await col("novo_lead");
    expect(src.map((o) => o.id)).toEqual([ids[0], ids[2], ids[3]]);
    expect(src.map((o) => o.position)).toEqual([0, 1, 2]);
    const dst = await col("contactado");
    expect(dst.map((o) => o.position)).toEqual([0]);
    const h = await prisma.stageHistory.findMany({ where: { opportunityId: ids[1] } });
    expect(h).toHaveLength(1);
    expect(h[0].toStage).toBe("contactado");
    expect(revalidatePath).toHaveBeenCalledWith("/pipeline");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("reordena na mesma coluna e limita toIndex", async () => {
    await moveOpportunity({ opportunityId: ids[0], toStage: "novo_lead", toIndex: 99, campaignId: campId });
    const src = await col("novo_lead");
    expect(src.map((o) => o.id)).toEqual([ids[2], ids[3], ids[0]]);
    expect(src.map((o) => o.position)).toEqual([0, 1, 2]);
    expect(await prisma.stageHistory.count({ where: { opportunityId: ids[0] } })).toBe(0);
  });

  it("no-op: mesma coluna e índice não escreve nem revalida", async () => {
    vi.mocked(revalidatePath).mockClear();
    const r = await moveOpportunity({ opportunityId: ids[3], toStage: "novo_lead", toIndex: 1, campaignId: campId });
    expect(r.ok && r.data.changed).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("stage livre (novo_lead -> fechado)", async () => {
    const r = await moveOpportunity({ opportunityId: ids[2], toStage: "fechado", toIndex: 0 });
    expect(r.ok).toBe(true);
    expect((await col("fechado")).map((o) => o.id)).toEqual([ids[2]]);
  });

  it("corrida: oportunidade inexistente e input inválido", async () => {
    const gone = await moveOpportunity({
      opportunityId: "00000000-0000-4000-8000-000000000000", toStage: "fechado", toIndex: 0,
    });
    expect(gone).toMatchObject({ ok: false });
    const bad = await moveOpportunity({ opportunityId: "x", toStage: "zzz", toIndex: -1 });
    expect(bad.ok).toBe(false);
  });

  it("movimentos concorrentes mantêm posições íntegras", async () => {
    const rs = await Promise.all(
      ids.map((id, i) => moveOpportunity({ opportunityId: id, toStage: "contactado", toIndex: i, campaignId: campId })),
    );
    // Com retry+jitter no núcleo, conflitos Serializable sob carga não podem sobrar como falha.
    expect(rs.every((r) => r.ok)).toBe(true);
    const c = await col("contactado");
    const others = await Promise.all([col("novo_lead"), col("fechado")]);
    expect(c.length + others[0].length + others[1].length).toBe(4);
    for (const list of [c, ...others]) {
      const pos = list.map((o) => o.position);
      expect(pos).toEqual(pos.map((_, i) => i));
    }
  }, 30000);

  it("updateOpportunity atualiza valor/notas e valida", async () => {
    const r = await updateOpportunity({ opportunityId: ids[0], value: 555, notes: "  nota  " });
    expect(r.ok).toBe(true);
    const o = await prisma.opportunity.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(o.value).toBe(555);
    expect(o.notes).toBe("nota");
    expect((await updateOpportunity({ opportunityId: ids[0], value: -1 })).ok).toBe(false);
    expect((await updateOpportunity({ opportunityId: "00000000-0000-4000-8000-000000000000", value: 1 })).ok).toBe(false);
  });
});

describe("pipeline - lostReason e encerramento de sequência", () => {
  const T2 = "zz-test-spec007b";
  let camp = "";
  let leadId = "";
  let oppId = "";

  async function reset() {
    await prisma.touch.deleteMany({ where: { leadId } });
    await prisma.lead.update({
      where: { id: leadId },
      data: { sequenceStatus: "active", nextTouchAt: new Date(Date.now() + 86400000) },
    });
    await prisma.opportunity.update({ where: { id: oppId }, data: { stage: "novo_lead", lostReason: null } });
    await prisma.touch.create({
      data: { leadId, channel: "email", status: "pending", scheduledAt: new Date(Date.now() + 86400000) },
    });
    await prisma.touch.create({ data: { leadId, channel: "email", status: "sent", sentAt: new Date() } });
  }
  const opp = () => prisma.opportunity.findUniqueOrThrow({ where: { id: oppId } });
  const lead = () => prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  beforeAll(async () => {
    const icp = await prisma.icpProfile.findFirstOrThrow();
    const user = await prisma.user.findFirstOrThrow();
    const c = await prisma.campaign.create({ data: { name: T2, userId: user.id, icpId: icp.id, orgId: icp.orgId } });
    camp = c.id;
    const l = await prisma.lead.create({ data: { campaignId: camp, name: `${T2} lead` } });
    leadId = l.id;
    oppId = (await prisma.opportunity.create({ data: { leadId, campaignId: camp } })).id;
  });
  afterAll(async () => {
    await prisma.lead.deleteMany({ where: { campaignId: camp } });
    await prisma.campaign.deleteMany({ where: { id: camp } });
  });

  it("perdido grava lostReason com trim; vazio vira null; máx 500", async () => {
    await reset();
    const r = await moveOpportunity({ opportunityId: oppId, toStage: "perdido", toIndex: 0, lostReason: "  Sem orçamento  " });
    expect(r.ok).toBe(true);
    expect((await opp()).lostReason).toBe("Sem orçamento");
    await moveOpportunity({ opportunityId: oppId, toStage: "perdido", toIndex: 0, lostReason: "   " });
    expect((await opp()).lostReason).toBeNull();
    const big = await moveOpportunity({ opportunityId: oppId, toStage: "perdido", toIndex: 0, lostReason: "x".repeat(501) });
    expect(big.ok).toBe(false);
    const ok = await moveOpportunity({ opportunityId: oppId, toStage: "perdido", toIndex: 0, lostReason: "y".repeat(500) });
    expect(ok.ok).toBe(true);
    expect((await opp()).lostReason).toHaveLength(500);
  });

  it("board expõe lostReason; sair de perdido limpa; outros stages ignoram", async () => {
    await reset();
    await moveOpportunity({ opportunityId: oppId, toStage: "perdido", toIndex: 0, lostReason: "Concorrente" });
    const b = await getPipelineBoard({ campaignId: camp });
    expect(b.find((c) => c.stage === "perdido")!.cards[0].lostReason).toBe("Concorrente");
    await moveOpportunity({ opportunityId: oppId, toStage: "interessado", toIndex: 0, lostReason: "ignorado" });
    expect((await opp()).lostReason).toBeNull();
    await moveOpportunity({ opportunityId: oppId, toStage: "contactado", toIndex: 0, lostReason: "ignorado" });
    expect((await opp()).lostReason).toBeNull();
  });

  it("fechar/perder encerra sequência e cancela touches pendentes; reabrir não reativa; idempotente", async () => {
    for (const stage of ["fechado", "perdido"] as const) {
      await reset();
      const before = await lead();
      await moveOpportunity({ opportunityId: oppId, toStage: stage, toIndex: 0 });
      const l = await lead();
      expect(l.sequenceStatus).toBe("completed");
      expect(l.nextTouchAt).toBeNull();
      expect(l.repliedAt).toEqual(before.repliedAt);
      expect(l.optedOutAt).toEqual(before.optedOutAt);
      const t = await prisma.touch.findMany({ where: { leadId }, orderBy: { createdAt: "asc" } });
      expect(t.map((x) => x.status).sort()).toEqual(["sent", "skipped"]);

      const again = await moveOpportunity({ opportunityId: oppId, toStage: stage, toIndex: 0 });
      expect(again.ok && again.data.changed).toBe(false);

      await moveOpportunity({ opportunityId: oppId, toStage: "interessado", toIndex: 0 });
      const re = await lead();
      expect(re.sequenceStatus).toBe("completed");
      expect(re.nextTouchAt).toBeNull();
    }
  });

  it("mover entre stages abertos não altera sequência", async () => {
    await reset();
    await moveOpportunity({ opportunityId: oppId, toStage: "contactado", toIndex: 0 });
    const l = await lead();
    expect(l.sequenceStatus).toBe("active");
    expect(l.nextTouchAt).not.toBeNull();
    expect(await prisma.touch.count({ where: { leadId, status: "pending" } })).toBe(1);
  });
});
