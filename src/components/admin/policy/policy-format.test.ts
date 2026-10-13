import { describe, expect, it } from "vitest";
import { auditFields, centsToReaisInput, draftToPayload, emptyOverrideMessage, formatBRL, isEmptyOverrideDraft, overrideToDraft, reaisToCents } from "./policy-format";

const catalog = { features: [{ key: "sources.ads", label: "Ads" }, { key: "llm.byok", label: "BYOK" }, { key: "ingest.api", label: "API" }], limits: [{ key: "maxMembers", label: "Membros" }, { key: "maxCampaigns", label: "Campanhas" }, { key: "maxCreativesPerMonth", label: "Criativos" }] };

describe("policy-format (SPEC-069c)", () => {
  it("sem override: tudo segue o plano e o payload só tem o que foge dele", () => {
    const d = overrideToDraft({ override: null, catalog });
    expect(Object.values(d.features).every((m) => m === "plan")).toBe(true);
    expect(draftToPayload("o1", { ...d, reason: "motivo ok" })).toEqual({ orgId: "o1", reason: "motivo ok", features: {}, limits: {}, expiresAt: "" });
  });

  it("override existente vira rascunho e volta ao mesmo payload (estado completo)", () => {
    const d = overrideToDraft({ override: { features: { "sources.ads": true, "llm.byok": false }, limits: { maxMembers: 10, maxCampaigns: null }, reason: "piloto", expiresAt: "2030-01-31T23:59:59.999Z", createdBy: "a", updatedAt: "x" }, catalog });
    expect(d.features).toEqual({ "sources.ads": "on", "llm.byok": "off", "ingest.api": "plan" });
    expect(d.limits.maxMembers).toEqual({ mode: "value", value: "10" });
    expect(d.limits.maxCampaigns.mode).toBe("unlimited");
    expect(d.limits.maxCreativesPerMonth.mode).toBe("plan");
    expect(d.expiresAt).toBe("2030-01-31");
    expect(draftToPayload("o1", { ...d, reason: "r" })).toEqual({ orgId: "o1", reason: "r", features: { "sources.ads": true, "llm.byok": false }, limits: { maxMembers: 10, maxCampaigns: null }, expiresAt: "2030-01-31" });
  });

  it("limite em modo valor vazio vira NaN (servidor recusa); 0 é válido", () => {
    const d = overrideToDraft({ override: null, catalog });
    d.limits.maxMembers = { mode: "value", value: "" };
    d.limits.maxCampaigns = { mode: "value", value: "0" };
    const p = draftToPayload("o", d);
    expect(Number.isNaN(p.limits.maxMembers)).toBe(true);
    expect(p.limits.maxCampaigns).toBe(0);
  });

  it("reais <-> centavos", () => {
    expect(reaisToCents("50")).toBe(5000);
    expect(reaisToCents("12,50")).toBe(1250);
    expect(reaisToCents("R$ 0.5")).toBe(50);
    expect(reaisToCents("  ")).toBeNull();
    expect(Number.isNaN(reaisToCents("abc") as number)).toBe(true);
    expect(Number.isNaN(reaisToCents("-3") as number)).toBe(true);
    expect(centsToReaisInput(1250)).toBe("12,50");
    expect(centsToReaisInput(null)).toBe("");
    expect(formatBRL(5000)).toContain("50,00");
  });

  it("auditFields só lê nomes de campos do meta", () => {
    expect(auditFields({ area: "x", fields: ["llm", "rotate", 3] })).toEqual(["llm", "rotate"]);
    expect(auditFields(null)).toEqual([]);
    expect(auditFields({ fields: "x" })).toEqual([]);
  });

  it("B2 (QA 069c): tudo em 'Seguir plano' e vazio (bloqueia no cliente e orienta 'Remover override')", () => {
    const d = overrideToDraft({ override: null, catalog });
    expect(isEmptyOverrideDraft(d)).toBe(true);
    expect(emptyOverrideMessage(true)).toMatch(/Remover override/);
    expect(emptyOverrideMessage(false)).not.toMatch(/Remover override/);
    d.features["sources.ads"] = "on";
    expect(isEmptyOverrideDraft(d)).toBe(false);
    d.features["sources.ads"] = "plan";
    d.limits.maxMembers = { mode: "value", value: "0" };
    expect(isEmptyOverrideDraft(d)).toBe(false);
  });
});
