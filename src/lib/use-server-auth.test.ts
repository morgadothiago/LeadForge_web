import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Teste estático GLOBAL (SPEC-013 QA B5): todo arquivo com a diretiva "use server" em src/ é superfície pública (POST invocável do cliente).
 * Cada função async exportada precisa chamar `requireUser(` direto OU delegar a uma função de queries/actions que o faça.
 */
const ROOT = path.resolve(process.cwd(), "src");
const ALLOWLIST: Record<string, string> = {
  // login/logout: ações de autenticação, não exigem sessão prévia (login cria; logout é idempotente e apenas remove a sessão).
  login: "src/lib/actions/auth.ts",
  logout: "src/lib/actions/auth.ts",
  // SPEC-033/D-35-1: signup self-service, cria a própria sessão (como login) — não há sessão prévia a exigir.
  signUpAndStartCheckout: "src/lib/actions/billing.ts",
  // SPEC-038: "esqueci/redefinir senha" — o usuário, por definição, ainda não tem sessão (ou a perdeu).
  forgotPassword: "src/lib/actions/auth.ts",
  resetPassword: "src/lib/actions/auth.ts",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

/** Diretiva = primeiro statement do arquivo (após comentários/linhas em branco). */
function hasUseServerDirective(src: string): boolean {
  const stripped = src.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  return /^["']use server["']/.test(stripped);
}

interface Fn { name: string; body: string }
function exportedAsyncFns(src: string): Fn[] {
  const re = /export\s+async\s+function\s+(\w+)|export\s+const\s+(\w+)\s*=\s*async/g;
  const hits: { name: string; at: number }[] = [];
  for (let m = re.exec(src); m; m = re.exec(src)) hits.push({ name: m[1] ?? m[2], at: m.index });
  const nextExport = (from: number): number => {
    const i = src.slice(from + 1).search(/\nexport\s/);
    return i < 0 ? src.length : from + 1 + i;
  };
  return hits.map((h) => ({ name: h.name, body: src.slice(h.at, nextExport(h.at)) }));
}

const rel = (f: string) => path.relative(process.cwd(), f).split(path.sep).join("/");
const files = walk(ROOT);
const serverFiles = files.filter((f) => hasUseServerDirective(readFileSync(f, "utf8")));

/** Qualquer `async function` (exportada ou helper local) até a próxima declaração de topo. */
function allAsyncFns(src: string): Fn[] {
  const re = /(?:^|\n)(?:export\s+)?async\s+function\s+(\w+)/g;
  const hits: { name: string; at: number }[] = [];
  for (let m = re.exec(src); m; m = re.exec(src)) hits.push({ name: m[1], at: m.index });
  return hits.map((h, i) => ({ name: h.name, body: src.slice(h.at, hits[i + 1]?.at ?? src.length) }));
}

/**
 * SPEC-030: `requireProviderOrg()`/`requirePlatformAdmin()` (`src/lib/auth/require-admin.ts`) chamam
 * `requireUser()` por dentro — são "exige sessão" tanto quanto a chamada direta, só que também exigem
 * org/papel de plataforma. O grep original só procurava `requireUser(` literal.
 */
const SESSION_GUARD_RE = /\brequireUser\s*\(|\brequireProviderOrg\s*\(|\brequireActiveProviderOrg\s*\(|\brequirePlatformAdmin\s*\(/;

// Funções de queries/actions (exportadas ou helpers locais como setStatus) que exigem sessão (delegáveis).
const guarded = new Set<string>();
for (const f of files.filter((f) => /src\/(lib\/queries|lib\/actions)\//.test(f.split(path.sep).join("/")))) {
  for (const fn of allAsyncFns(readFileSync(f, "utf8"))) if (SESSION_GUARD_RE.test(fn.body)) guarded.add(fn.name);
}

describe("estático: todo arquivo 'use server' exige sessão", () => {
  it("encontra os arquivos com a diretiva (inclui o wrapper de campanhas)", () => {
    const names = serverFiles.map(rel);
    expect(names).toContain("src/components/campaigns/start-actions.ts");
    expect(names).toContain("src/lib/actions/pipeline.ts");
    expect(names).not.toContain("src/lib/actions/result.ts"); // só cita a diretiva em comentário
  });

  for (const f of serverFiles) {
    it(`${rel(f)}: toda função async exportada chama requireUser (direto ou via query/action guardada)`, () => {
      const fns = exportedAsyncFns(readFileSync(f, "utf8"));
      expect(fns.length, "arquivo 'use server' sem função exportada?").toBeGreaterThan(0);
      for (const fn of fns) {
        if (ALLOWLIST[fn.name] === rel(f)) continue;
        const direct = SESSION_GUARD_RE.test(fn.body);
        const delegated = [...guarded].some((g) => new RegExp(`\\b${g}\\s*\\(`).test(fn.body.replace(new RegExp(`export\\s+async\\s+function\\s+${fn.name}`), "")));
        expect(direct || delegated, `${rel(f)}::${fn.name} sem requireUser`).toBe(true);
      }
    });
  }

  it("allowlist só contém login/logout/forgotPassword/resetPassword de auth.ts e signUpAndStartCheckout de billing.ts", () => {
    expect(Object.keys(ALLOWLIST).sort()).toEqual(["forgotPassword", "login", "logout", "resetPassword", "signUpAndStartCheckout"]);
  });
});
