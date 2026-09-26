import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { signInAsSeedAdmin } from "@/lib/auth/test-helpers";
import { seed, SEED_IDS } from "../../../prisma/seed";
import {
  buildWeeklySeries,
  computeTrend,
  getDashboardData,
  getPeriodRanges,
  parseDashboardParams,
} from "./dashboard";

describe("funções puras", () => {
  it("trend: divisão por zero -> percent null", () => {
    expect(computeTrend(5, 0)).toEqual({ percent: null, direction: "up" });
    expect(computeTrend(0, 0)).toEqual({ percent: null, direction: "flat" });
    expect(computeTrend(15, 10)).toEqual({ percent: 50, direction: "up" });
    expect(computeTrend(5, 10)).toEqual({ percent: -50, direction: "down" });
  });
  it("params: inválidos caem no default", () => {
    expect(parseDashboardParams({ period: "x", campaignId: "nao-uuid" })).toEqual({ period: "7d" });
    expect(parseDashboardParams({ period: ["30d"], campaignId: SEED_IDS.campaign })).toEqual({
      period: "30d",
      campaignId: SEED_IDS.campaign,
    });
  });
  it("períodos têm mesma duração e são contíguos", () => {
    const r = getPeriodRanges(new Date("2026-09-19T12:00:00"), "7d");
    expect(r.previous.to).toEqual(r.current.from);
    expect(r.current.to.getTime() - r.current.from.getTime()).toBe(
      r.current.from.getTime() - r.previous.from.getTime(),
    );
  });
  it("série semanal tem 7 dias", () => {
    const now = new Date("2026-09-19T12:00:00");
    const s = buildWeeklySeries(now, [{ createdAt: now, kind: "inbound" }]);
    expect(s).toHaveLength(7);
    expect(s[6].replies).toBe(1);
  });
});

describe("getDashboardData (seed)", () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const marker = "dashboard-test";
  beforeAll(async () => {
    await seed(prisma);
    await signInAsSeedAdmin();
    const lead = await prisma.lead.findFirstOrThrow({ where: { campaignId: SEED_IDS.campaign } });
    await prisma.touch.createMany({
      data: [
        { leadId: lead.id, channel: "email", direction: "outbound", status: "sent", content: marker },
        { leadId: lead.id, channel: "email", direction: "inbound", status: "delivered", content: marker },
      ],
    });
  }, 30000);
  afterAll(async () => {
    await prisma.touch.deleteMany({ where: { content: marker } });
    await prisma.$disconnect();
  });

  it("valores conferem com contagens diretas", async () => {
    const now = new Date();
    const { current } = getPeriodRanges(now, "7d");
    const range = { gte: current.from, lt: current.to };
    const data = await getDashboardData({ period: "7d" }, now);
    expect(data.metrics.newLeads.value).toBe(await prisma.lead.count({ where: { createdAt: range } }));
    expect(data.metrics.replies.value).toBe(
      await prisma.touch.count({ where: { direction: "inbound", createdAt: range } }),
    );
    const raw = await prisma.$queryRaw<{ n: bigint }[]>`
      select count(*) n from "StageHistory" where "toStage" = 'em_followup'
      and "changedAt" >= ${current.from} and "changedAt" < ${current.to}`;
    expect(data.metrics.followUp.value).toBe(Number(raw[0].n));
    expect(data.metrics.replies.value).toBeGreaterThanOrEqual(1);
    const d30 = await getDashboardData({ period: "30d" }, now);
    const r30 = getPeriodRanges(now, "30d").current;
    expect(d30.metrics.meetings.value).toBe(
      await prisma.meeting.count({ where: { status: { not: "cancelled" }, createdAt: { gte: r30.from, lt: r30.to } } }),
    );
    expect(d30.metrics.followUp.value).toBeGreaterThanOrEqual(3);
    expect(d30.activities.some((a) => a.kind === "stage_change")).toBe(true);
    expect(data.weekly).toHaveLength(7);
    expect(data.weekly.reduce((a, p) => a + p.newLeads, 0)).toBe(data.metrics.newLeads.value);
    expect(data.activities.length).toBeLessThanOrEqual(10);
    expect(data.activities.some((a) => a.kind === "touch_inbound")).toBe(true);
  }, 30000);

  it("filtro por campanha altera blocos", async () => {
    const other = await getDashboardData({
      period: "7d",
      campaignId: "00000000-0000-4000-8000-0000000000ff",
    });
    expect(other.isEmpty).toBe(true);
    expect(other.metrics.newLeads.value).toBe(0);
    expect(other.weekly.every((p) => p.newLeads === 0 && p.replies === 0)).toBe(true);
    expect(other.activities).toHaveLength(0);
  }, 30000);
});
