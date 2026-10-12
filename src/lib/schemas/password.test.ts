import { describe, expect, it } from "vitest";
import { signupSchema } from "./billing";
import { resetPasswordSchema, loginSchema } from "./auth";
import { signupJoinSchema, inviteSignupFormSchema } from "./org";

const base = { name: "Ana", email: "ana@x.com" };
const msgs = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) => r.error?.issues.map((i) => `${String(i.path[0])}:${i.message}`) ?? [];

describe("SPEC-064: regra unica de senha (min 6) + confirmacao", () => {
  it("6 caracteres passa; 5 falha com a mensagem unica; 256 passa e 257 falha", () => {
    expect(signupSchema.safeParse({ ...base, password: "abc123", confirmPassword: "abc123" }).success).toBe(true);
    expect(msgs(signupSchema.safeParse({ ...base, password: "abc12", confirmPassword: "abc12" }))).toContain("password:Senha deve ter ao menos 6 caracteres.");
    const big = "a".repeat(256);
    expect(signupSchema.safeParse({ ...base, password: big, confirmPassword: big }).success).toBe(true);
    expect(signupSchema.safeParse({ ...base, password: big + "a", confirmPassword: big + "a" }).success).toBe(false);
  });
  it("confirmacao diferente ou ausente falha em confirmPassword, em todos os schemas", () => {
    const diff = { password: "abc123", confirmPassword: "abc124" };
    expect(msgs(signupSchema.safeParse({ ...base, ...diff }))).toContain("confirmPassword:As senhas não coincidem.");
    expect(msgs(resetPasswordSchema.safeParse({ token: "t", ...diff }))).toContain("confirmPassword:As senhas não coincidem.");
    expect(msgs(signupJoinSchema.safeParse({ name: "A", token: "t", ...diff }))).toContain("confirmPassword:As senhas não coincidem.");
    expect(msgs(inviteSignupFormSchema.safeParse({ name: "A", ...diff }))).toContain("confirmPassword:As senhas não coincidem.");
    expect(signupSchema.safeParse({ ...base, password: "abc123" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: "t", password: "abc123" }).success).toBe(false);
  });
  it("a saida valida carrega confirmPassword (a action simplesmente nao o usa) e senha de 12+ segue valendo", () => {
    expect(resetPasswordSchema.safeParse({ token: "t", password: "senha-forte-123456", confirmPassword: "senha-forte-123456" }).success).toBe(true);
  });
  it("login NAO ganha minimo (senha antiga curta ou longa entra na validacao)", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.com", password: "senha-antiga-de-12+" }).success).toBe(true);
  });
});
