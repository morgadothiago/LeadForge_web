import "dotenv/config";
import { PrismaClient, Channel, Stage, SequenceStatus, TouchStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/auth/password";

export const SEED_IDS = {
  user: "00000000-0000-4000-8000-000000000001",
  /** SPEC-030: Organization dona de todo o dado de seed (o usuário de seed é `provider`, owner desta org). */
  org: "00000000-0000-4000-8000-00000000000f",
  icp: "00000000-0000-4000-8000-000000000002",
  campaign: "00000000-0000-4000-8000-000000000003",
  sequence: "00000000-0000-4000-8000-000000000004",
  tpl: (i: number) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
};

const STEPS: { order: number; day: number; channel: Channel }[] = [
  { order: 1, day: 0, channel: "email" },
  { order: 2, day: 2, channel: "whatsapp" },
  { order: 3, day: 5, channel: "email" },
  { order: 4, day: 7, channel: "linkedin" },
  { order: 5, day: 10, channel: "whatsapp" },
];

/** IDs fixos: kind 2=touch out, 3=touch in, 4=meeting, 5=stage history. */
function seedId(kind: number, lead: number, k: number): string {
  return `00000000-0000-4000-8000-${kind}${String(lead).padStart(3, "0")}${String(k).padStart(2, "0")}000000`;
}

export async function seed(prisma: PrismaClient, now: Date = new Date()) {
  // SPEC-030: usuário de seed é `provider`, owner de uma Organization própria — todo o dado de negócio
  // abaixo (ICP/Sequence/Campaign/...) pertence a ela. `signInAsSeedAdmin()` continua funcionando: agora
  // resolve orgId/platformRole por essa Membership (não mais por "role=admin").
  await prisma.user.upsert({
    where: { email: "admin@leadforge.local" },
    update: {},
    create: { id: SEED_IDS.user, name: "Admin", email: "admin@leadforge.local", role: "provider" },
  });
  await prisma.organization.upsert({
    where: { id: SEED_IDS.org },
    update: {},
    create: { id: SEED_IDS.org, name: "Organização de Seed", slug: "seed-org", status: "active" },
  });
  await prisma.membership.upsert({
    where: { userId_orgId: { userId: SEED_IDS.user, orgId: SEED_IDS.org } },
    update: {},
    create: { userId: SEED_IDS.user, orgId: SEED_IDS.org, orgRole: "owner" },
  });
  await prisma.icpProfile.upsert({
    where: { id: SEED_IDS.icp },
    update: {},
    create: {
      id: SEED_IDS.icp,
      orgId: SEED_IDS.org,
      name: "Clínicas odontológicas SP",
      niche: "Odontologia",
      location: "São Paulo, SP",
      companySize: "5-50",
      signals: ["site sem agendamento online", "poucas avaliações"],
      keywords: ["clínica odontológica", "dentista"],
      sources: ["google_maps", "linkedin"],
      desiredData: ["email", "phone", "website"],
    },
  });
  await prisma.sequence.upsert({
    where: { id: SEED_IDS.sequence },
    update: {},
    create: { id: SEED_IDS.sequence, orgId: SEED_IDS.org, name: "Cadência 0/2/5/7/10" },
  });
  await prisma.campaign.upsert({
    where: { id: SEED_IDS.campaign },
    update: {},
    create: {
      id: SEED_IDS.campaign,
      orgId: SEED_IDS.org,
      name: "Prospecção Odonto SP",
      description: "Campanha de exemplo",
      icpId: SEED_IDS.icp,
      sequenceId: SEED_IDS.sequence,
      userId: SEED_IDS.user,
      // Dado de teste nunca pode disparar envio: campanha nasce pausada e sem início automático (SPEC-013).
      status: "paused",
      autoStart: false,
    },
  });
  for (const s of STEPS) {
    const templateId = SEED_IDS.tpl(s.order);
    await prisma.messageTemplate.upsert({
      where: { id: templateId },
      update: {},
      create: {
        id: templateId,
        orgId: SEED_IDS.org,
        campaignId: SEED_IDS.campaign,
        channel: s.channel,
        name: `Dia ${s.day} - ${s.channel}`,
        subject: s.channel === "email" ? `Olá {{name}}, uma ideia para {{company}}` : null,
        body: `Olá {{name}}, aqui é o passo do dia ${s.day} para {{company}}.`,
      },
    });
    await prisma.sequenceStep.upsert({
      where: { sequenceId_order: { sequenceId: SEED_IDS.sequence, order: s.order } },
      update: {},
      create: {
        sequenceId: SEED_IDS.sequence,
        order: s.order,
        day: s.day,
        channel: s.channel,
        templateId,
      },
    });
  }

  const stages: Stage[] = [
    "novo_lead", "novo_lead", "novo_lead", "novo_lead", "novo_lead",
    "contactado", "contactado", "contactado", "contactado",
    "em_followup", "em_followup", "em_followup",
    "interessado", "interessado", "interessado",
    "reuniao_agendada", "reuniao_agendada",
    "fechado", "perdido", "perdido",
  ];
  const PATH: Stage[] = ["novo_lead", "contactado", "em_followup", "interessado", "reuniao_agendada", "fechado"];
  const SENT: Record<Stage, number> = {
    novo_lead: 0, contactado: 1, em_followup: 3, interessado: 2,
    reuniao_agendada: 3, fechado: 3, perdido: 2,
  };
  const HOUR = 3600_000;
  const at = (base: Date, hours: number) => new Date(base.getTime() + hours * HOUR);
  const posByStage: Partial<Record<Stage, number>> = {};
  for (let i = 0; i < 20; i++) {
    const n = i + 1;
    const stage = stages[i];
    const email = `lead${n}@clinica${n}.example`;
    const replied = ["interessado", "reuniao_agendada", "fechado"].includes(stage);
    const seqStatus: SequenceStatus =
      stage === "novo_lead" ? "not_started" : stage === "perdido" ? "opted_out" :
      replied ? "paused_replied" : "active";
    // Datas determinísticas por índice, relativas a `now` (lead 1 = 28d atrás ... lead 20 = 9d atrás).
    const t0 = at(now, -(28 - i) * 24);
    const sentCount = SENT[stage];
    const sendTimes: Date[] = [];
    for (let k = 0; k < sentCount; k++) {
      const day = STEPS[k].day;
      const t = at(t0, day * 24 + 26 + i);
      const cap = at(now, -(6 - k));
      sendTimes.push(t > cap ? cap : t);
    }
    const lastSent = sendTimes[sentCount - 1];
    const repliedAt = replied ? at(lastSent, 6 + (i % 5)) : null;
    const optedOutAt = stage === "perdido" ? at(lastSent, 8) : null;
    const nextTouchAt =
      seqStatus === "active" ? at(now, (1 + (i % 3)) * 24) : null;
    const lead = await prisma.lead.upsert({
      where: { campaignId_email: { campaignId: SEED_IDS.campaign, email } },
      update: {},
      create: {
        campaignId: SEED_IDS.campaign,
        name: `Contato ${n}`,
        company: `Clínica ${n}`,
        email,
        phone: `+5511999000${String(n).padStart(3, "0")}`,
        website: `https://clinica${n}.example`,
        source: "seed",
        score: (n * 5) % 100,
        tags: ["seed"],
        sequenceStatus: seqStatus,
        currentStepOrder: sentCount,
        nextTouchAt,
        repliedAt,
        optedOutAt,
        createdAt: t0,
      },
    });
    const position = posByStage[stage] ?? 0;
    posByStage[stage] = position + 1;
    const opp = await prisma.opportunity.upsert({
      where: { leadId_campaignId: { leadId: lead.id, campaignId: SEED_IDS.campaign } },
      update: {},
      create: { leadId: lead.id, campaignId: SEED_IDS.campaign, stage, position, createdAt: t0 },
    });

    // Touches outbound (um por passo enviado; 1 falha no lead 9)
    for (let k = 0; k < sentCount; k++) {
      const step = STEPS[k];
      const isReplied = replied && k === sentCount - 1;
      const failed = n === 9 && k === 0;
      const status: TouchStatus = failed ? "failed" : isReplied ? "replied" : step.channel === "whatsapp" ? "delivered" : "sent";
      const stepRow = await prisma.sequenceStep.findUniqueOrThrow({
        where: { sequenceId_order: { sequenceId: SEED_IDS.sequence, order: step.order } },
      });
      await prisma.touch.upsert({
        where: { id: seedId(2, n, k) },
        update: {},
        create: {
          id: seedId(2, n, k),
          leadId: lead.id,
          stepId: stepRow.id,
          channel: step.channel,
          direction: "outbound",
          status,
          scheduledAt: sendTimes[k],
          sentAt: failed ? null : sendTimes[k],
          repliedAt: isReplied ? repliedAt : null,
          error: failed ? "SMTP timeout (seed)" : null,
          content: `Mensagem do passo ${step.order} para ${lead.name}`,
          createdAt: sendTimes[k],
        },
      });
    }
    // Próximo passo agendado para leads com sequência ativa
    if (seqStatus === "active" && sentCount < STEPS.length) {
      const step = STEPS[sentCount];
      const stepRow = await prisma.sequenceStep.findUniqueOrThrow({
        where: { sequenceId_order: { sequenceId: SEED_IDS.sequence, order: step.order } },
      });
      await prisma.touch.upsert({
        where: { id: seedId(2, n, 9) },
        update: {},
        create: {
          id: seedId(2, n, 9),
          leadId: lead.id,
          stepId: stepRow.id,
          channel: step.channel,
          direction: "outbound",
          // Já `skipped`: nada de seed pode ser enviado (o histórico do dashboard não depende de agendados futuros).
          status: "skipped",
          error: "dado de teste (seed)",
          scheduledAt: nextTouchAt,
          createdAt: lastSent,
        },
      });
    }
    // Touch inbound (resposta)
    if (replied && repliedAt) {
      await prisma.touch.upsert({
        where: { id: seedId(3, n, 0) },
        update: {},
        create: {
          id: seedId(3, n, 0),
          leadId: lead.id,
          channel: STEPS[sentCount - 1].channel,
          direction: "inbound",
          status: "replied",
          repliedAt,
          content: "Olá! Tenho interesse, podemos conversar?",
          createdAt: repliedAt,
        },
      });
    }

    // Meetings
    let meetingAt: Date | null = null;
    if ((stage === "reuniao_agendada" || stage === "fechado") && repliedAt) {
      meetingAt = at(repliedAt, 12);
      const done = stage === "fechado";
      const meetingStart = done ? at(meetingAt, 48) : at(now, (2 + (i % 3)) * 24);
      await prisma.meeting.upsert({
        where: { id: seedId(4, n, 0) },
        update: {},
        create: {
          id: seedId(4, n, 0),
          opportunityId: opp.id,
          leadId: lead.id,
          campaignId: opp.campaignId,
          startsAt: meetingStart,
          endsAt: new Date(meetingStart.getTime() + 30 * 60_000),
          duration: 30,
          status: done ? "done" : "scheduled",
          createdAt: meetingAt,
        },
      });
    }

    // Histórico de stage coerente com o stage atual
    const chain: { from: Stage | null; to: Stage; when: Date }[] = [];
    if (stage === "perdido") {
      chain.push({ from: null, to: "novo_lead", when: t0 });
      chain.push({ from: "novo_lead", to: "contactado", when: sendTimes[0] });
      chain.push({ from: "contactado", to: "perdido", when: optedOutAt! });
    } else {
      const upto = PATH.indexOf(stage);
      const whens: Date[] = [
        t0, sendTimes[0], sendTimes[1], repliedAt, meetingAt, meetingAt && at(meetingAt, 49),
      ] as Date[];
      for (let j = 0; j <= upto; j++) {
        chain.push({ from: j === 0 ? null : PATH[j - 1], to: PATH[j], when: whens[j] });
      }
    }
    for (let j = 0; j < chain.length; j++) {
      const c = chain[j];
      await prisma.stageHistory.upsert({
        where: { id: seedId(5, n, j) },
        update: {},
        create: {
          id: seedId(5, n, j),
          opportunityId: opp.id,
          fromStage: c.from,
          toStage: c.to,
          changedAt: c.when,
        },
      });
    }
  }
}

/** Cria/atualiza o admin a partir de ADMIN_EMAIL/ADMIN_PASSWORD (idempotente). Sem senha no env: pula com aviso. */
export async function seedAdmin(
  prisma: PrismaClient,
  env: Record<string, string | undefined> = process.env,
): Promise<"skipped" | "upserted"> {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn("[seed] ADMIN_EMAIL/ADMIN_PASSWORD ausentes: admin com senha NÃO criado (login indisponível).");
    return "skipped";
  }
  if (password.length < 12) throw new Error("ADMIN_PASSWORD deve ter ao menos 12 caracteres.");
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { name: "Admin", email, role: "provider", passwordHash },
  });
  // SPEC-030: garante Organization própria (owner) se ainda não existir — sem isso o login fica bloqueado
  // (sessão nunca é criada sem org para um `provider`, ver actions/auth.ts).
  const hasOrg = await prisma.membership.findFirst({ where: { userId: user.id } });
  if (!hasOrg) {
    const org = await prisma.organization.create({ data: { name: "Organização Admin", slug: `admin-org-${user.id.slice(0, 8)}`, status: "active" } });
    await prisma.membership.create({ data: { userId: user.id, orgId: org.id, orgRole: "owner" } });
  }
  return "upserted";
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    await seed(prisma);
    await seedAdmin(prisma);
    console.log("seed ok");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
