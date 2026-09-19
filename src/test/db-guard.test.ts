import { describe, expect, it } from "vitest";
import { assertSameServerOrConfirmed, assertTestDatabase, dbNameFromUrl, deriveTestUrl } from "./db-guard";

describe("trava do banco de teste", () => {
  it("extrai o nome do banco sem expor credenciais", () => {
    expect(dbNameFromUrl("postgresql://u:p@localhost:5434/leadforge?schema=public")).toBe("leadforge");
    expect(dbNameFromUrl(undefined)).toBe("");
    expect(dbNameFromUrl("lixo")).toBe("");
  });
  it("aceita *_test e recusa o resto sem vazar a senha", () => {
    expect(() => assertTestDatabase("postgresql://u:segredo@h:5434/leadforge_test")).not.toThrow();
    for (const bad of ["postgresql://u:segredo@h:5434/leadforge", "postgresql://u:segredo@h:5434/test", undefined, "x"]) {
      let msg = "";
      try { assertTestDatabase(bad); } catch (e) { msg = (e as Error).message; }
      expect(msg).toContain("Recusando rodar testes contra banco que não é de teste");
      expect(msg).not.toContain("segredo");
    }
  });
  it("deriva a URL de teste trocando só o nome; TEST_DATABASE_URL tem precedência", () => {
    expect(deriveTestUrl({ DATABASE_URL: "postgresql://u:p@h:5434/leadforge" })).toBe("postgresql://u:p@h:5434/leadforge_test");
    expect(deriveTestUrl({ DATABASE_URL: "postgresql://u:p@h:5434/leadforge_test" })).toBe("postgresql://u:p@h:5434/leadforge_test");
    expect(deriveTestUrl({ DATABASE_URL: "postgresql://u:p@h/a", TEST_DATABASE_URL: "postgresql://u:p@h/b_test" })).toBe("postgresql://u:p@h/b_test");
    expect(deriveTestUrl({})).toBeUndefined();
  });
  it("outro servidor com nome *_test -> recusa; mesmo host:porta ou confirmação explícita passam (sem vazar senha)", () => {
    const dev = "postgresql://u:segredo@localhost:5434/leadforge";
    expect(() => assertSameServerOrConfirmed("postgresql://u:p@localhost:5434/leadforge_test", { DATABASE_URL: dev })).not.toThrow();
    let msg = "";
    try { assertSameServerOrConfirmed("postgresql://u:segredo@prod.exemplo.com:5432/x_test", { DATABASE_URL: dev }); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain("outro servidor");
    expect(msg).toContain("TEST_DB_ALLOW_OTHER_HOST");
    expect(msg).not.toContain("segredo");
    expect(() => assertSameServerOrConfirmed("postgresql://u:p@localhost:5999/x_test", { DATABASE_URL: dev })).toThrow(/outro servidor/);
    expect(() => assertSameServerOrConfirmed("postgresql://u:p@prod.exemplo.com/x_test", { DATABASE_URL: dev, TEST_DB_ALLOW_OTHER_HOST: "1" })).not.toThrow();
    expect(() => assertSameServerOrConfirmed("postgresql://u:p@prod.exemplo.com/x_test", { DATABASE_URL: dev, TEST_DB_ALLOW_OTHER_HOST: "true" })).toThrow();
  });
});
