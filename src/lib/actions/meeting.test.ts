import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { signInAs, signOut } from "@/lib/auth/test-helpers";
import { mkMeetingFixture, type MeetingFixture } from "@/lib/test-utils/meeting-fixture";
import { cancelMeeting, createMeeting, getMeetingSettings, markMeetingDone, markMeetingNoShow, saveMeetingSettings, updateMeeting } from "./meeting";
import { listMeetings, searchLeadsForMeeting } from "@/lib/queries/meetings";
import { sweepAlerts, _resetSweepThrottle } from "@/lib/mobile/alerts";

let fx: MeetingFixture;
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

beforeAll(async () => {
  fx = await mkMeetingFixture("zz-test-mact");
  await signInAs(fx.userId);
});
afterAll(async () => {
  signOut();
  await fx.cleanup();
  await prisma.$disconnect();
});

describe("actions de reuniao", () => {
  it("sem sessao: erro PT-BR e nada gravado", async () => {
    signOut();
    const before = await prisma.meeting.count();
    for (const r of [await createMeeting({}), await updateMeeting({}), await cancelMeeting({}), await markMeetingDone({}), await markMeetingNoShow({}), await getMeetingSettings(), await saveMeetingSettings({})]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors._form[0]).toMatch(/Sessão expirada/);
    }
    await expect(listMeetings({ from: iso(0), to: iso(24) })).rejects.toThrow();
    expect(await prisma.meeting.count()).toBe(before);
    await signInAs(fx.userId);
  });

  it("zod: erros por campo em PT-BR", async () => {
    const r = await createMeeting({ opportunityId: "x", startsAt: "amanha", durationMin: 2, link: "http://a.test", timezone: "Marte/X" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["durationMin", "link", "opportunityId", "startsAt", "timezone"]);
    const past = await createMeeting({ opportunityId: fx.oppId, startsAt: iso(-1) });
    expect(!past.ok && past.errors.startsAt[0]).toMatch(/futuro/);
  });

  it("criar, clientRequestId evita duplo clique, conflito so avisa, stage move", async () => {
    const start = iso(72);
    const a = await createMeeting({ opportunityId: fx.oppId, startsAt: start, durationMin: 60, clientRequestId: "req-clique-1" });
    const b = await createMeeting({ opportunityId: fx.oppId, startsAt: start, durationMin: 60, clientRequestId: "req-clique-1" });
    expect(a.ok && b.ok && a.data.meeting.id === b.data.meeting.id).toBe(true);
    expect(await prisma.meeting.count({ where: { campaignId: fx.campId } })).toBe(1);
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: fx.oppId } })).stage).toBe("reuniao_agendada");
    const c = await createMeeting({ opportunityId: fx.oppId, startsAt: new Date(Date.parse(start) + 30 * 60_000).toISOString(), durationMin: 30 });
    expect(c.ok && c.data.conflicts).toHaveLength(1);
    expect(a.ok && a.data.meeting).toMatchObject({ status: "scheduled", durationMin: 60, timezone: "America/Sao_Paulo", source: "manual" });
    expect(await prisma.webhookEvent.count({ where: { source: "meeting" } })).toBeGreaterThan(0);
  });

  it("cancelar devolve aviso e nao move stage; editar; done/no_show", async () => {
    const m = await createMeeting({ opportunityId: fx.oppId, startsAt: iso(100), durationMin: 30 });
    if (!m.ok) throw new Error("x");
    const u = await updateMeeting({ id: m.data.meeting.id, durationMin: 90, notes: "  nota  ", link: "https://meet.test/a" });
    expect(u.ok && u.data.meeting).toMatchObject({ durationMin: 90, notes: "nota", link: "https://meet.test/a" });
    const c = await cancelMeeting({ id: m.data.meeting.id });
    expect(c.ok && c.data.warning).toMatch(/continua na etapa/);
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: fx.oppId } })).stage).toBe("reuniao_agendada");
    const d = await createMeeting({ opportunityId: fx.oppId, startsAt: iso(120), durationMin: 30 });
    const e = await createMeeting({ opportunityId: fx.oppId, startsAt: iso(140), durationMin: 30 });
    if (!d.ok || !e.ok) throw new Error("x");
    expect((await markMeetingDone({ id: d.data.meeting.id })).ok).toBe(true);
    expect((await markMeetingNoShow({ id: e.data.meeting.id })).ok).toBe(true);
    expect((await markMeetingDone({ id: e.data.meeting.id })).ok).toBe(false);
    expect((await cancelMeeting({ id: crypto.randomUUID() })).ok).toBe(false);
  });

  it("settings: ler padrao, salvar (ordena/dedup), recusar offset invalido; afeta a varredura", async () => {
    const def = await getMeetingSettings();
    expect(def.ok && def.data).toEqual({ remindersEnabled: true, offsetsMin: [1440, 60, 15] });
    const s = await saveMeetingSettings({ remindersEnabled: true, offsetsMin: [5, 120, 5, 1440] });
    expect(s.ok && s.data.offsetsMin).toEqual([1440, 120, 5]);
    expect((await saveMeetingSettings({ remindersEnabled: true, offsetsMin: [7] })).ok).toBe(false);
    expect((await saveMeetingSettings({ remindersEnabled: "sim", offsetsMin: [] })).ok).toBe(false);
    await saveMeetingSettings({ remindersEnabled: false, offsetsMin: [60] });
    await prisma.mobileAlert.deleteMany({ where: { kind: "meeting_reminder" } });
    _resetSweepThrottle();
    await sweepAlerts(new Date(Date.now() + 71 * 3600_000));
    expect(await prisma.mobileAlert.count({ where: { kind: "meeting_reminder", refId: { in: (await prisma.meeting.findMany({ where: { campaignId: fx.campId }, select: { id: true } })).map((x) => x.id) } } })).toBe(0);
  });
});

describe("queries de reuniao", () => {
  it("intervalo obrigatorio, teto de 62 dias, ordenado por startsAt, semiaberto; robusto a TZ do processo", async () => {
    const prevTz = process.env.TZ;
    try {
      for (const tz of ["UTC", "Asia/Tokyo"]) {
        process.env.TZ = tz;
        await prisma.meeting.deleteMany({ where: { campaignId: fx.campId } });
        const day = Date.UTC(2099, 5, 10, 3, 0, 0); // 2099-06-10 00:00 em Sao Paulo
        const mk = (ms: number) => prisma.meeting.create({ data: { opportunityId: fx.oppId, leadId: fx.leadId, campaignId: fx.campId, startsAt: new Date(ms), endsAt: new Date(ms + 1800_000) } });
        await mk(day - 30 * 60_000); // 23:30 do dia anterior (SP): fora
        const inFirst = await mk(day + 30 * 60_000); // 00:30
        const inLast = await mk(day + 24 * 3600_000 - 30 * 60_000); // 23:30
        await mk(day + 24 * 3600_000); // 00:00 do dia seguinte: fora (semiaberto)
        const r = await listMeetings({ from: new Date(day).toISOString(), to: new Date(day + 24 * 3600_000).toISOString() });
        expect(r.ok && r.items.map((i) => i.id)).toEqual([inFirst.id, inLast.id]);
        expect(r.ok && r.items[0]).toMatchObject({ leadName: "Maria Zzreuniao Silva", campaignName: "zz-test-mact", durationMin: 30 });
      }
    } finally {
      if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz;
    }
    expect((await listMeetings({ from: iso(0), to: iso(63 * 24) })).ok).toBe(false);
    expect((await listMeetings({ from: iso(0), to: iso(62 * 24) })).ok).toBe(true);
    expect((await listMeetings({ from: iso(10), to: iso(1) })).ok).toBe(false);
    expect((await listMeetings({ from: undefined, to: undefined })).ok).toBe(false);
    expect((await listMeetings({ from: "2099-01-01", to: "2099-01-02" })).ok).toBe(false); // sem fuso
  });

  it("busca de leads devolve a oportunidade; termo curto = vazio", async () => {
    const r = await searchLeadsForMeeting("zzreuniao");
    expect(r).toEqual([expect.objectContaining({ opportunityId: fx.oppId, leadId: fx.leadId, campaignName: "zz-test-mact" })]);
    expect(await searchLeadsForMeeting("z")).toEqual([]);
  });
});
