import { describe, expect, it } from "vitest";
import { stripCallLink } from "./guardrails";
import { repliedOrEnded } from "@/lib/channels/reserve";
import { updateAgentSchema, agentFieldsSchema } from "@/lib/schemas/agent";

const L = "https://cal.com/acme/call";
const T = new Date("2026-01-01T00:00:00Z");

describe("QA SPEC-019", () => {
  it("F1: Closer ignora replied/paused_replied mas NAO paused_manual", () => {
    const replied = { repliedAt: new Date("2026-02-01"), sequenceStatus: "paused_replied" };
    expect(repliedOrEnded(replied, T)).toBe(true);
    expect(repliedOrEnded(replied, T, true)).toBe(false);
    expect(repliedOrEnded({ repliedAt: null, sequenceStatus: "paused_manual" }, T, true)).toBe(true);
    expect(repliedOrEnded({ repliedAt: null, sequenceStatus: "opted_out" }, T, true)).toBe(true);
  });
  it("F7: update parcial nao aplica defaults", () => {
    const p = updateAgentSchema.parse({ id: "7f9c2a5e-1b3d-4c8e-9a6f-2d4e6b8a0c1d", name: "X" });
    expect(Object.keys(p).sort()).toEqual(["id", "name"]);
    expect(agentFieldsSchema.parse({ name: "X" }).samplePercent).toBe(20);
  });
  it("F9: rejeita credenciais na URL e strip so remove o link exato", () => {
    expect(agentFieldsSchema.safeParse({ name: "X", callLink: "https://u:p@cal.com/x" }).success).toBe(false);
    expect(agentFieldsSchema.safeParse({ name: "X", callLink: L }).success).toBe(true);
    expect(stripCallLink(`Agende: ${L}.`, L)).not.toContain("cal.com");
    expect(stripCallLink(`Veja ${L}/evil`, L)).toContain("cal.com");
    expect(stripCallLink(`Veja ${L}.evil.com`, L)).toContain("cal.com");
  });
});
