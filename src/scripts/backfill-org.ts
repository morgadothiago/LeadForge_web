import "dotenv/config";
import { prisma } from "@/lib/prisma";

/**
 * SPEC-030 — backfill de dados para multi-tenant (D-30-1/D-30-2). Roda DEPOIS da migration
 * `20260925100000_multi_tenant_orgs_structure` (orgId nullable) e ANTES da migration
 * `20260925100100_multi_tenant_orgs_notnull` (orgId obrigatorio). Nao roda `prisma migrate` sozinho.
 *
 * Regra base (D-30-1): User.role="admin" -> "platform_admin" (sem Organization propria).
 * User.role="member" -> "provider", dono ("owner") de uma Organization nova 1:1.
 *
 * Caso de borda encontrado nesta base (documentado no relatorio de implementacao da SPEC-030):
 * nao havia nenhum User com role="member" nesta instalacao — o unico User tem role="admin" mas
 * e dono de dados de negocio reais (Campaign etc.), sobra do modelo single-tenant anterior (role
 * era so rotulo, sem enforcement). Perder esses dados violaria "preservar os dados existentes sem
 * perda" (D-30-1). Decisao do dev-backend: esse usuario tambem recebe uma Organization propria
 * (Membership owner) MESMO permanecendo platform_admin — unico jeito de nao orfanizar Campaign/
 * IcpProfile/etc. com FK orgId NOT NULL. Nao e o caminho "normal" (platform_admin tipicamente sem
 * org), e uma rede de seguranca so para dados orfaos pre-existentes.
 */

function slugify(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "org"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = slugify(base);
  let n = 0;
  // volume baixo (migração única) — loop simples é suficiente
  while (await prisma.organization.findUnique({ where: { slug }, select: { id: true } })) {
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
  return slug;
}

async function createOrgFor(userId: string, name: string, email: string, reason: string): Promise<string> {
  const slug = await uniqueSlug(name || email.split("@")[0]);
  const org = await prisma.organization.create({ data: { name: name || email, slug, status: "active" } });
  await prisma.membership.create({ data: { userId, orgId: org.id, orgRole: "owner" } });
  console.log(`[backfill-org] Organization criada (${reason}): ${org.id} slug=${slug} owner=${userId}`);
  return org.id;
}

async function main() {
  console.log("[backfill-org] iniciando backfill SPEC-030...");

  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true } });
  const userOrg = new Map<string, string>(); // userId -> orgId (1 org ativa por usuário nesta fase)

  // 1) role="member" -> "provider" + Organization própria 1:1 (D-30-1, caminho normal)
  for (const u of users) {
    if (u.role === "member") {
      const existing = await prisma.membership.findFirst({ where: { userId: u.id }, select: { orgId: true } });
      const orgId = existing ? existing.orgId : await createOrgFor(u.id, u.name, u.email, "ex-member");
      userOrg.set(u.id, orgId);
      await prisma.user.update({ where: { id: u.id }, data: { role: "provider" } });
    }
  }

  // 2) role="admin" -> "platform_admin" (sem org, caminho normal D-30-1)
  for (const u of users) {
    if (u.role === "admin") {
      await prisma.user.update({ where: { id: u.id }, data: { role: "platform_admin" } });
    }
  }

  // 3) Rede de segurança: admin (agora platform_admin) dono de dados de negócio reais (Campaign)
  //    sem nenhum outro usuário para herdar os dados -> ganha Organization própria mesmo assim
  //    (ver comentário no topo do arquivo). Só roda se o usuário ainda não tem org (não era "member").
  const campaignOwners = await prisma.campaign.findMany({ select: { userId: true }, distinct: ["userId"] });
  for (const { userId } of campaignOwners) {
    if (userOrg.has(userId)) continue;
    const existing = await prisma.membership.findFirst({ where: { userId }, select: { orgId: true } });
    if (existing) {
      userOrg.set(userId, existing.orgId);
      continue;
    }
    const u = users.find((x) => x.id === userId);
    if (!u) continue;
    const orgId = await createOrgFor(userId, u.name, u.email, "caso-de-borda: admin dono de Campaign pré-existente");
    userOrg.set(userId, orgId);
  }

  // orgId "default" para dados órfãos (globais/sem dono claro: SchedulerRun, IntegrationSecret, etc.)
  // — usa a primeira Organization existente; cria uma "Organização Legada" só se nada mais existir.
  async function defaultOrgId(): Promise<string> {
    const first = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
    if (first) return first.id;
    const legacyOwner = users[0];
    if (!legacyOwner) throw new Error("[backfill-org] nenhum usuário na base para ancorar a Organização Legada.");
    return createOrgFor(legacyOwner.id, "Organização Legada", legacyOwner.email, "fallback sem nenhuma org até aqui");
  }

  // 4) Campaign.orgId = org do dono (userId)
  const campaigns = await prisma.campaign.findMany({ select: { id: true, userId: true, icpId: true, sequenceId: true, whatsappInstanceId: true } });
  for (const c of campaigns) {
    const orgId = userOrg.get(c.userId) ?? (await defaultOrgId());
    await prisma.campaign.update({ where: { id: c.id }, data: { orgId } });
  }

  // 5) MessageTemplate.orgId via Campaign (FK direta campaignId)
  const templates = await prisma.messageTemplate.findMany({ select: { id: true, campaignId: true } });
  for (const t of templates) {
    const camp = await prisma.campaign.findUnique({ where: { id: t.campaignId }, select: { orgId: true } });
    await prisma.messageTemplate.update({ where: { id: t.id }, data: { orgId: camp?.orgId ?? (await defaultOrgId()) } });
  }

  // 6) IcpProfile.orgId via primeira Campaign que referencia o ICP; órfão -> default
  const icps = await prisma.icpProfile.findMany({ select: { id: true } });
  for (const icp of icps) {
    const camp = await prisma.campaign.findFirst({ where: { icpId: icp.id }, select: { orgId: true } });
    await prisma.icpProfile.update({ where: { id: icp.id }, data: { orgId: camp?.orgId ?? (await defaultOrgId()) } });
  }

  // 7) Sequence.orgId via primeira Campaign que referencia a Sequence; órfã -> default
  const sequences = await prisma.sequence.findMany({ select: { id: true } });
  for (const seq of sequences) {
    const camp = await prisma.campaign.findFirst({ where: { sequenceId: seq.id }, select: { orgId: true } });
    await prisma.sequence.update({ where: { id: seq.id }, data: { orgId: camp?.orgId ?? (await defaultOrgId()) } });
  }

  // 8) WhatsAppInstance.orgId via primeira Campaign que a usa; órfã -> default
  const instances = await prisma.whatsAppInstance.findMany({ select: { id: true } });
  for (const inst of instances) {
    const camp = await prisma.campaign.findFirst({ where: { whatsappInstanceId: inst.id }, select: { orgId: true } });
    await prisma.whatsAppInstance.update({ where: { id: inst.id }, data: { orgId: camp?.orgId ?? (await defaultOrgId()) } });
  }

  // 9) EmailAccount.orgId via userId; sem org do dono -> default
  const emailAccounts = await prisma.emailAccount.findMany({ select: { id: true, userId: true } });
  for (const ea of emailAccounts) {
    const orgId = userOrg.get(ea.userId) ?? (await defaultOrgId());
    await prisma.emailAccount.update({ where: { id: ea.id }, data: { orgId } });
  }

  // 10) Suppression.orgId via leadId -> Lead -> Campaign; sem leadId -> default
  const suppressions = await prisma.suppression.findMany({ select: { id: true, leadId: true } });
  for (const s of suppressions) {
    let orgId: string | undefined;
    if (s.leadId) {
      const lead = await prisma.lead.findUnique({ where: { id: s.leadId }, select: { campaign: { select: { orgId: true } } } });
      orgId = lead?.campaign.orgId;
    }
    await prisma.suppression.update({ where: { id: s.id }, data: { orgId: orgId ?? (await defaultOrgId()) } });
  }

  // 11) SchedulerRun.orgId: histórico global pré-multi-tenant, sem link -> default (limitação documentada)
  const schedulerRuns = await prisma.schedulerRun.findMany({ select: { id: true } });
  for (const r of schedulerRuns) {
    await prisma.schedulerRun.update({ where: { id: r.id }, data: { orgId: await defaultOrgId() } });
  }

  // 12) IntegrationSecret/IntegrationAuditLog.orgId: segredos globais pré-multi-tenant -> default
  const secrets = await prisma.integrationSecret.findMany({ select: { id: true } });
  for (const s of secrets) {
    await prisma.integrationSecret.update({ where: { id: s.id }, data: { orgId: await defaultOrgId() } });
  }
  const auditLogs = await prisma.integrationAuditLog.findMany({ select: { id: true, userId: true } });
  for (const a of auditLogs) {
    const orgId = userOrg.get(a.userId) ?? (await defaultOrgId());
    await prisma.integrationAuditLog.update({ where: { id: a.id }, data: { orgId } });
  }

  // 13) AgentSettings/MeetingSettings: singleton "global" -> vira a linha da primeira org; demais orgs
  //     ganham uma linha nova com os valores default (nunca duplicam o singleton antigo).
  const allOrgIds = (await prisma.organization.findMany({ select: { id: true } })).map((o) => o.id);
  // orgId ainda é nullable no banco nesta fase (fase 2 do migration seta NOT NULL depois) — o client
  // tipado já assume obrigatório (schema final), então usa-se SQL cru só para achar/gravar as linhas
  // "global" (id="global") que ainda não têm orgId.
  const [globalAgentSettings] = await prisma.$queryRaw<{ id: string; killSwitch: boolean }[]>`
    SELECT id, "killSwitch" FROM "AgentSettings" WHERE "orgId" IS NULL LIMIT 1`;
  for (const orgId of allOrgIds) {
    if (globalAgentSettings && orgId === allOrgIds[0]) {
      await prisma.$executeRaw`UPDATE "AgentSettings" SET "orgId" = ${orgId} WHERE id = ${globalAgentSettings.id}`;
    } else if (!(await prisma.agentSettings.findUnique({ where: { orgId } }))) {
      await prisma.agentSettings.create({ data: { orgId, killSwitch: globalAgentSettings?.killSwitch ?? true } });
    }
  }
  const [globalMeetingSettings] = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "MeetingSettings" WHERE "orgId" IS NULL LIMIT 1`;
  for (const orgId of allOrgIds) {
    if (globalMeetingSettings && orgId === allOrgIds[0]) {
      await prisma.$executeRaw`UPDATE "MeetingSettings" SET "orgId" = ${orgId} WHERE id = ${globalMeetingSettings.id}`;
    } else if (!(await prisma.meetingSettings.findUnique({ where: { orgId } }))) {
      await prisma.meetingSettings.create({ data: { orgId } });
    }
  }

  // 14) Agent/KnowledgeDocument.orgId: sem dado pré-existente nesta base na maioria dos casos, mas
  //     cobre o caso geral (agente global pré-migração vira default org).
  const agents = await prisma.agent.findMany({ select: { id: true } });
  for (const ag of agents) {
    await prisma.agent.update({ where: { id: ag.id }, data: { orgId: await defaultOrgId() } });
  }
  const knowledgeDocs = await prisma.knowledgeDocument.findMany({ select: { id: true, agentId: true } });
  for (const kd of knowledgeDocs) {
    let orgId: string | undefined;
    if (kd.agentId) {
      const ag = await prisma.agent.findUnique({ where: { id: kd.agentId }, select: { orgId: true } });
      orgId = ag?.orgId;
    }
    await prisma.knowledgeDocument.update({ where: { id: kd.id }, data: { orgId: orgId ?? (await defaultOrgId()) } });
  }

  // 15) MobileAlert.orgId: vazamento cross-tenant corrigido na 3ª rodada da SPEC-030 (a varredura de
  //     src/lib/mobile/alerts.ts passou a rodar por Organization e resolver a org dona de cada evento
  //     na criação). Linhas pré-existentes são estado DERIVADO/EFÊMERO — sempre recriado pela próxima
  //     varredura (`sweepAlerts`), nunca dado de negócio do usuário — e nenhuma delas tem como resolver
  //     org de forma segura (baseline/scheduler_stale eram, por design antigo, singletons SEM org).
  //     Decisão do dev-backend: apagar em vez de inventar org — perder um alerta computável não é perda
  //     de dado real, e a alternativa (atribuir a uma org "default" arbitrária) seria pior: um alerta que
  //     nunca pertenceu a ela apareceria para o provider errado, o mesmo vazamento que este backfill existe
  //     para corrigir. Confirmado nesta base: só 2 linhas (baseline + scheduler_stale antigo).
  const deleted = await prisma.mobileAlert.deleteMany({});
  console.log(`[backfill-org] MobileAlert: ${deleted.count} linha(s) efêmera(s) apagada(s) (sem org resolvível; serão recriadas pela próxima varredura).`);

  console.log("[backfill-org] concluído.");
}

main()
  .catch((e) => {
    console.error("[backfill-org] falhou:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
