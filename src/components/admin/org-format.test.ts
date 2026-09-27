import { describe, expect, it } from "vitest";
import { OrgStatus, SubscriptionStatus } from "@prisma/client";
import { ORG_STATUS_COLORS, ORG_STATUS_LABELS, SUBSCRIPTION_STATUS_LABELS, buildOrgsQuery } from "./org-format";

describe("org-format (SPEC-032)", () => {
  it("cobre os 3 OrgStatus com label PT-BR e cor hex", () => {
    for (const s of Object.values(OrgStatus)) {
      expect(ORG_STATUS_LABELS[s]).toBeTruthy();
      /** SPEC-037 (correção QA): valor é `var(--org-*)`, não hex literal. */
      expect(ORG_STATUS_COLORS[s]).toMatch(/^var\(--org-[\w-]+\)$/);
    }
    expect(Object.keys(ORG_STATUS_LABELS)).toHaveLength(3);
  });

  it("cobre os 5 SubscriptionStatus com label PT-BR", () => {
    for (const s of Object.values(SubscriptionStatus)) expect(SUBSCRIPTION_STATUS_LABELS[s]).toBeTruthy();
    expect(Object.keys(SUBSCRIPTION_STATUS_LABELS)).toHaveLength(5);
  });

  it("buildOrgsQuery: vazio -> string vazia", () => {
    expect(buildOrgsQuery({})).toBe("");
  });

  it("buildOrgsQuery: preserva q/status existentes e aplica overrides (ex.: nova página)", () => {
    const q = buildOrgsQuery({ q: "acme", status: "suspended", page: "2" }, { page: 3 });
    expect(q).toContain("q=acme");
    expect(q).toContain("status=suspended");
    expect(q).toContain("page=3");
    expect(q).not.toContain("page=2");
  });

  it("buildOrgsQuery: override null remove a chave", () => {
    const q = buildOrgsQuery({ status: "active" }, { status: null });
    expect(q).toBe("");
  });

  it("buildOrgsQuery: ignora valores vazios/espaços", () => {
    expect(buildOrgsQuery({ q: "   ", status: "" })).toBe("");
  });
});
