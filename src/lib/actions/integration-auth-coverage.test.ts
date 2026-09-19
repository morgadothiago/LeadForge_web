import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
        expect(body, `${s.name} requireUser`).toMatch(/await requireUser\(\)/);
        expect(body, `${s.name} requireAdmin`).toMatch(/await requireAdmin\(\)/);
        // ORDEM: as duas travas vêm antes de qualquer acesso a dados/rede/limitador na função.
        const iUser = body.indexOf("await requireUser()");
        const iAdmin = body.indexOf("await requireAdmin()");
        expect(iUser, `${s.name}: requireUser antes de requireAdmin`).toBeLessThan(iAdmin);
        const sensitive = [/prisma\./, /getIntegrationConfig\(/, /fetch\(/, /assertAllowedHost\(/, /runConnectionTest\(/, /consume\w*Quota\(/, /listIntegrations?\w*\(/];
        for (const re of sensitive) {
          const at = body.search(re);
          if (at === -1) continue;
          const head = body.slice(0, at);
          if (/^export async function \w+[^{]*\{[^]*$/.test(head) && at < iAdmin) {
            // permite o acesso apenas se ocorrer dentro da assinatura (nunca ocorre); senão é violação
            expect.fail(`${s.name}: ${re} aparece antes de requireAdmin()`);
          }
        }
      });
    });
  }
});
