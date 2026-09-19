import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { seed } from "./seed";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
afterAll(() => prisma.$disconnect());

describe("seed", () => {
  it("é idempotente", async () => {
    await seed(prisma);
    const count = async () => [
      await prisma.user.count(), await prisma.lead.count(), await prisma.opportunity.count(),
      await prisma.sequenceStep.count(), await prisma.messageTemplate.count(),
      await prisma.touch.count({ where: { content: { not: "dashboard-test" } } }),
      await prisma.meeting.count(), await prisma.stageHistory.count(),
    ];
    const a = await count();
    await seed(prisma);
    expect(await count()).toEqual(a);
    expect(a[1]).toBe(20);
    const days = (await prisma.sequenceStep.findMany({ orderBy: { order: "asc" } })).map((s) => s.day);
    expect(days).toEqual([0, 2, 5, 7, 10]);
    expect(a[5]).toBeGreaterThan(0);
    expect(a[6]).toBe(3);
    expect(a[7]).toBeGreaterThan(20);
  }, 30000);

  it("leads que responderam têm inbound, repliedAt e sequência pausada", async () => {
    await seed(prisma);
    const leads = await prisma.lead.findMany({ where: { repliedAt: { not: null } } });
    expect(leads.length).toBe(6);
    for (const l of leads) {
      expect(l.sequenceStatus).toBe("paused_replied");
      const inbound = await prisma.touch.count({ where: { leadId: l.id, direction: "inbound" } });
      expect(inbound).toBe(1);
    }
    const now = Date.now();
    const touches = await prisma.touch.findMany({ where: { sentAt: { not: null } } });
    expect(touches.every((t) => t.sentAt!.getTime() <= now)).toBe(true);
  }, 30000);

  it("histórico de stage termina no stage atual e começa em novo_lead", async () => {
    const opps = await prisma.opportunity.findMany({
      include: { stageHistory: { orderBy: { changedAt: "asc" } } },
    });
    expect(opps.length).toBe(20);
    for (const o of opps) {
      const h = o.stageHistory;
      expect(h[0].fromStage).toBeNull();
      expect(h[0].toStage).toBe("novo_lead");
      expect(h[h.length - 1].toStage).toBe(o.stage);
      h.slice(1).forEach((x, i) => expect(x.fromStage).toBe(h[i].toStage));
    }
  }, 30000);
});
