import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { mkMeetingFixture, type MeetingFixture } from "@/lib/test-utils/meeting-fixture";
import { createMeeting, transitionMeeting, updateMeeting, validateSchedule, endsAtOf, CANCEL_STAGE_WARNING } from "./meeting";

const NOW = new Date("2026-10-01T12:00:00Z");
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
let fx: MeetingFixture;

beforeAll(async () => {
  fx = await mkMeetingFixture("zz-test-mdomain");
});
afterAll(async () => {
  await fx.cleanup();
  await prisma.$disconnect();
});

describe("validateSchedule (puro)", () => {
  const ok = { startsAt: at(60), durationMin: 30 };
  it("aceita valido", () => expect(validateSchedule(ok, NOW, true)).toBeNull());
  it("duracao 5..480", () => {
    expect(validateSchedule({ ...ok, durationMin: 4 }, NOW, true)).toMatchObject({ field: "durationMin" });
    expect(validateSchedule({ ...ok, durationMin: 481 }, NOW, true)).toMatchObject({ field: "durationMin" });
    expect(validateSchedule({ ...ok, durationMin: 5 }, NOW, true)).toBeNull();
    expect(validateSchedule({ ...ok, durationMin: 480 }, NOW, true)).toBeNull();
    expect(validateSchedule({ ...ok, durationMin: 30.5 }, NOW, true)).toMatchObject({ field: "durationMin" });
  });
  it("fim > inicio", () => expect(endsAtOf(ok.startsAt, 5).getTime()).toBeGreaterThan(ok.startsAt.getTime()));
  it("link so https", () => {
    expect(validateSchedule({ ...ok, link: "http://x.test/a" }, NOW, true)).toMatchObject({ field: "link" });
    expect(validateSchedule({ ...ok, link: "javascript:alert(1)" }, NOW, true)).toMatchObject({ field: "link" });
    expect(validateSchedule({ ...ok, link: "https://meet.test/a" }, NOW, true)).toBeNull();
  });
  it("passado so recusado quando exigido futuro; fuso invalido", () => {
    expect(validateSchedule({ ...ok, startsAt: at(-5) }, NOW, true)).toMatchObject({ field: "startsAt" });
    expect(validateSchedule({ ...ok, startsAt: at(-5) }, NOW, false)).toBeNull();
    expect(validateSchedule({ ...ok, timezone: "Marte/Olimpo" }, NOW, true)).toMatchObject({ field: "timezone" });
    expect(validateSchedule({ ...ok, timezone: "Asia/Tokyo" }, NOW, true)).toBeNull();
  });
});

describe("dominio de reunioes (banco)", () => {
  it("criar move a oportunidade para reuniao_agendada com StageHistory; endsAt = start + duracao", async () => {
    const r = await createMeeting({ opportunityId: fx.oppId, startsAt: at(600), durationMin: 45, createdById: fx.userId, now: NOW });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.stageMoved).toBe(true);
    expect(r.meeting.endsAt.getTime() - r.meeting.startsAt.getTime()).toBe(45 * 60_000);
    expect(r.meeting.campaignId).toBe(fx.campId);
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: fx.oppId } })).stage).toBe("reuniao_agendada");
    expect(await prisma.stageHistory.count({ where: { opportunityId: fx.oppId, toStage: "reuniao_agendada" } })).toBe(1);
    // segunda reuniao: stage ja correto, sem novo historico
    const r2 = await createMeeting({ opportunityId: fx.oppId, startsAt: at(2000), durationMin: 30, now: NOW });
    expect(r2.status === "ok" && r2.stageMoved).toBe(false);
    expect(await prisma.stageHistory.count({ where: { opportunityId: fx.oppId, toStage: "reuniao_agendada" } })).toBe(1);
  });

  it("recusa passado e oportunidade inexistente; nada e gravado", async () => {
    const before = await prisma.meeting.count();
    expect(await createMeeting({ opportunityId: fx.oppId, startsAt: at(-1), durationMin: 30, now: NOW })).toMatchObject({ status: "invalid", field: "startsAt" });
    expect(await createMeeting({ opportunityId: crypto.randomUUID(), startsAt: at(60), durationMin: 30, now: NOW })).toEqual({ status: "not_found" });
    expect(await prisma.meeting.count()).toBe(before);
  });

  it("sobreposicao e SO aviso (cria mesmo assim)", async () => {
    const a = await createMeeting({ opportunityId: fx.oppId, startsAt: at(3000), durationMin: 60, now: NOW });
    const b = await createMeeting({ opportunityId: fx.oppId, startsAt: at(3030), durationMin: 30, now: NOW });
    expect(a.status).toBe("ok");
    expect(b.status === "ok" && b.conflicts.map((c) => c.id)).toEqual([a.status === "ok" ? a.meeting.id : ""]);
    const c = await createMeeting({ opportunityId: fx.oppId, startsAt: at(3060), durationMin: 30, now: NOW }); // encosta no fim de a e no fim de b: sem conflito com a
    expect(c.status === "ok" && c.conflicts.some((x) => a.status === "ok" && x.id === a.meeting.id)).toBe(false);
  });

  it("externalId idempotente", async () => {
    const r1 = await createMeeting({ opportunityId: fx.oppId, startsAt: at(4000), durationMin: 30, externalId: "wh:abc", now: NOW });
    const r2 = await createMeeting({ opportunityId: fx.oppId, startsAt: at(4000), durationMin: 30, externalId: "wh:abc", now: NOW });
    expect(r1.status === "ok" && !r1.replay).toBe(true);
    expect(r2.status === "ok" && r2.replay).toBe(true);
    expect(r1.status === "ok" && r2.status === "ok" && r1.meeting.id === r2.meeting.id).toBe(true);
    expect(await prisma.meeting.count({ where: { externalId: "wh:abc" } })).toBe(1);
  });

  it("cancelar: nao move stage, retorna aviso, resolve lembretes pendentes; idempotente", async () => {
    const r = await createMeeting({ opportunityId: fx.oppId, startsAt: at(5000), durationMin: 30, now: NOW });
    if (r.status !== "ok") throw new Error("x");
    await prisma.mobileAlert.create({ data: { orgId: fx.orgId, kind: "meeting_reminder", severity: "media", dedupeKey: `meeting_reminder:${r.meeting.id}:1:60`, title: "t", body: "b", refType: "meeting", refId: r.meeting.id } });
    const c = await transitionMeeting(r.meeting.id, "cancel", NOW);
    expect(c.status === "ok" && c.meeting.status === "cancelled" && c.warning === CANCEL_STAGE_WARNING).toBe(true);
    expect(c.status === "ok" && c.meeting.cancelledAt).toBeTruthy();
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: fx.oppId } })).stage).toBe("reuniao_agendada");
    expect(await prisma.mobileAlert.count({ where: { refId: r.meeting.id, resolvedAt: null } })).toBe(0);
    expect((await transitionMeeting(r.meeting.id, "cancel", NOW)).status).toBe("ok");
    expect(await transitionMeeting(r.meeting.id, "done", NOW)).toMatchObject({ status: "invalid" }); // terminal
  });

  it("done e no_show a partir de agendada", async () => {
    const a = await createMeeting({ opportunityId: fx.oppId, startsAt: at(6000), durationMin: 30, now: NOW });
    const b = await createMeeting({ opportunityId: fx.oppId, startsAt: at(7000), durationMin: 30, now: NOW });
    if (a.status !== "ok" || b.status !== "ok") throw new Error("x");
    expect(await transitionMeeting(a.meeting.id, "done", NOW)).toMatchObject({ status: "ok", meeting: { status: "done" } });
    expect(await transitionMeeting(b.meeting.id, "no_show", NOW)).toMatchObject({ status: "ok", meeting: { status: "no_show" } });
    expect(await transitionMeeting(crypto.randomUUID(), "done", NOW)).toEqual({ status: "not_found" });
  });

  it("editar: reagendar exige futuro, atualiza endsAt e so vale para agendadas", async () => {
    const r = await createMeeting({ opportunityId: fx.oppId, startsAt: at(8000), durationMin: 30, now: NOW });
    if (r.status !== "ok") throw new Error("x");
    const u = await updateMeeting({ id: r.meeting.id, startsAt: at(9000), durationMin: 60, notes: "n", now: NOW });
    expect(u.status === "ok" && u.meeting.endsAt.getTime() - u.meeting.startsAt.getTime()).toBe(60 * 60_000);
    expect(await updateMeeting({ id: r.meeting.id, startsAt: at(-10), now: NOW })).toMatchObject({ status: "invalid", field: "startsAt" });
    expect(await updateMeeting({ id: r.meeting.id, link: "http://x.test", now: NOW })).toMatchObject({ status: "invalid", field: "link" });
    await transitionMeeting(r.meeting.id, "done", NOW);
    expect(await updateMeeting({ id: r.meeting.id, notes: "x", now: NOW })).toMatchObject({ status: "invalid" });
  });
});
