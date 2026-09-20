import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ agentRun: vi.fn(), lead: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { agentRun: { findFirst: m.agentRun }, lead: { findUnique: m.lead } } }));

import { isCloserTouch, leadStopped, repliedOrEnded } from "./reserve";
import { buildSystemPrompt } from "@/lib/agents/prompt";
import { createAgentSchema } from "@/lib/schemas/agent";

const replied = { repliedAt: new Date(2030, 0, 2), sequenceStatus: "paused_replied", optedOutAt: null };
const created = new Date(2030, 0, 1);
beforeEach(() => { m.agentRun.mockReset(); m.lead.mockReset(); });

describe("excecao Closer a repliedOrEnded (SPEC-017/019)", () => {
  it("Touch nao agentGenerated nunca e Closer (sem consultar o banco)", async () => {
    expect(await isCloserTouch({ id: "t", agentGenerated: false })).toBe(false);
    expect(m.agentRun).not.toHaveBeenCalled();
  });
  it("agentGenerated cujo AgentRun e de agente closer -> bypass; SDR/Follow-up -> continua bloqueado", async () => {
    m.agentRun.mockResolvedValueOnce({ id: "r" });
    expect(await isCloserTouch({ id: "t", agentGenerated: true })).toBe(true);
    expect(m.agentRun.mock.calls[0][0].where).toEqual({ touchId: "t", agent: { role: "closer" } });
    m.agentRun.mockResolvedValueOnce(null); // SDR/followup: nenhum run de closer
    expect(await isCloserTouch({ id: "t2", agentGenerated: true })).toBe(false);
    expect(repliedOrEnded(replied, created)).toBe(true);
    m.lead.mockResolvedValue(replied);
    expect(await leadStopped("l", created, false)).toBe(true);
  });
  it("Closer ignora so 'respondeu'; opt-out e sequencia concluida ainda bloqueiam", async () => {
    m.lead.mockResolvedValue(replied);
    expect(await leadStopped("l", created, true)).toBe(false);
    m.lead.mockResolvedValue({ ...replied, optedOutAt: new Date() });
    expect(await leadStopped("l", created, true)).toBe(true);
    m.lead.mockResolvedValue({ ...replied, sequenceStatus: "opted_out" });
    expect(await leadStopped("l", created, true)).toBe(true);
    m.lead.mockResolvedValue({ ...replied, sequenceStatus: "completed" });
    expect(await leadStopped("l", created, true)).toBe(true);
    m.lead.mockResolvedValue(null);
    expect(await leadStopped("l", created, true)).toBe(true);
  });
  it("estatico: nos canais o bypass so afeta repliedOrEnded; supressao vem depois e continua bloqueando o Closer", () => {
    for (const f of ["email.ts", "whatsapp.ts"]) {
      const src = readFileSync(path.join(__dirname, f), "utf8");
      expect(src.indexOf("repliedOrEnded(lead, touch.createdAt, closerBypass)")).toBeGreaterThan(-1);
      expect(src.indexOf("repliedOrEnded(lead, touch.createdAt, closerBypass)")).toBeLessThan(src.indexOf('findSuppression({ email: lead.email, phone: lead.phone })'));
      expect(src).toContain("leadStopped(lead.id, touch.createdAt, closerBypass)");
      expect(src).toMatch(/if \(lead\.optedOutAt \|\| lead\.sequenceStatus === "opted_out"\)/);
    }
  });
});

describe("callLink do Closer", () => {
  const base = { role: "closer" as const, name: "C" };
  it("valida https", () => {
    expect(createAgentSchema.safeParse({ ...base, callLink: "https://cal.com/x" }).success).toBe(true);
    expect(createAgentSchema.safeParse({ ...base, callLink: "http://cal.com/x" }).success).toBe(false);
    expect(createAgentSchema.safeParse({ ...base, callLink: "javascript:alert(1)" }).success).toBe(false);
    expect(createAgentSchema.safeParse({ ...base, callLink: "cal.com/x" }).success).toBe(false);
  });
  it("prompt so inclui o link no Closer", () => {
    const a = { persona: "", objective: "", tone: "", allowedTools: [], callLink: "https://cal.com/x" };
    expect(buildSystemPrompt({ ...a, role: "closer" })).toContain("https://cal.com/x");
    expect(buildSystemPrompt({ ...a, role: "sdr" })).not.toContain("https://cal.com/x");
  });
});
