import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import * as suppressionActions from "./suppression";
import * as healthActions from "./whatsapp-health";
import * as suppressionQueries from "@/lib/queries/suppression";
import * as healthQueries from "@/lib/queries/whatsapp-health";
import { signOut } from "@/lib/auth/test-helpers";

const ID = "00000000-0000-4000-8000-000000000000";
const args: Record<string, unknown[]> = {
  addToSuppression: [{ leadId: ID }], removeFromSuppression: [{ id: ID, reason: "motivo válido", confirm: true }],
  resumeInstance: [ID], retryTouch: [{ touchId: ID, confirm: true }], dismissInstanceAlerts: [ID],
  listSuppressions: [], isContactSuppressed: [{ email: "a@b.com" }], getInstanceHealth: [ID], listUnreadInstanceAlerts: [],
};
type Fn = (...a: unknown[]) => Promise<{ ok: boolean; errors?: Record<string, string[]> }>;

describe("SPEC-017: toda action/query nova exige sessão", () => {
  for (const [label, mod] of [["suppression actions", suppressionActions], ["health actions", healthActions]] as const) {
    for (const name of Object.keys(mod)) {
      it(`${label}: ${name} sem sessão -> Sessão expirada`, async () => {
        signOut();
        expect(args[name], `defina args de ${name}`).toBeDefined();
        const r = await (mod as unknown as Record<string, Fn>)[name](...args[name]);
        expect(r.ok).toBe(false);
        expect(r.errors?._form?.[0]).toMatch(/Sessão expirada/);
      });
    }
  }
  for (const [label, mod] of [["suppression queries", suppressionQueries], ["health queries", healthQueries]] as const) {
    for (const name of Object.keys(mod).filter((k) => typeof (mod as Record<string, unknown>)[k] === "function")) {
      it(`${label}: ${name} sem sessão -> UnauthorizedError`, async () => {
        signOut();
        expect(args[name], `defina args de ${name}`).toBeDefined();
        await expect((mod as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name](...args[name])).rejects.toMatchObject({ name: "UnauthorizedError" });
      });
    }
  }
  it("estático: toda função async exportada chama requireUser", () => {
    for (const f of ["src/lib/actions/suppression.ts", "src/lib/actions/whatsapp-health.ts", "src/lib/queries/suppression.ts", "src/lib/queries/whatsapp-health.ts"]) {
      const src = readFileSync(path.resolve(process.cwd(), f), "utf8");
      const re = /export async function (\w+)[^{]*\{/g;
      const starts: { name: string; at: number }[] = [];
      for (let m = re.exec(src); m; m = re.exec(src)) starts.push({ name: m[1], at: m.index });
      expect(starts.length).toBeGreaterThan(0);
      starts.forEach((s, i) => {
        expect(src.slice(s.at, starts[i + 1]?.at ?? src.length), `${f}:${s.name} deve chamar requireUser()`).toMatch(/await requireUser\(\)|await requireProviderOrg\(\)|await requirePlatformAdmin\(\)/);
      });
    }
  });
});
