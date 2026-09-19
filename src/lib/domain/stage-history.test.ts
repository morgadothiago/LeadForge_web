import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { seed } from "../../../prisma/seed";
import { recordStageChange } from "./stage-history";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
afterAll(() => prisma.$disconnect());

describe("recordStageChange", () => {
  it("registra transição na transação e ignora from === to", async () => {
    await seed(prisma);
    const opp = await prisma.opportunity.findFirstOrThrow({ where: { stage: "novo_lead" } });
    const before = await prisma.stageHistory.count({ where: { opportunityId: opp.id } });
    await expect(
      prisma.$transaction(async (tx) => {
        await recordStageChange(tx, opp.id, "novo_lead", "contactado");
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await prisma.stageHistory.count({ where: { opportunityId: opp.id } })).toBe(before);
    expect(await recordStageChange(prisma, opp.id, "novo_lead", "novo_lead")).toBeNull();
    const h = await recordStageChange(prisma, opp.id, "novo_lead", "contactado");
    expect(h?.toStage).toBe("contactado");
    await prisma.stageHistory.delete({ where: { id: h!.id } });
  }, 30000);
});
