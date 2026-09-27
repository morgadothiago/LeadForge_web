import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SPEC-030: `requireAdmin()` foi removido — todo recurso de integração é por-org (`requireProviderOrg()`,
 * que já exige sessão E org/papel de provider numa única chamada; ver `src/lib/auth/require-admin.ts`).
 */
describe("integrações: toda action/query exige requireUser + requireAdmin (estático)", () => {
  for (const f of ["src/lib/actions/integration.ts", "src/lib/queries/integration.ts"]) {
    it(f, () => {
      const src = readFileSync(path.resolve(process.cwd(), f), "utf8");
      const re = /export async function (\w+)[^{]*\{/g;
      const starts: { name: string; at: number }[] = [];
      for (let m = re.exec(src); m; m = re.exec(src)) starts.push({ name: m[1], at: m.index });
      expect(starts.length).toBeGreaterThan(0);
      starts.forEach((s, i) => {
        const body = src.slice(s.at, starts[i + 1]?.at ?? src.length);
        expect(body, `${s.name} requireProviderOrg`).toMatch(/await requireProviderOrg\(\)|await requireActiveProviderOrg\(\)/);
        // ORDEM: a trava vem antes de qualquer acesso a dados/rede/limitador na função.
        const guardIdx = [body.indexOf("await requireProviderOrg()"), body.indexOf("await requireActiveProviderOrg()")].filter((i) => i !== -1);
        const iGuard = Math.min(...guardIdx);
        const sensitive = [/prisma\./, /getIntegrationConfig\(/, /fetch\(/, /assertAllowedHost\(/, /runConnectionTest\(/, /consume\w*Quota\(/, /listIntegrations?\w*\(/];
        for (const re of sensitive) {
          const at = body.search(re);
          if (at === -1) continue;
          const head = body.slice(0, at);
          if (/^export async function \w+[^{]*\{[^]*$/.test(head) && at < iGuard) {
            // permite o acesso apenas se ocorrer dentro da assinatura (nunca ocorre); senão é violação
            expect.fail(`${s.name}: ${re} aparece antes de requireProviderOrg()`);
          }
        }
      });
    });
  }
});
