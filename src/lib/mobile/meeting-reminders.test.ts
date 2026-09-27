import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import { prisma } from "@/lib/prisma";
import { createHttpClient } from "@/lib/http/client";
import { mkMeetingFixture, type MeetingFixture } from "@/lib/test-utils/meeting-fixture";
import { parkOtherOrgs } from "@/lib/test-utils/park-other-orgs";
import { updateMeeting } from "@/lib/domain/meeting";
import { baselineKey, sweepAlerts, _resetSweepThrottle } from "./alerts";
import { _setExpoClient } from "./expo-push";
import { REMINDER_BODY, reminderKey, reminderTitle } from "./meeting-reminders";

const MIN = 60_000;
const OLD = new Date(Date.now() - 30 * 24 * 3600_000); // updatedAt antigo: reuniao "de antes" (sem baseline por edicao recente)
let fx: MeetingFixture;
let devId = "";
let parked: string[] = [];
let restoreOtherOrgs: () => Promise<void> = async () => {};
const LINK = "https://meet.zzsecret.test/sala-xyz";
const NOTES = "notas-secretas-zz-999";

const mk = (startsAt: Date, extra: Record<string, unknown> = {}) =>
  prisma.meeting.create({
    data: { opportunityId: fx.oppId, leadId: fx.leadId, campaignId: fx.campId, startsAt, endsAt: new Date(startsAt.getTime() + 30 * MIN), duration: 30, link: LINK, notes: NOTES, updatedAt: OLD, ...extra },
  });
// Sempre escopado por fx.orgId: `sweepAlerts` varre TODAS as orgs ATIVAS do banco de teste
// compartilhado (SPEC-030, cross-tenant por design); sem o filtro, esta suite ficaria
// vulneravel a qualquer alerta de outra org/fixture que exista no banco no momento do teste.
const remAlerts = () => prisma.mobileAlert.findMany({ where: { kind: "meeting_reminder", orgId: fx.orgId }, orderBy: { createdAt: "asc" } });
const sweepAt = async (now: Date) => {
  _resetSweepThrottle();
  await sweepAlerts(now);
};
const seedBaseline = () => prisma.mobileAlert.create({ data: { orgId: fx.orgId, kind: "baseline", severity: "baixa", dedupeKey: baselineKey(fx.orgId), title: "baseline", body: "baseline", refType: "scheduler", readAt: new Date(), resolvedAt: new Date() } });

beforeAll(async () => {
  fx = await mkMeetingFixture("zz-test-mrem");
  // isola: reunioes agendadas do seed (podem cair na janela) ficam fora desta suite e sao restauradas no fim
  parked = (await prisma.meeting.findMany({ where: { status: "scheduled", campaignId: { not: fx.campId } }, select: { id: true } })).map((m) => m.id);
  await prisma.meeting.updateMany({ where: { id: { in: parked } }, data: { status: "done" } });
  devId = (await prisma.mobileDevice.create({ data: { userId: fx.userId, name: "zz-dev", platform: "android", refreshHash: `h-${crypto.randomUUID()}`, refreshExpiresAt: new Date(Date.now() + 1e9), pushToken: "ExponentPushToken[zzMEET]" } })).id;
  // `sweepAlerts` e cross-tenant (SPEC-030): esta suite chama sweepAt() em loop (varias varreduras por
  // teste); com so a propria org ativa, cada varredura fica O(1) em vez de O(orgs do banco de teste
  // compartilhado) — elimina a fonte real da flakiness por timeout (SPEC-031, QA de 2026-09-26).
  ({ restore: restoreOtherOrgs } = await parkOtherOrgs(fx.orgId));
});
beforeEach(async () => {
  // Escopado por fx.orgId (nunca `{}` global): apagar alertas/config de TODAS as orgs afetaria
  // fixtures de outros arquivos de teste que compartilham o mesmo banco `_test`.
  await prisma.mobileAlert.deleteMany({ where: { orgId: fx.orgId } });
  await prisma.meeting.deleteMany({ where: { campaignId: fx.campId } });
  await prisma.meetingSettings.deleteMany({ where: { orgId: fx.orgId } });
  await seedBaseline();
});
afterEach(() => {
  delete process.env.MOBILE_PUSH_ENABLED;
  _setExpoClient(undefined);
});
afterAll(async () => {
  await prisma.meeting.updateMany({ where: { id: { in: parked } }, data: { status: "scheduled" } });
  await prisma.mobileDevice.deleteMany({ where: { id: devId } });
  await prisma.mobileAlert.deleteMany({ where: { orgId: fx.orgId } });
  await restoreOtherOrgs();
  await fx.cleanup();
  await prisma.$disconnect();
});

describe("lembretes de reuniao (SPEC-028)", () => {
  it("janelas 24h/1h/15min: exatamente 1 alerta por janela; 5 varreduras nao duplicam", async () => {
    const T = new Date(Date.now() + 3 * 24 * 3600_000);
    const m = await mk(T);
    await sweepAt(new Date(T.getTime() - 1441 * MIN));
    expect(await remAlerts()).toHaveLength(0);
    for (let i = 0; i < 5; i++) await sweepAt(new Date(T.getTime() - 1440 * MIN + i * 1000));
    expect((await remAlerts()).map((a) => a.dedupeKey)).toEqual([reminderKey(m.id, T.getTime(), 1440)]);
    for (let i = 0; i < 5; i++) await sweepAt(new Date(T.getTime() - 60 * MIN + i * 1000));
    for (let i = 0; i < 5; i++) await sweepAt(new Date(T.getTime() - 15 * MIN + i * 1000));
    const a = await remAlerts();
    expect(a.map((x) => x.dedupeKey)).toEqual([1440, 60, 15].map((o) => reminderKey(m.id, T.getTime(), o)));
    expect(a.every((x) => x.resolvedAt === null && x.refType === "meeting" && x.refId === m.id && x.link === null)).toBe(true);
    expect(a.map((x) => x.title)).toEqual(["Reunião em 24 horas", "Reunião em 1 hora", "Reunião em 15 min"]);
    // apos o inicio: resolvidos (passada)
    await sweepAt(new Date(T.getTime() + MIN));
    expect((await remAlerts()).every((x) => x.resolvedAt !== null)).toBe(true);
    expect(await remAlerts()).toHaveLength(3);
  });

  it("cron atrasado emite o lembrete valido mais proximo, nunca um vencido", async () => {
    const T = new Date(Date.now() + 3 * 24 * 3600_000);
    const m = await mk(T);
    await sweepAt(new Date(T.getTime() - 10 * MIN));
    expect((await remAlerts()).map((a) => a.dedupeKey)).toEqual([reminderKey(m.id, T.getTime(), 15)]);
  });

  it("baseline: reuniao criada/editada dentro da janela nasce lida e sem push; a anterior a janela notifica", async () => {
    process.env.MOBILE_PUSH_ENABLED = "true";
    const calls = { n: 0 };
    _setExpoClient(fake(calls));
    const now = new Date();
    const fresh = await mk(new Date(now.getTime() + 10 * MIN), { updatedAt: now }); // acabou de ser criada dentro da janela de 15 min
    const old = await mk(new Date(now.getTime() + 12 * MIN)); // ja existia antes da janela
    await sweepAt(now);
    const a = await remAlerts();
    expect(a.find((x) => x.refId === fresh.id)?.readAt).not.toBeNull();
    expect(a.find((x) => x.refId === old.id)?.readAt).toBeNull();
    expect(calls.n).toBe(1); // so a "old"
  });

  it("configuracao ligada dentro da janela: alerta lido, sem push retroativo", async () => {
    process.env.MOBILE_PUSH_ENABLED = "true";
    const calls = { n: 0 };
    _setExpoClient(fake(calls));
    const now = new Date();
    await mk(new Date(now.getTime() + 30 * MIN));
    await prisma.meetingSettings.create({ data: { orgId: fx.orgId, remindersEnabled: true, offsetsMin: [60] } }); // updatedAt = agora > inicio da janela de 60 min
    await sweepAt(now);
    const a = await remAlerts();
    expect(a).toHaveLength(1);
    expect(a[0].readAt).not.toBeNull();
    expect(calls.n).toBe(0);
  });

  it("reagendar gera novos e resolve os antigos; cancelar resolve pendentes", async () => {
    const now = new Date();
    const T1 = new Date(now.getTime() + 10 * MIN);
    const m = await mk(T1);
    await sweepAt(now);
    expect((await remAlerts()).filter((a) => !a.resolvedAt)).toHaveLength(1);
    const T2 = new Date(now.getTime() + 20 * MIN);
    const u = await updateMeeting({ id: m.id, startsAt: T2, now });
    expect(u.status).toBe("ok");
    expect((await remAlerts()).filter((a) => !a.resolvedAt)).toHaveLength(0); // antigos resolvidos ja na edicao
    await prisma.meeting.update({ where: { id: m.id }, data: { updatedAt: OLD } });
    await sweepAt(now);
    const keys = (await remAlerts()).filter((a) => !a.resolvedAt).map((a) => a.dedupeKey);
    expect(keys).toEqual([reminderKey(m.id, T2.getTime(), 60)]); // novo startsAt => nova chave
    await prisma.meeting.update({ where: { id: m.id }, data: { status: "cancelled" } }); // cancelada por fora do dominio: a varredura resolve
    await sweepAt(now);
    expect((await remAlerts()).filter((a) => !a.resolvedAt)).toHaveLength(0);
  });

  it("desligar lembretes ou trocar offsets", async () => {
    const T = new Date(Date.now() + 40 * MIN);
    const m = await mk(T);
    await prisma.meetingSettings.create({ data: { orgId: fx.orgId, remindersEnabled: false, offsetsMin: [60] } });
    await sweepAt(new Date());
    expect(await remAlerts()).toHaveLength(0);
    await prisma.meetingSettings.update({ where: { orgId: fx.orgId }, data: { remindersEnabled: true, offsetsMin: [30, 5] } });
    await sweepAt(new Date(T.getTime() - 20 * MIN)); // 30 min aberto; 60 nao configurado
    expect((await remAlerts()).map((a) => a.dedupeKey)).toEqual([reminderKey(m.id, T.getTime(), 30)]);
  });

  it("timezone da reuniao e do processo nao mudam a janela (UTC)", async () => {
    const prev = process.env.TZ;
    try {
      for (const tz of ["UTC", "Asia/Tokyo"]) {
        process.env.TZ = tz;
        await prisma.mobileAlert.deleteMany({ where: { kind: "meeting_reminder" } });
        await prisma.meeting.deleteMany({ where: { campaignId: fx.campId } });
        const T = new Date(Date.now() + 2 * 24 * 3600_000);
        const m = await mk(T, { timezone: "Asia/Tokyo" });
        await sweepAt(new Date(T.getTime() - 60 * MIN));
        expect((await remAlerts()).map((a) => a.dedupeKey)).toEqual([reminderKey(m.id, T.getTime(), 60)]);
      }
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });

  type Sent = { to: string; title: string; body: string; data: Record<string, unknown> }[];
  function fake(calls: { n: number }, sink?: Sent): ReturnType<typeof createHttpClient> {
    const adapter: AxiosAdapter = async (cfg: InternalAxiosRequestConfig) => {
      const body = JSON.parse(cfg.data as string) as Sent;
      if (body.some((b) => b.title.startsWith("Reunião"))) {
        calls.n++;
        sink?.push(...body);
      }
      return { status: 200, statusText: "", data: { data: body.map(() => ({ status: "ok" })) }, headers: {}, config: cfg, request: {} } as never;
    };
    return createHttpClient({ name: "t", baseURL: "https://exp.test", adapter, retry: { maxAttempts: 1 } });
  }

  it("push so com texto fixo, sem PII (nome/telefone/email/link/notes/horario)", async () => {
    process.env.MOBILE_PUSH_ENABLED = "true";
    const calls = { n: 0 };
    const sink: Sent = [];
    _setExpoClient(fake(calls, sink));
    const T = new Date(Date.now() + 3 * 24 * 3600_000);
    await mk(T);
    await sweepAt(new Date(T.getTime() - 60 * MIN));
    expect(calls.n).toBe(1);
    expect(sink[0].title).toBe(reminderTitle(60));
    expect(sink[0].body).toBe(REMINDER_BODY);
    const wire = JSON.stringify(sink) + JSON.stringify((await remAlerts()).map((a) => ({ ...a, dedupeKey: "" }))); // dedupeKey so guarda ids/epoch (interno)
    for (const x of ["Maria", "Zzreuniao", "Silva", fx.phone, fx.phone.slice(1), "@x.test", "zzsecret", "sala-xyz", NOTES, T.toISOString()]) expect(wire.includes(x), x).toBe(false);
    expect(JSON.stringify(sink)).not.toContain(String(T.getTime()));
    expect(JSON.stringify(sink)).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("teto de 10 pushes por varredura e resto so no sino", async () => {
    process.env.MOBILE_PUSH_ENABLED = "true";
    const calls = { n: 0 };
    _setExpoClient(fake(calls));
    const T = new Date(Date.now() + 3 * 24 * 3600_000);
    for (let i = 0; i < 13; i++) await mk(new Date(T.getTime() + i * 60_000));
    await sweepAt(new Date(T.getTime() - 60 * MIN));
    expect((await remAlerts()).length).toBe(13);
    expect(calls.n).toBeLessThanOrEqual(10);
    expect(calls.n).toBeGreaterThan(0);
  });
});
