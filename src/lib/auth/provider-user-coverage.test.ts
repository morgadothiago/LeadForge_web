import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SPEC-062 (D-062-8): `requireProviderUser()` (sessao de provider SEM exigir org) amplia a superficie para sessao sem org.
 * Varredura estatica: so as actions da allowlist podem usa-lo; todas as demais continuam em `requireProviderOrg()` & cia
 * (que seguem recusando sessao sem org). `requireProviderOrg`/`requireActiveProviderOrg` permanecem INALTERADOS.
 */
const ALLOW: Record<string, string[]> = {
  "src/lib/actions/billing.ts": ["startPlanCheckout", "getPlanCheckoutState", "cancelPendingSubscription", "completeOrganizationSetup"],
  "src/lib/actions/org.ts": ["acceptInvite", "joinByCode"],
  "src/lib/actions/account-deletion.ts": ["getAccountDeletionState", "requestAccountDeletion"],
};

const walk = (d: string, out: string[] = []): string[] => {
  for (const n of readdirSync(d)) {
    const p = path.join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
};
const rel = (f: string) => path.relative(process.cwd(), f).split(path.sep).join("/");

describe("requireProviderUser: superficie controlada (SPEC-062)", () => {
  const files = walk(path.resolve(process.cwd(), "src"));

  it("so e chamado pelas actions da allowlist (e definido em require-admin.ts)", () => {
    for (const f of files) {
      const r = rel(f);
      if (r === "src/lib/auth/require-admin.ts") continue;
      const src = readFileSync(f, "utf8");
      if (!/requireProviderUser\s*\(/.test(src)) continue;
      expect(Object.keys(ALLOW), `${r} usa requireProviderUser fora da allowlist`).toContain(r);
      const parts = src.split(/^(?=export async function )/m).filter((c) => c.startsWith("export async function "));
      const users = parts.filter((c) => /requireProviderUser\s*\(/.test(c)).map((c) => /function (\w+)/.exec(c)![1]);
      expect(users.sort(), r).toEqual([...ALLOW[r]].sort());
    }
  });

  it("requireProviderOrg/requireActiveProviderOrg continuam recusando sessao sem org (corpo inalterado)", () => {
    const src = readFileSync(path.resolve(process.cwd(), "src/lib/auth/require-admin.ts"), "utf8");
    expect(src).toMatch(/export async function requireProviderOrg[\s\S]*?if \(user\.platformRole !== "provider" \|\| !user\.orgId\) throw new ForbiddenError\(\);/);
    expect(src).toMatch(/export async function requireActiveProviderOrg[\s\S]*?await requireProviderOrg\(\)[\s\S]*?org\.status !== "active"\) throw new OrgSuspendedError/);
    const guards = readFileSync(path.resolve(process.cwd(), "src/lib/org/guards.ts"), "utf8");
    expect(guards).toMatch(/requireOrgMember[\s\S]*?await requireProviderOrg\(\)/);
  });
});
