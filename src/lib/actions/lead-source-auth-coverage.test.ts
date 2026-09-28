import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SPEC-041 (D-041-4) — actions/queries de vínculo de captação de leads. Assim como as integrações
 * (SPEC-018), todo recurso é por-org: escrita com `requireActiveProviderOrg()` (bloqueia org suspensa,
 * D-33-3/D-33-4) e leitura com `requireProviderOrg()`. A trava vem ANTES de qualquer acesso a dados.
 */
describe("captação de leads: toda action/query exige requireUser + guarda de org (estático)", () => {
  for (const f of ["src/lib/actions/lead-source.ts", "src/lib/queries/lead-source.ts"]) {
    it(f, () => {
      const src = readFileSync(path.resolve(process.cwd(), f), "utf8");
      const re = /export async function (\w+)[^{]*\{/g;
      const starts: { name: string; at: number }[] = [];
      for (let m = re.exec(src); m; m = re.exec(src)) starts.push({ name: m[1], at: m.index });
      expect(starts.length).toBeGreaterThan(0);
      starts.forEach((s, i) => {
        const body = src.slice(s.at, starts[i + 1]?.at ?? src.length);
        expect(body, `${s.name} requireProviderOrg`).toMatch(/await requireProviderOrg\(\)|await requireActiveProviderOrg\(\)/);
        // ORDEM: a trava vem antes de qualquer acesso a dados/rede/cifra na função.
        const guardIdx = [body.indexOf("await requireProviderOrg()"), body.indexOf("await requireActiveProviderOrg()")].filter((i) => i !== -1);
        const iGuard = Math.min(...guardIdx);
        const sensitive = [/prisma\./, /scopedPrisma\(/, /getEncryptionKey\(/, /encrypt\(/, /readIntegrationSecretValue\(/, /fetch\(/];
        for (const reSensitive of sensitive) {
          const at = body.search(reSensitive);
          if (at === -1) continue;
          const head = body.slice(0, at);
          if (/^export async function \w+[^{]*\{[^]*$/.test(head) && at < iGuard) {
            // permite o acesso apenas se ocorrer dentro da assinatura (nunca ocorre); senão é violação
            expect.fail(`${s.name}: ${reSensitive} aparece antes da guarda de org`);
          }
        }
      });
    });
  }
});
