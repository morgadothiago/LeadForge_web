import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { purgeTestCampaigns } from "@/lib/test-utils/purge";
import { signInAsSeedAdmin } from "@/lib/auth/test-helpers";
import { seed } from "../../../prisma/seed";
import {
  addNote, addTag, createLead, deleteLead, deleteNote, moveLeadStage, removeTag, updateLead,
} from "./lead";
import { getLead, listLeads } from "@/lib/queries/leads";

const TAG = "zz-test-spec008";
let campId = "";
let campB = "";

beforeAll(async () => {
  await purgeTestCampaigns(TAG);
  await seed(prisma);
  await signInAsSeedAdmin();
  const icp = await prisma.icpProfile.findFirstOrThrow();
  const user = await prisma.user.findFirstOrThrow();
  campId = (await prisma.campaign.create({ data: { name: TAG, userId: user.id, icpId: icp.id, orgId: icp.orgId } })).id;
  campB = (await prisma.campaign.create({ data: { name: TAG + "-b", userId: user.id, icpId: icp.id, orgId: icp.orgId } })).id;
}, 30000);

afterAll(async () => {
  await purgeTestCampaigns(TAG).catch(() => {});
  await prisma.lead.deleteMany({ where: { campaignId: { in: [campId, campB] } } });
  await prisma.campaign.deleteMany({ where: { id: { in: [campId, campB] } } });
  await prisma.$disconnect();
});

describe("leads: actions", () => {
  let leadId = "";

  it("createLead normaliza, cria opportunity novo_lead e histórico", async () => {
    const r = await createLead({ campaignId: campId, name: " Ana Zz ", email: " ANA@Zz.COM ", phone: "(11) 91234-5678", company: "Acme" });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    leadId = r.data.id;
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, include: { opportunities: { include: { stageHistory: true } } } });
    expect(l.name).toBe("Ana Zz");
    expect(l.email).toBe("ana@zz.com");
    expect(l.phone).toBe("+5511912345678");
    expect(l.opportunities[0].stage).toBe("novo_lead");
    expect(l.opportunities[0].stageHistory).toHaveLength(1);
  });

  it("createLead: telefone inválido e duplicados viram erro de campo", async () => {
    const bad = await createLead({ campaignId: campId, name: "X", phone: "123" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.phone[0]).toMatch(/Telefone inválido/);
    const badMail = await createLead({ campaignId: campId, name: "X", email: "nao-e-email" });
    if (!badMail.ok) expect(badMail.errors.email).toBeDefined();
    else throw new Error("deveria falhar");
    const dupE = await createLead({ campaignId: campId, name: "Y", email: "ana@zz.com" });
    expect(dupE.ok).toBe(false);
    if (!dupE.ok) expect(dupE.errors.email[0]).toMatch(/já existe/i);
    const dupP = await createLead({ campaignId: campId, name: "Y", phone: "+55 11 91234-5678" });
    if (!dupP.ok) expect(dupP.errors.phone[0]).toMatch(/já existe/i);
    else throw new Error("deveria falhar");
    // outra campanha pode repetir
    const other = await createLead({ campaignId: campB, name: "Ana B", email: "ana@zz.com" });
    expect(other.ok).toBe(true);
  });

  it("updateLead: parcial, limpa campo, bloqueia duplicata", async () => {
    const o = await createLead({ campaignId: campId, name: "Bob Zz", email: "bob@zz.com" });
    if (!o.ok) throw new Error("x");
    const dup = await updateLead({ leadId: o.data.id, email: "ANA@zz.com" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors.email).toBeDefined();
    const ok = await updateLead({ leadId, company: "", phone: "11 98888-7777" });
    expect(ok.ok).toBe(true);
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(l.company).toBeNull();
    expect(l.phone).toBe("+5511988887777");
    expect(l.name).toBe("Ana Zz");
    // self-update com mesmo email não é duplicata
    expect((await updateLead({ leadId, email: "ana@zz.com" })).ok).toBe(true);
  });

  it("tags: normaliza, idempotente, limite, remove", async () => {
    const a = await addTag({ leadId, tag: "  Quente  Demais " });
    expect(a.ok && a.data.tags).toEqual(["quente demais"]);
    const b = await addTag({ leadId, tag: "QUENTE DEMAIS" });
    expect(b.ok && b.data.tags).toEqual(["quente demais"]);
    expect((await addTag({ leadId, tag: "  " })).ok).toBe(false);
    for (let i = 0; i < 19; i++) await addTag({ leadId, tag: `t${i}` });
    const over = await addTag({ leadId, tag: "extra" });
    expect(over.ok).toBe(false);
    const rm = await removeTag({ leadId, tag: "Quente Demais" });
    expect(rm.ok && rm.data.tags).not.toContain("quente demais");
  });

  it("notas: add/delete", async () => {
    const n = await addNote({ leadId, body: " olá " });
    if (!n.ok) throw new Error("x");
    expect((await prisma.leadNote.findUniqueOrThrow({ where: { id: n.data.id } })).body).toBe("olá");
    expect((await addNote({ leadId, body: " " })).ok).toBe(false);
    expect((await deleteNote({ noteId: n.data.id })).ok).toBe(true);
    expect((await deleteNote({ noteId: n.data.id })).ok).toBe(false);
  });

  it("moveLeadStage reusa núcleo: histórico, lostReason, encerra sequência", async () => {
    await prisma.lead.update({ where: { id: leadId }, data: { sequenceStatus: "active", nextTouchAt: new Date() } });
    const t = await prisma.touch.create({ data: { leadId, channel: "email", status: "scheduled" } });
    const m = await moveLeadStage({ leadId, toStage: "contactado" });
    expect(m.ok && m.data.stage).toBe("contactado");
    const p = await moveLeadStage({ leadId, toStage: "perdido", lostReason: " sem budget " });
    expect(p.ok).toBe(true);
    const d = await getLead(leadId);
    expect(d?.opportunity?.stage).toBe("perdido");
    expect(d?.opportunity?.lostReason).toBe("sem budget");
    expect(d?.sequenceStatus).toBe("completed");
    expect(d?.nextTouchAt).toBeNull();
    expect((await prisma.touch.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("skipped");
    const hist = await prisma.stageHistory.count({ where: { opportunityId: d!.opportunity!.id } });
    expect(hist).toBe(3);
    const same = await moveLeadStage({ leadId, toStage: "perdido", lostReason: "sem budget" });
    expect(same.ok && same.data.changed).toBe(false);
    expect((await moveLeadStage({ leadId: crypto.randomUUID(), toStage: "fechado" })).ok).toBe(false);
  });

  it("deleteLead remove em cascata", async () => {
    const o = await createLead({ campaignId: campB, name: "Del Zz", email: "del@zz.com" });
    if (!o.ok) throw new Error("x");
    expect((await deleteLead(o.data.id)).ok).toBe(true);
    expect(await prisma.opportunity.count({ where: { id: o.data.opportunityId } })).toBe(0);
    expect((await deleteLead(o.data.id)).ok).toBe(false);
  });
});

describe("leads: contato mínimo e bloqueio de exclusão", () => {
  const mk = async (n: string) => {
    const r = await createLead({ campaignId: campB, name: n, email: `${n}@blk.com` });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    return r.data;
  };

  it("createLead sem e-mail nem telefone é recusado", async () => {
    const r = await createLead({ campaignId: campB, name: "Sem Contato", email: "", phone: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.email[0]).toMatch(/e-mail ou telefone/);
  });

  it("updateLead que removeria o último contato é recusado; com outro contato passa", async () => {
    const l = await mk("upd1");
    const bad = await updateLead({ leadId: l.id, email: null });
    expect(bad.ok).toBe(false);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).email).toBe("upd1@blk.com");
    expect((await updateLead({ leadId: l.id, email: null, phone: "11 97777-6666" })).ok).toBe(true);
  });

  for (const status of ["sent", "delivered", "read", "failed", "replied"] as const) {
    it(`deleteLead bloqueia com touch ${status}`, async () => {
      if (status === "read") return; // enum TouchStatus não possui "read"
      const l = await mk(`tch-${status}`);
      await prisma.touch.create({ data: { leadId: l.id, channel: "email", status } });
      const r = await deleteLead(l.id);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors._form[0]).toMatch(/Perdido/);
      expect(await prisma.lead.count({ where: { id: l.id } })).toBe(1);
    });
  }

  it("deleteLead bloqueia com touch inbound", async () => {
    const l = await mk("inb");
    await prisma.touch.create({ data: { leadId: l.id, channel: "email", direction: "inbound", status: "pending" } });
    expect((await deleteLead(l.id)).ok).toBe(false);
    expect(await prisma.lead.count({ where: { id: l.id } })).toBe(1);
  });

  it("deleteLead bloqueia com meeting", async () => {
    const l = await mk("meet");
    await prisma.meeting.create({ data: { leadId: l.id, opportunityId: l.opportunityId, campaignId: campB, startsAt: new Date(), endsAt: new Date() } });
    expect((await deleteLead(l.id)).ok).toBe(false);
    expect(await prisma.lead.count({ where: { id: l.id } })).toBe(1);
  });

  it("deleteLead permite com touches pending/scheduled/skipped", async () => {
    const l = await mk("ok");
    for (const status of ["pending", "scheduled", "skipped"] as const)
      await prisma.touch.create({ data: { leadId: l.id, channel: status === "pending" ? "email" : status === "scheduled" ? "whatsapp" : "linkedin", status } });
    expect((await deleteLead(l.id)).ok).toBe(true);
    expect(await prisma.touch.count({ where: { leadId: l.id } })).toBe(0);
  });
});

describe("leads: queries", () => {
  it("listLeads: filtros combinados, busca, ordenação, paginação, total", async () => {
    const mk = async (name: string, score: number, email: string, stage: "novo_lead" | "fechado", ch?: "email" | "whatsapp") => {
      const l = await prisma.lead.create({ data: { campaignId: campB, name, score, email, company: "Corp Qq" } });
      await prisma.opportunity.create({ data: { leadId: l.id, campaignId: campB, stage } });
      if (ch) {
        await prisma.touch.create({ data: { leadId: l.id, channel: "email", createdAt: new Date(2020, 1, 1) } });
        if (ch === "whatsapp") await prisma.touch.create({ data: { leadId: l.id, channel: "whatsapp", createdAt: new Date(2021, 1, 1) } });
      }
      return l.id;
    };
    await mk("Carla Qq", 90, "carla@q.com", "novo_lead", "whatsapp");
    await mk("beto Qq", 50, "beto@q.com", "fechado", "email");
    await mk("Dani Qq", 70, "dani@q.com", "novo_lead");
    const base = { campaignId: campB, q: "qq" };
    const all = await listLeads({ ...base, sort: "score", dir: "desc" });
    expect(all.items.map((i) => i.name)).toEqual(["Carla Qq", "Dani Qq", "beto Qq"]);
    expect(all.total).toBe(3);
    expect((await listLeads({ campaignId: campB, q: "CORP" })).total).toBe(3);
    expect((await listLeads({ ...base, q: "BETO@Q" })).total).toBe(1);
    expect((await listLeads({ ...base, stage: "novo_lead" })).total).toBe(2);
    expect((await listLeads({ ...base, channel: "whatsapp" })).items.map((i) => i.name)).toEqual(["Carla Qq"]);
    expect((await listLeads({ ...base, channel: "email" })).items.map((i) => i.name)).toEqual(["beto Qq"]);
    const combo = await listLeads({ ...base, stage: "novo_lead", scoreMin: 60, scoreMax: 80 });
    expect(combo.items.map((i) => i.name)).toEqual(["Dani Qq"]);
    expect(combo.items[0].opportunity?.stage).toBe("novo_lead");
    const byName = await listLeads({ ...base, sort: "name", dir: "asc" });
    expect(byName.items[0].name).toBe("beto Qq");
    const p1 = await listLeads({ ...base, sort: "score", dir: "desc", pageSize: 2, page: 1 });
    const p2 = await listLeads({ ...base, sort: "score", dir: "desc", pageSize: 2, page: 2 });
    expect([...p1.items, ...p2.items].map((i) => i.name)).toEqual(["Carla Qq", "Dani Qq", "beto Qq"]);
    expect(p1.pageCount).toBe(2);
    expect(p1.items[0].lastChannel).toBe("whatsapp");
    expect((await listLeads({ campaignId: "lixo", page: "x" as unknown as number })).page).toBe(1);
  });

  it("getLead: ficha completa e timeline desc", async () => {
    const l = await prisma.lead.create({ data: { campaignId: campB, name: "Ficha Zz", repliedAt: new Date(), tags: ["a"] } });
    const o = await prisma.opportunity.create({ data: { leadId: l.id, campaignId: campB, value: 500 } });
    await prisma.touch.create({ data: { leadId: l.id, channel: "email", createdAt: new Date(2024, 0, 1), content: "old" } });
    await prisma.touch.create({ data: { leadId: l.id, channel: "whatsapp", direction: "inbound", status: "replied", createdAt: new Date(2024, 0, 2), content: "new" } });
    await prisma.meeting.create({ data: { opportunityId: o.id, leadId: l.id, campaignId: campB, startsAt: new Date(), endsAt: new Date() } });
    await prisma.leadNote.create({ data: { leadId: l.id, body: "n" } });
    const d = await getLead(l.id);
    expect(d?.touches.map((t) => t.content)).toEqual(["new", "old"]);
    expect(d?.touches[0].direction).toBe("inbound");
    expect(d?.opportunity?.value).toBe(500);
    expect(d?.meetings).toHaveLength(1);
    expect(d?.notes).toHaveLength(1);
    expect(d?.tags).toEqual(["a"]);
    expect(d?.repliedAt).not.toBeNull();
    expect(d?.campaign.id).toBe(campB);
    expect(await getLead(crypto.randomUUID())).toBeNull();
  });
});
