// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const run = (path: string) => proxy(new NextRequest(`http://localhost${path}`));

describe("proxy: rotas públicas de exclusão de conta (SPEC-054b)", () => {
  it("/conta/excluir/<token> e /conta/excluir/cancelar/<token> passam sem sessão", async () => {
    for (const p of ["/conta/excluir/abc", "/conta/excluir/cancelar/abc"]) {
      const res = await run(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });
  it("outras rotas privadas continuam redirecionando para /login", async () => {
    const res = await run("/configuracoes/conta");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?next=%2Fconfiguracoes%2Fconta");
  });
});

describe("proxy: /verificar-email pública (SPEC-055b)", () => {
  it("passa sem sessão, com query de token", async () => {
    const res = await run("/verificar-email?token=abc");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("proxy: rotas da SPEC-062 exigem sessao; lista publica inalterada", () => {
  it.each(["/assinar", "/assinar/retorno", "/organizacao/nova", "/entrar-em-organizacao", "/minha-conta"])("%s sem sessao -> /login", async (p) => {
    const res = await run(p);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?next=");
  });
  it.each(["/", "/login", "/signup", "/esqueci-senha", "/redefinir-senha", "/verificar-email", "/convite", "/convite/tok", "/conta/excluir/t"])("%s segue publica", async (p) => {
    const res = await run(p);
    expect(res.status, p).toBe(200);
  });
});
