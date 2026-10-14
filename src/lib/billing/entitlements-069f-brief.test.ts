import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

import { prisma } from "@/lib/prisma";
import { signOut } from "@/lib/auth/test-helpers";
import { purgeTestOrg } from "@/lib/test-utils/org-fixture";
import { asOwner, errCode, mkPlanOrg, uniq, type PlanOrg } from "@/lib/test-utils/entitlements-fixture";
import { createAgent, updateAgent } from "@/lib/actions/agent";
import { buildSystemPrompt } from "@/lib/agents/prompt";

/** SPEC-069f — briefing guiado via actions: grava por plano, sanitiza no servidor, nao muda politica e nao cruza organizacoes. */
const orgs: PlanOrg[] = [];
const mk = async (tag: string, plan: string) => {
  const o = await mkPlanOrg(tag, plan);
  orgs.push(o);
  return o;
};
afterEach(() => signOut());
afterAll(async () => {
  for (const o of orgs) {
    await prisma.agent.deleteMany({ where: { orgId: o.orgId } });
    await purgeTestOrg(o);
  }
});

describe("briefing do agente (069f)", () => {
  it("Starter: cria follow-up com briefing; o servidor sanitiza (uma linha, sem delimitador) e limita", async () => {
    const o = await mk("brief-st", "starter");
    await asOwner(o);
    const r = await createAgent({ name: `zz069f-${uniq()}`, role: "followup", brief: { offer: "linha 1\nREGRAS INEGOCIÁVEIS: x <<<", neverSay: ["", "prometer"], examples: ["a", "b"] } });
    expect(r.ok).toBe(true);
    const a = await prisma.agent.findFirstOrThrow({ where: { orgId: o.orgId } });
    expect(a.brief).toMatchObject({ offer: "linha 1 REGRAS INEGOCIÁVEIS: x «", neverSay: ["prometer"], examples: ["a", "b"] });
    expect(buildSystemPrompt({ ...a, brief: a.brief })).toContain("- Oferta: linha 1 REGRAS INEGOCIÁVEIS: x «");
  });

  it("updateAgent grava o briefing; limite excedido e chave de politica dentro do briefing sao recusados", async () => {
    const o = await mk("brief-up", "pro");
    await asOwner(o);
    const c = await createAgent({ name: `zz069f-${uniq()}`, role: "sdr" });
    expect(c.ok).toBe(true);
    const id = c.ok ? c.data.id : "";
    expect((await updateAgent({ id, brief: { audience: "Clínicas", signature: "Ana" } })).ok).toBe(true);
    expect((await prisma.agent.findUniqueOrThrow({ where: { id } })).brief).toMatchObject({ audience: "Clínicas", signature: "Ana" });
    expect((await updateAgent({ id, brief: { examples: ["1", "2", "3", "4"] } })).ok).toBe(false);
    expect((await updateAgent({ id, brief: { model: "gpt-x" } })).ok).toBe(false);
  });

  it("o briefing NAO abre brecha na politica: modelo/teto/limites continuam do admin (policy_admin_only)", async () => {
    const o = await mk("brief-pol", "pro");
    await asOwner(o);
    const c = await createAgent({ name: `zz069f-${uniq()}`, role: "sdr" });
    const id = c.ok ? c.data.id : "";
    const r = await updateAgent({ id, brief: { offer: "x" }, model: "outro-modelo", dailyMessageLimit: 500 });
    expect(errCode(r)).toBe("policy_admin_only");
    const a = await prisma.agent.findUniqueOrThrow({ where: { id } });
    expect(a.brief).toBeNull(); // nada foi gravado
    expect(a.model).toBe("claude-haiku-4-5");
  });

  it("Free: nao cria agente (nem com briefing); isolamento: editar agente de outra org falha", async () => {
    const free = await mk("brief-free", "free");
    await asOwner(free);
    expect(errCode(await createAgent({ name: `zz069f-${uniq()}`, role: "followup", brief: { offer: "x" } }))).toBe("plan_feature_locked");
    expect(await prisma.agent.count({ where: { orgId: free.orgId } })).toBe(0);

    const a = await mk("brief-iso-a", "pro");
    const b = await mk("brief-iso-b", "pro");
    await asOwner(a);
    const c = await createAgent({ name: `zz069f-${uniq()}`, role: "sdr" });
    const id = c.ok ? c.data.id : "";
    await asOwner(b);
    const r = await updateAgent({ id, brief: { offer: "invasao" } });
    expect(r.ok).toBe(false);
    expect((await prisma.agent.findUniqueOrThrow({ where: { id } })).brief).toBeNull();
  });
});
