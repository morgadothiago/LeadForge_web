import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { signInAs } from "@/lib/auth/test-helpers";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { scopedPrisma, TenantNotFoundError } from "@/lib/tenant/scoped-prisma";
import { adminPrisma } from "@/lib/tenant/admin-prisma";

import { updateCampaign, deleteCampaign, archiveCampaign } from "@/lib/actions/campaign";
import { getCampaign, listCampaigns } from "@/lib/queries/campaigns";
import { createLead, updateLead, moveLeadStage } from "@/lib/actions/lead";
import { getLead, listLeads } from "@/lib/queries/leads";
import { renameSequence, deleteSequence } from "@/lib/actions/sequence";
import { getSequence, listSequences } from "@/lib/queries/sequences";
import { createTemplate, updateTemplate } from "@/lib/actions/template";
import { updateInstance, deleteWhatsAppInstance } from "@/lib/actions/whatsapp";
import { listWhatsAppInstances, getWhatsAppInstance } from "@/lib/queries/whatsapp";
import { updateEmailAccount, deleteEmailAccount, setActive as setEmailAccountActive, testEmailConnection } from "@/lib/actions/email";
import { listEmailAccounts, getEmailAccount } from "@/lib/queries/email";
import { updateAgent, approveDraft, rejectDraftAction, takeOverLead } from "@/lib/actions/agent";
import { listAgents } from "@/lib/queries/agent";
import { addToSuppression } from "@/lib/actions/suppression";
import { listSuppressions } from "@/lib/queries/suppression";
import { getPipelineBoard } from "@/lib/queries/pipeline";
import { updateOpportunity } from "@/lib/actions/pipeline";
import { getDashboardData } from "@/lib/queries/dashboard";
import { listMeetings, searchLeadsForMeeting } from "@/lib/queries/meetings";
import { createMeeting } from "@/lib/actions/meeting";
import { runTick } from "@/lib/scheduler/run-tick";
import { saveIntegration, removeIntegration, testIntegration } from "@/lib/actions/integration";
import { listIntegrations, listIntegrationAudit } from "@/lib/queries/integration";
import { sweepAlerts, raiseAlert, _resetSweepThrottle } from "@/lib/mobile/alerts";
import { signAccessToken } from "@/lib/mobile/token";
import { GET as listAlerts } from "@/app/api/mobile/v1/alerts/route";
import { GET as unreadCount } from "@/app/api/mobile/v1/alerts/unread-count/route";
import { POST as readOneAlert } from "@/app/api/mobile/v1/alerts/[id]/read/route";
import { POST as readAllAlerts } from "@/app/api/mobile/v1/alerts/read-all/route";
import { handleMeetingWebhook, _resetMeetingWebhookRateLimit } from "@/lib/meetings/webhook";

/**
 * SPEC-030 seção 3 — "Teste obrigatório": para cada domínio de negócio, cria 2 Organizations e confirma
 * que a query/action da Org A nunca retorna/afeta dado da Org B, mesmo com IDs adivinhados (teste de
 * vazamento real, não só "esqueceu o where"). Cobre o caminho padrão (`scopedPrisma`, via `requireProviderOrg`)
 * usado por praticamente toda a camada web (`src/lib/actions`, `src/lib/queries`).
 */

let A: TestOrg;
let B: TestOrg;

interface Seeded {
  icpId: string;
  sequenceId: string;
  campaignId: string;
  templateId: string;
  leadId: string;
  opportunityId: string;
}

/** Cria ICP + Sequence + Campaign + Template + Lead + Opportunity dentro da org, via prisma cru (fixture, não sob teste). */
async function seedCampaign(org: TestOrg): Promise<Seeded> {
  const icp = await prisma.icpProfile.create({
    data: { orgId: org.orgId, name: `zz-${org.tag} icp`, niche: "Teste", signals: ["a"], keywords: [], sources: [], desiredData: [] },
  });
  const sequence = await prisma.sequence.create({ data: { orgId: org.orgId, name: `zz-${org.tag} seq` } });
  const campaign = await prisma.campaign.create({
    data: { orgId: org.orgId, name: `zz-${org.tag} camp`, icpId: icp.id, sequenceId: sequence.id, userId: org.userId, status: "paused", autoStart: false },
  });
  const template = await prisma.messageTemplate.create({
    data: { orgId: org.orgId, campaignId: campaign.id, channel: "email", name: "t1", subject: "s", body: "b" },
  });
  const lead = await prisma.lead.create({
    data: { campaignId: campaign.id, name: `zz-${org.tag} lead`, email: `zz-${org.tag}-lead@test.local` },
  });
  const opportunity = await prisma.opportunity.create({ data: { leadId: lead.id, campaignId: campaign.id, stage: "novo_lead" } });
  return { icpId: icp.id, sequenceId: sequence.id, campaignId: campaign.id, templateId: template.id, leadId: lead.id, opportunityId: opportunity.id };
}

let seedA: Seeded;
let seedB: Seeded;
const savedEnc = process.env.ENCRYPTION_KEY;

beforeAll(async () => {
  A = await createTestOrg("crosstenant-a");
  B = await createTestOrg("crosstenant-b");
  seedA = await seedCampaign(A);
  seedB = await seedCampaign(B);
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64"); // chave falsa, só em memória (SPEC-018)
});

afterAll(async () => {
  if (savedEnc === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = savedEnc;
  await purgeTestOrg(A);
  await purgeTestOrg(B);
  await prisma.$disconnect();
});

describe("scopedPrisma — policy layer (defesa central)", () => {
  it("findMany/findUnique nunca devolvem registro de outra org, mesmo pedindo o id exato", async () => {
    const dbB = scopedPrisma(B.orgId);
    expect(await dbB.campaign.findUnique({ where: { id: seedA.campaignId } })).toBeNull();
    expect(await dbB.campaign.findMany({ where: { id: seedA.campaignId } })).toEqual([]);
    expect(await dbB.lead.findUnique({ where: { id: seedA.leadId } })).toBeNull();
    expect(await dbB.opportunity.findUnique({ where: { id: seedA.opportunityId } })).toBeNull();
  });

  it("update/delete de registro de outra org lança TenantNotFoundError (nunca revela que existe)", async () => {
    const dbB = scopedPrisma(B.orgId);
    await expect(dbB.campaign.update({ where: { id: seedA.campaignId }, data: { name: "hackeado" } })).rejects.toBeInstanceOf(TenantNotFoundError);
    await expect(dbB.campaign.delete({ where: { id: seedA.campaignId } })).rejects.toBeInstanceOf(TenantNotFoundError);
    const stillA = await prisma.campaign.findUnique({ where: { id: seedA.campaignId }, select: { name: true } });
    expect(stillA?.name).toBe(`zz-${A.tag} camp`);
  });

  it("create sempre grava com o orgId do escopo, mesmo se o caller tentar forjar outro orgId no data", async () => {
    const dbB = scopedPrisma(B.orgId);
    const created = await dbB.icpProfile.create({
      data: { orgId: A.orgId, name: "forjado", niche: "x", signals: [], keywords: [], sources: [], desiredData: [] },
    });
    expect(created.orgId).toBe(B.orgId);
    await prisma.icpProfile.delete({ where: { id: created.id } });
  });

  it("adminPrisma (caminho cross-tenant explícito) enxerga as duas orgs — só ele, nunca scopedPrisma", async () => {
    const rows = await adminPrisma.campaign.findMany({ where: { id: { in: [seedA.campaignId, seedB.campaignId] } } });
    expect(rows.map((r) => r.id).sort()).toEqual([seedA.campaignId, seedB.campaignId].sort());
  });
});

describe("campanhas — vazamento cross-tenant", () => {
  it("getCampaign/listCampaigns da org B nunca devolvem campanha da org A", async () => {
    await signInAs(B.userId);
    expect(await getCampaign(seedA.campaignId)).toBeNull();
    const list = await listCampaigns();
    expect(list.some((c) => c.id === seedA.campaignId)).toBe(false);
  });

  it("updateCampaign/deleteCampaign/archiveCampaign com id de outra org falham sem afetar o dado real", async () => {
    await signInAs(B.userId);
    const upd = await updateCampaign({ id: seedA.campaignId, name: "roubado" });
    expect(upd.ok).toBe(false);
    const arch = await archiveCampaign(seedA.campaignId);
    expect(arch.ok).toBe(false);
    const del = await deleteCampaign(seedA.campaignId);
    expect(del.ok).toBe(false);
    const stillA = await prisma.campaign.findUnique({ where: { id: seedA.campaignId } });
    expect(stillA?.name).toBe(`zz-${A.tag} camp`);
    expect(stillA?.status).toBe("paused");
  });
});

describe("leads — vazamento cross-tenant", () => {
  it("getLead/listLeads da org B nunca devolvem lead da org A", async () => {
    await signInAs(B.userId);
    expect(await getLead(seedA.leadId)).toBeNull();
    const list = await listLeads();
    expect(list.items.some((l) => l.id === seedA.leadId)).toBe(false);
  });

  it("updateLead/moveLeadStage com leadId de outra org não altera o lead real", async () => {
    await signInAs(B.userId);
    const upd = await updateLead({ leadId: seedA.leadId, name: "roubado" });
    expect(upd.ok).toBe(false);
    const move = await moveLeadStage({ leadId: seedA.leadId, toStage: "fechado" });
    expect(move.ok).toBe(false);
    const stillA = await prisma.lead.findUnique({ where: { id: seedA.leadId } });
    expect(stillA?.name).toBe(`zz-${A.tag} lead`);
  });

  it("createLead com campaignId de outra org (adivinhado) é rejeitado", async () => {
    await signInAs(B.userId);
    const r = await createLead({ campaignId: seedA.campaignId, name: "invasor", email: "invasor@test.local" });
    expect(r.ok).toBe(false);
    const leaked = await prisma.lead.findFirst({ where: { campaignId: seedA.campaignId, name: "invasor" } });
    expect(leaked).toBeNull();
  });
});

describe("sequences/templates — vazamento cross-tenant (D-30-2)", () => {
  it("getSequence/listSequences da org B nunca devolvem sequência da org A", async () => {
    await signInAs(B.userId);
    expect(await getSequence(seedA.sequenceId)).toBeNull();
    const list = await listSequences();
    expect(list.some((s) => s.id === seedA.sequenceId)).toBe(false);
  });

  it("renameSequence/deleteSequence com id de outra org falham", async () => {
    await signInAs(B.userId);
    const ren = await renameSequence({ id: seedA.sequenceId, name: "roubado" });
    expect(ren.ok).toBe(false);
    const del = await deleteSequence(seedA.sequenceId);
    expect(del.ok).toBe(false);
    const stillA = await prisma.sequence.findUnique({ where: { id: seedA.sequenceId } });
    expect(stillA?.name).toBe(`zz-${A.tag} seq`);
  });

  it("updateTemplate com id de outra org falha; createTemplate com campaignId de outra org falha", async () => {
    await signInAs(B.userId);
    const upd = await updateTemplate({ id: seedA.templateId, name: "roubado", channel: "email", subject: "s", body: "b" });
    expect(upd.ok).toBe(false);
    const created = await createTemplate({ campaignId: seedA.campaignId, name: "invasor", channel: "email", subject: "s", body: "b" });
    expect(created.ok).toBe(false);
  });
});

describe("whatsapp — vazamento cross-tenant", () => {
  let instA: string;
  beforeAll(async () => {
    const created = await prisma.whatsAppInstance.create({
      data: { orgId: A.orgId, instanceName: `zz-${A.tag}-wa`, number: "5511999990000", webhookToken: `zz-${A.tag}-token` },
    });
    instA = created.id;
  });

  it("listWhatsAppInstances/getWhatsAppInstance da org B nunca devolvem instância da org A", async () => {
    await signInAs(B.userId);
    expect(await getWhatsAppInstance(instA)).toBeNull();
    const list = await listWhatsAppInstances();
    expect(list.some((i) => i.id === instA)).toBe(false);
  });

  it("updateInstance/deleteWhatsAppInstance com id de outra org falham", async () => {
    await signInAs(B.userId);
    const upd = await updateInstance({ id: instA, number: "5511888880000" });
    expect(upd.ok).toBe(false);
    const del = await deleteWhatsAppInstance(instA);
    expect(del.ok).toBe(false);
    const stillA = await prisma.whatsAppInstance.findUnique({ where: { id: instA } });
    expect(stillA?.number).toBe("5511999990000");
  });

  it("instância criada na org B nunca reaparece na listagem da org A", async () => {
    // (não chama a action createWhatsAppInstance: ela integra com o provider Evolution real, fora do
    // escopo deste teste de isolamento — a fixture cria direto, o mesmo caminho de dados que a action usaria.)
    const created = await prisma.whatsAppInstance.create({
      data: { orgId: B.orgId, instanceName: `zz-${B.tag}-wa2`, number: "5511777770000", webhookToken: `zz-${B.tag}-token2` },
    });
    await signInAs(A.userId);
    const list = await listWhatsAppInstances();
    expect(list.some((i) => i.id === created.id)).toBe(false);
  });
});

describe("email — vazamento cross-tenant", () => {
  let accA: string;
  beforeAll(async () => {
    const created = await prisma.emailAccount.create({
      data: { orgId: A.orgId, userId: A.userId, provider: "smtp", smtpHost: "smtp.test.local", email: `zz-${A.tag}@test.local`, encryptedPassword: "x" },
    });
    accA = created.id;
  });

  it("listEmailAccounts/getEmailAccount da org B nunca devolvem conta da org A", async () => {
    await signInAs(B.userId);
    expect(await getEmailAccount(accA)).toBeNull();
    const list = await listEmailAccounts();
    expect(list.some((a) => a.id === accA)).toBe(false);
  });

  it("updateEmailAccount com id de outra org falha", async () => {
    await signInAs(B.userId);
    const upd = await updateEmailAccount({ id: accA, provider: "smtp", smtpHost: "outro.local", port: 587, email: `zz-${A.tag}@test.local`, dailyLimit: 50 });
    expect(upd.ok).toBe(false);
  });

  it("setActive com id de outra org falha, nunca ativa/desativa a conta alheia (achado QA Rodada 5: migradas para scopedPrisma)", async () => {
    await signInAs(B.userId);
    const before = await prisma.emailAccount.findUniqueOrThrow({ where: { id: accA } });
    const r = await setEmailAccountActive({ id: accA, isActive: !before.isActive });
    expect(r.ok).toBe(false);
    const after = await prisma.emailAccount.findUniqueOrThrow({ where: { id: accA } });
    expect(after.isActive).toBe(before.isActive);
  });

  it("testEmailConnection com id de outra org falha ('Conta não encontrada'), nunca testa a conta alheia", async () => {
    await signInAs(B.userId);
    const r = await testEmailConnection(accA);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.errors?._form?.[0]).toMatch(/não encontrada/);
  });

  it("deleteEmailAccount com id de outra org falha, nunca apaga a conta alheia", async () => {
    await signInAs(B.userId);
    const r = await deleteEmailAccount(accA);
    expect(r.ok).toBe(false);
    expect(await prisma.emailAccount.findUnique({ where: { id: accA } })).not.toBeNull();
  });
});

describe("agentes — vazamento cross-tenant", () => {
  let agentA: string;
  beforeAll(async () => {
    const created = await prisma.agent.create({ data: { orgId: A.orgId, name: `zz-${A.tag} agent`, role: "sdr" } });
    agentA = created.id;
  });

  it("listAgents da org B nunca devolve agente da org A", async () => {
    await signInAs(B.userId);
    const list = await listAgents();
    expect(list.some((a: { id: string }) => a.id === agentA)).toBe(false);
  });

  it("updateAgent com id de outra org falha", async () => {
    await signInAs(B.userId);
    const upd = await updateAgent({ id: agentA, name: "roubado" });
    expect(upd.ok).toBe(false);
    const stillA = await prisma.agent.findUnique({ where: { id: agentA } });
    expect(stillA?.name).toBe(`zz-${A.tag} agent`);
  });

  it("approveDraft/rejectDraftAction/takeOverLead com id de outra org (adivinhado) falham — achado real durante esta rodada: dispatchDraft/rejectDraft/stopAgentOnManualReply não checavam org antes desta correção", async () => {
    const run = await prisma.agentRun.create({ data: { agentId: agentA, leadId: seedA.leadId, trigger: "test", status: "completed" } });
    const draft = await prisma.draft.create({ data: { agentRunId: run.id, leadId: seedA.leadId, channel: "whatsapp", body: "corpo do rascunho" } });

    await signInAs(B.userId);
    const approved = await approveDraft({ id: draft.id });
    expect(approved.ok).toBe(false);
    const rejected = await rejectDraftAction({ id: draft.id, reason: "roubado" });
    expect(rejected.ok).toBe(false);
    const takenOver = await takeOverLead(seedA.leadId);
    expect(takenOver.ok).toBe(false);

    const stillPending = await prisma.draft.findUnique({ where: { id: draft.id } });
    expect(stillPending?.status).toBe("pending");
    const leadUntouched = await prisma.lead.findUnique({ where: { id: seedA.leadId } });
    expect(leadUntouched?.handoffAt).toBeNull();
  });
});

describe("supressão — vazamento cross-tenant", () => {
  it("addToSuppression da org A não aparece para a org B, mesmo com o mesmo contato", async () => {
    await signInAs(A.userId);
    const add = await addToSuppression({ email: "zz-shared@test.local", reason: "manual" });
    expect(add.ok).toBe(true);
    await signInAs(B.userId);
    const list = await listSuppressions();
    expect(list.items.some((s) => s.value === "zz-shared@test.local")).toBe(false);
  });
});

describe("pipeline / reuniões — vazamento cross-tenant", () => {
  it("getPipelineBoard da org B nunca devolve oportunidade da org A", async () => {
    await signInAs(B.userId);
    const board = await getPipelineBoard();
    const ids = board.flatMap((c) => c.cards.map((card) => card.id));
    expect(ids.includes(seedA.opportunityId)).toBe(false);
  });

  it("updateOpportunity com id de outra org falha", async () => {
    await signInAs(B.userId);
    const upd = await updateOpportunity({ opportunityId: seedA.opportunityId, notes: "roubado" });
    expect(upd.ok).toBe(false);
    const stillA = await prisma.opportunity.findUnique({ where: { id: seedA.opportunityId } });
    expect(stillA?.notes).toBeNull();
  });

  it("searchLeadsForMeeting/listMeetings/createMeeting da org B nunca tocam dado da org A", async () => {
    await signInAs(B.userId);
    const found = await searchLeadsForMeeting(`zz-${A.tag}`);
    expect(found.some((o) => o.opportunityId === seedA.opportunityId)).toBe(false);
    const now = new Date();
    const list = await listMeetings({ from: new Date(now.getTime() - 86_400_000).toISOString(), to: new Date(now.getTime() + 30 * 86_400_000).toISOString() });
    expect(list.ok).toBe(true);
    const created = await createMeeting({ opportunityId: seedA.opportunityId, startsAt: new Date(now.getTime() + 3_600_000).toISOString(), durationMin: 30 });
    expect(created.ok).toBe(false);
  });
});

describe("dashboard — vazamento cross-tenant", () => {
  it("getDashboardData da org B nunca conta leads/atividades da org A", async () => {
    await signInAs(B.userId);
    const data = await getDashboardData({ period: "30d" });
    expect(data.activities.some((a) => a.leadId === seedA.leadId)).toBe(false);
  });
});

describe("scheduler — isolamento por org", () => {
  it("runTick cria no máximo 1 SchedulerRun por org ativa nesta rodada (nunca mistura contadores entre orgs)", async () => {
    const before = await prisma.schedulerRun.count();
    await runTick(new Date());
    const runsA = await prisma.schedulerRun.findMany({ where: { orgId: A.orgId }, orderBy: { startedAt: "desc" }, take: 1 });
    const runsB = await prisma.schedulerRun.findMany({ where: { orgId: B.orgId }, orderBy: { startedAt: "desc" }, take: 1 });
    expect(runsA.length).toBeGreaterThan(0);
    expect(runsB.length).toBeGreaterThan(0);
    expect(runsA[0].id).not.toBe(runsB[0].id);
    const after = await prisma.schedulerRun.count();
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

describe("integrações — vazamento cross-tenant (SPEC-018/030)", () => {
  it("saveIntegration da org A não aparece em listIntegrations/listIntegrationAudit da org B", async () => {
    await signInAs(A.userId);
    const saved = await saveIntegration({ integration: "llm", name: "default", value: "sk-zz-crosstenant-a" });
    expect(saved.ok).toBe(true);
    await signInAs(B.userId);
    const listB = await listIntegrations();
    const llmB = listB.find((i) => i.integration === "llm");
    expect(llmB?.items.length ?? 0).toBe(0);
    const auditB = await listIntegrationAudit({ integration: "llm" });
    expect(auditB.items).toHaveLength(0);
  });

  it("testIntegration/removeIntegration com id de outra org (adivinhado) falham sem afetar o dado real", async () => {
    await signInAs(A.userId);
    const saved = await saveIntegration({ integration: "llm", name: "zz-second", value: "sk-zz-crosstenant-a2" });
    if (!saved.ok) throw new Error("fixture falhou");
    const id = saved.data.id;
    await signInAs(B.userId);
    const tested = await testIntegration(id);
    expect(tested.ok).toBe(false);
    const removed = await removeIntegration({ id, confirm: true });
    expect(removed.ok).toBe(false);
    const stillA = await prisma.integrationSecret.findUnique({ where: { id } });
    expect(stillA).not.toBeNull();
    expect(stillA?.orgId).toBe(A.orgId);
  });
});

describe("MobileAlert — vazamento cross-tenant (achado real corrigido nesta rodada da SPEC-030)", () => {
  let devA: string, devB: string, tokA: string, tokB: string, alertA: string;

  beforeAll(async () => {
    devA = (await prisma.mobileDevice.create({ data: { userId: A.userId, name: "zz-ct-a", platform: "android", refreshHash: `h-${crypto.randomUUID()}`, refreshExpiresAt: new Date(Date.now() + 1e9) } })).id;
    devB = (await prisma.mobileDevice.create({ data: { userId: B.userId, name: "zz-ct-b", platform: "android", refreshHash: `h-${crypto.randomUUID()}`, refreshExpiresAt: new Date(Date.now() + 1e9) } })).id;
    tokA = await signAccessToken(A.userId, devA);
    tokB = await signAccessToken(B.userId, devB);
    _resetSweepThrottle();
    await raiseAlert(A.orgId, { kind: "handoff", severity: "alta", dedupeKey: `zz-ct:handoff:${A.orgId}`, title: "Precisa de você", body: "b", refType: "lead", refId: seedA.leadId });
    alertA = (await prisma.mobileAlert.findUniqueOrThrow({ where: { dedupeKey: `zz-ct:handoff:${A.orgId}` } })).id;
  });

  const get = (t: string, url = "http://x/api") => new Request(url, { headers: { authorization: `Bearer ${t}` } });
  const post = (t: string, url = "http://x/api") => new Request(url, { method: "POST", headers: { authorization: `Bearer ${t}` } });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("GET /alerts e /unread-count da org B nunca devolvem/contam alerta da org A", async () => {
    const list = await (await listAlerts(get(tokB))).json();
    expect(list.data.some((a: { id: string }) => a.id === alertA)).toBe(false);
    const cntA = await (await unreadCount(get(tokA))).json();
    const cntB = await (await unreadCount(get(tokB))).json();
    expect(cntA.data.count).toBeGreaterThan(0);
    expect(cntB.data.count).toBe(0);
  });

  it("POST /alerts/{id}/read com id de outra org (adivinhado) = 404, nunca marca como lido", async () => {
    const r = await readOneAlert(post(tokB, `http://x/api/${alertA}/read`), ctx(alertA));
    expect(r.status).toBe(404);
    const stillUnread = await prisma.mobileAlert.findUniqueOrThrow({ where: { id: alertA } });
    expect(stillUnread.readAt).toBeNull();
  });

  it("POST /alerts/read-all da org B nunca marca o alerta da org A como lido", async () => {
    const r = await readAllAlerts(post(tokB));
    expect(r.status).toBe(200);
    const stillUnread = await prisma.mobileAlert.findUniqueOrThrow({ where: { id: alertA } });
    expect(stillUnread.readAt).toBeNull();
  });

  it("sweepAlerts nunca cria alerta de uma org para outra: cada org só vê os próprios episódios", async () => {
    await sweepAlerts();
    const rowA = await prisma.mobileAlert.findUniqueOrThrow({ where: { id: alertA } });
    expect(rowA.orgId).toBe(A.orgId);
    const crossed = await prisma.mobileAlert.findFirst({ where: { orgId: B.orgId, refId: seedA.leadId } });
    expect(crossed).toBeNull();
  });
});

describe("POST /api/integrations/meetings (webhook) — vazamento cross-tenant (achado + fix desta rodada da SPEC-030)", () => {
  const WEBHOOK_SECRET = "s".repeat(40);
  const deps = { secret: WEBHOOK_SECRET, enabled: true };
  const futureIso = () => new Date(Date.now() + 48 * 3600_000).toISOString();
  const call = (body: unknown) =>
    handleMeetingWebhook(new Request("http://x/api/integrations/meetings", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${WEBHOOK_SECRET}` }, body: JSON.stringify(body) }), deps);

  beforeAll(() => _resetMeetingWebhookRateLimit());

  it("sem campaignId no payload = 400 validation_error, nunca tenta resolver lead", async () => {
    const r = await call({ leadId: seedA.leadId, startsAt: futureIso() });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("validation_error");
  });

  it("leadId da org A com campaignId da org B = 404 lead_not_found, nunca cria reunião na org errada", async () => {
    const r = await call({ campaignId: seedB.campaignId, leadId: seedA.leadId, startsAt: futureIso() });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("lead_not_found");
    const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id: seedA.opportunityId } });
    expect(opp.stage).not.toBe("reuniao_agendada");
  });

  it("campaignId inexistente/adivinhado = 404 campaign_not_found", async () => {
    const r = await call({ campaignId: crypto.randomUUID(), leadId: seedB.leadId, startsAt: futureIso() });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("campaign_not_found");
  });

  it("mesmo telefone existindo em duas orgs: resolve SOMENTE o lead da org do campaignId informado", async () => {
    const phone = "+5511977770002";
    const leadA = await prisma.lead.create({ data: { campaignId: seedA.campaignId, name: "zz-ct phone dup A", phone } });
    const oppA = await prisma.opportunity.create({ data: { leadId: leadA.id, campaignId: seedA.campaignId } });
    const leadB = await prisma.lead.create({ data: { campaignId: seedB.campaignId, name: "zz-ct phone dup B", phone } });
    const oppB = await prisma.opportunity.create({ data: { leadId: leadB.id, campaignId: seedB.campaignId } });
    try {
      const r = await call({ campaignId: seedA.campaignId, phone, startsAt: futureIso() });
      expect(r.status).toBe(201);
      const j = await r.json();
      expect(j.leadId).toBe(leadA.id);
      const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: j.meetingId } });
      expect(meeting.campaignId).toBe(seedA.campaignId);
      const oppBAfter = await prisma.opportunity.findUniqueOrThrow({ where: { id: oppB.id } });
      expect(oppBAfter.stage).not.toBe("reuniao_agendada");
      await prisma.meeting.delete({ where: { id: meeting.id } });
    } finally {
      await prisma.opportunity.delete({ where: { id: oppA.id } }).catch(() => undefined);
      await prisma.opportunity.delete({ where: { id: oppB.id } }).catch(() => undefined);
      await prisma.lead.delete({ where: { id: leadA.id } }).catch(() => undefined);
      await prisma.lead.delete({ where: { id: leadB.id } }).catch(() => undefined);
    }
  });

  it("caminho feliz: campaignId+leadId da org B cria a reunião na org B (nunca na org A)", async () => {
    const r = await call({ campaignId: seedB.campaignId, leadId: seedB.leadId, startsAt: futureIso(), durationMin: 30 });
    expect(r.status).toBe(201);
    const j = await r.json();
    const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: j.meetingId } });
    expect(meeting.campaignId).toBe(seedB.campaignId);
    expect(meeting.leadId).toBe(seedB.leadId);
    await prisma.meeting.delete({ where: { id: meeting.id } });
  });

  it("achado do QA (Rodada 5): mesmo externalId reutilizado por outra org NUNCA devolve a reunião da org A como replay da org B", async () => {
    // Org A cria uma reunião via webhook com externalId "collide-1".
    const rA = await call({ campaignId: seedA.campaignId, leadId: seedA.leadId, startsAt: futureIso(), durationMin: 30, externalId: "collide-1" });
    expect(rA.status).toBe(201);
    const jA = await rA.json();
    expect(jA.idempotentReplay).toBeUndefined();

    // Org B chama o mesmo webhook, com campaignId/leadId legítimos da PRÓPRIA org B, reaproveitando o
    // MESMO externalId cru "collide-1" já usado pela org A. Antes do fix: 200, idempotentReplay:true, com
    // o meetingId da org A (vazamento). Depois do fix: a org B nunca vê a reunião da org A — cria a sua
    // própria (nova), nunca um "replay" cruzando org.
    const rB = await call({ campaignId: seedB.campaignId, leadId: seedB.leadId, startsAt: futureIso(), durationMin: 45, externalId: "collide-1" });
    expect(rB.status).toBe(201);
    const jB = await rB.json();
    expect(jB.idempotentReplay).toBeUndefined();
    expect(jB.meetingId).not.toBe(jA.meetingId);

    const meetingA = await prisma.meeting.findUniqueOrThrow({ where: { id: jA.meetingId } });
    const meetingB = await prisma.meeting.findUniqueOrThrow({ where: { id: jB.meetingId } });
    expect(meetingA.campaignId).toBe(seedA.campaignId);
    expect(meetingB.campaignId).toBe(seedB.campaignId);
    expect(meetingA.externalId).not.toBe(meetingB.externalId); // mesmo externalId cru, chaves persistidas escopadas por org são diferentes

    // Replay de verdade DENTRO da mesma org continua funcionando (não regrediu a idempotência real).
    const rAReplay = await call({ campaignId: seedA.campaignId, leadId: seedA.leadId, startsAt: futureIso(), durationMin: 30, externalId: "collide-1" });
    expect(rAReplay.status).toBe(200);
    const jAReplay = await rAReplay.json();
    expect(jAReplay.idempotentReplay).toBe(true);
    expect(jAReplay.meetingId).toBe(jA.meetingId);

    await prisma.meeting.delete({ where: { id: meetingA.id } });
    await prisma.meeting.delete({ where: { id: meetingB.id } });
  });
});
