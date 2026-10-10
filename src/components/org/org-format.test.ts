// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { filterOrganizations, orgInitials, applyServerErrors, countOwners, formatDate, joinCodeState, joinCodeSummary, parseJoinInput, roleLabel, safeInternalPath } from "./org-format";
import { confirmCopy } from "./TeamPanel";
import { inviteSignupFormSchema, joinCodeFormSchema, signupJoinFormSchema } from "@/lib/schemas/org";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/org", () => ({ changeMemberRole: vi.fn(), disableJoinCode: vi.fn(), removeMember: vi.fn(), revokeInvite: vi.fn(), inviteMember: vi.fn(), generateJoinCode: vi.fn() }));

describe("org-format (SPEC-049b)", () => {
  it("parseJoinInput: link de convite vira token; resto é código", () => {
    expect(parseJoinInput("https://app.x.com/convite/abc123_-XYZ?utm=1")).toEqual({ kind: "token", token: "abc123_-XYZ" });
    expect(parseJoinInput("  /convite/tok%2Bn ")).toEqual({ kind: "token", token: "tok+n" });
    expect(parseJoinInput(" ABCD-EFGH-JKLM ")).toEqual({ kind: "code", code: "ABCD-EFGH-JKLM" });
  });
  it("safeInternalPath bloqueia open redirect", () => {
    expect(safeInternalPath("/convite/x")).toBe("/convite/x");
    expect(safeInternalPath("//evil.com")).toBe("/dashboard");
    expect(safeInternalPath("https://evil.com")).toBe("/dashboard");
    expect(safeInternalPath(null)).toBe("/dashboard");
  });
  it("papéis, owners e estado do código", () => {
    expect(roleLabel("owner")).toBe("Proprietário");
    expect(countOwners([{ orgRole: "owner" }, { orgRole: "member" }, { orgRole: "owner" }])).toBe(2);
    expect(joinCodeState({ expiresAt: null, maxUses: 10, uses: 0, expired: true, exhausted: false })).toBe("expired");
    expect(joinCodeState({ expiresAt: null, maxUses: 10, uses: 10, expired: false, exhausted: true })).toBe("exhausted");
    expect(joinCodeState({ expiresAt: null, maxUses: 10, uses: 1, expired: false, exhausted: false })).toBe("active");
    expect(joinCodeSummary({ expiresAt: new Date("2026-10-20T15:00:00Z"), maxUses: 10, uses: 3, expired: false, exhausted: false })).toBe("3 de 10 usos · expira em 20/10/2026");
    expect(formatDate(null)).toBe("—");
  });
  it("confirmCopy cobre cada ação e é destrutivo onde deve", () => {
    const member = { userId: "u", name: "Ana", email: "a@x.com", orgRole: "member" as const, joinedAt: new Date(), isSelf: false };
    expect(confirmCopy({ kind: "remove", member }).destructive).toBe(true);
    expect(confirmCopy({ kind: "promote", member }).destructive).toBe(false);
    expect(confirmCopy({ kind: "demote", member: { ...member, isSelf: true } }).description).toContain("Você perde");
    expect(confirmCopy({ kind: "disable-code" }).confirmLabel).toBe("Desativar código");
  });
  it("applyServerErrors: _form e campos desconhecidos vão para root; foco no 1º campo", () => {
    const setError = vi.fn();
    const setFocus = vi.fn();
    const msg = applyServerErrors({ _form: ["Falhou."], email: ["E-mail inválido."], zzz: ["Outro."] }, setError, setFocus, ["email", "name"]);
    expect(setError).toHaveBeenCalledWith("email", { type: "server", message: "E-mail inválido." });
    expect(setError).toHaveBeenCalledWith("root", { type: "server", message: "Falhou. Outro." });
    expect(setFocus).toHaveBeenCalledWith("email");
    expect(msg).toBe("Falhou.");
  });
  it("schemas de formulário (zod) validam o que a UI envia", () => {
    expect(signupJoinFormSchema.safeParse({ name: "A", email: "A@X.com", password: "123456789012", joinInput: " COD " }).data?.email).toBe("a@x.com");
    expect(signupJoinFormSchema.safeParse({ name: "A", email: "a@x.com", password: "curta", joinInput: "x" }).success).toBe(false);
    expect(inviteSignupFormSchema.safeParse({ name: "", password: "123456789012" }).success).toBe(false);
    expect(joinCodeFormSchema.safeParse({ expiresInDays: "7", maxUses: "10" }).data).toEqual({ expiresInDays: 7, maxUses: 10 });
    expect(joinCodeFormSchema.safeParse({ expiresInDays: "31", maxUses: "10" }).success).toBe(false);
    expect(joinCodeFormSchema.safeParse({ expiresInDays: "7", maxUses: "0" }).success).toBe(false);
  });
});

describe("filterOrganizations / orgInitials (SPEC-049b, D-049-16)", () => {
  const list = [{ name: "Coest Studio" }, { name: "Thiago's Account" }, { name: "Ação Ltda" }];
  it("vazio devolve tudo", () => {
    expect(filterOrganizations(list, "  ")).toHaveLength(3);
  });
  it("case e acento-insensitive", () => {
    expect(filterOrganizations(list, "COEST").map((o) => o.name)).toEqual(["Coest Studio"]);
    expect(filterOrganizations(list, "acao").map((o) => o.name)).toEqual(["Ação Ltda"]);
    expect(filterOrganizations(list, "açã").map((o) => o.name)).toEqual(["Ação Ltda"]);
  });
  it("sem resultado", () => {
    expect(filterOrganizations(list, "zzz")).toEqual([]);
  });
  it("iniciais", () => {
    expect(orgInitials("Coest Studio")).toBe("CS");
    expect(orgInitials("acme")).toBe("AC");
    expect(orgInitials("")).toBe("?");
  });
});
