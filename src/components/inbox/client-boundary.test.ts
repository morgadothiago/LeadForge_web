import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SPEC-068b: componentes de cliente NUNCA importam modulos de servidor (prisma/pg: erro de build 'dns' do passado) e nunca usam
 * dangerouslySetInnerHTML. So `import type` (apagado no build) ou os modulos puros liberados abaixo.
 */
const ROOT = process.cwd();
const files = [
  ...readdirSync(path.join(ROOT, "src/components/inbox")).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx")).map((f) => `src/components/inbox/${f}`),
  "src/lib/inbox/client-types.ts", "src/lib/inbox/client-api.ts", "src/lib/inbox/poller.ts",
];
const ALLOWED_VALUE_IMPORTS = ["@/lib/inbox/client-types", "@/lib/inbox/client-api", "@/lib/inbox/poller", "@/lib/actions/inbox"];

describe("fronteira cliente/servidor da caixa", () => {
  it.each(files)("%s", (f) => {
    const src = readFileSync(path.join(ROOT, f), "utf8");
    expect(src).not.toContain("dangerouslySetInnerHTML");
    for (const m of src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)) {
      const spec = m[1];
      expect(spec).not.toMatch(/prisma|^pg$|server-only|node:|@\/lib\/db|@\/lib\/auth\/require|\/queries\//);
      if (spec.startsWith("@/lib/inbox/")) expect(ALLOWED_VALUE_IMPORTS).toContain(spec);
    }
  });
});
