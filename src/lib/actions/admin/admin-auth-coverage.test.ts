import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SPEC-031: toda query/action cross-tenant de `platform_admin` exige `requirePlatformAdmin()` ANTES de
 * qualquer acesso a `adminPrisma`/`prisma` — nunca `requireProviderOrg()`/`scopedPrisma` (esse é o
 * caminho por-org da SPEC-030, o oposto do que este módulo precisa fazer). Teste estático (grep de
 * código-fonte), mesmo padrão de `src/lib/actions/integration-auth-coverage.test.ts`.
 */
describe("admin cross-tenant: toda action/query exige requirePlatformAdmin (estático)", () => {
  for (const f of ["src/lib/actions/admin/organizations.ts", "src/lib/queries/admin/organizations.ts"]) {
    it(f, () => {
      const src = readFileSync(path.resolve(process.cwd(), f), "utf8");
      expect(src).not.toMatch(/requireProviderOrg\(\)|requireActiveProviderOrg\(\)|scopedPrisma\(/);

      const re = /export async function (\w+)[^{]*\{/g;
      const starts: { name: string; at: number }[] = [];
      for (let m = re.exec(src); m; m = re.exec(src)) starts.push({ name: m[1], at: m.index });
      expect(starts.length).toBeGreaterThan(0);
      starts.forEach((s, i) => {
        const body = src.slice(s.at, starts[i + 1]?.at ?? src.length);
        expect(body, `${s.name} requirePlatformAdmin`).toMatch(/await requirePlatformAdmin\(\)/);
        const iGuard = body.indexOf("await requirePlatformAdmin()");
        const sensitive = [/adminPrisma\./, /prisma\./];
        for (const re of sensitive) {
          const at = body.search(re);
          if (at === -1) continue;
          if (at < iGuard) expect.fail(`${s.name}: ${re} aparece antes de requirePlatformAdmin()`);
        }
      });
    });
  }
});
