import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), updateTag: vi.fn() }));

import * as actions from "./whatsapp";
import * as queries from "@/lib/queries/whatsapp";
import { signOut } from "@/lib/auth/test-helpers";

const ID = "00000000-0000-4000-8000-000000000000";
const args: Record<string, unknown[]> = {
  createWhatsAppInstance: [{}], getInstanceQr: [ID], refreshInstanceStatus: [ID], updateInstance: [{}], deleteWhatsAppInstance: [ID],
  disconnectInstance: [ID], getInstanceWebhookConfig: [ID], rotateWebhookToken: [ID], confirmOptOut: [ID], dismissPossibleOptOut: [ID], listWhatsAppInstances: [], getWhatsAppInstance: [ID],
};

describe("whatsapp: toda action/query exige sessão", () => {
  for (const name of Object.keys(actions)) {
    it(`action ${name} sem sessão -> Sessão expirada`, async () => {
      signOut();
      expect(args[name], `defina args de ${name}`).toBeDefined();
      const r = await (actions as Record<string, (...a: unknown[]) => Promise<{ ok: boolean; errors?: Record<string, string[]> }>>)[name](...args[name]);
      expect(r.ok).toBe(false);
      expect(r.errors?._form?.[0]).toMatch(/Sessão expirada/);
    });
  }
  for (const name of Object.keys(queries).filter((k) => typeof (queries as Record<string, unknown>)[k] === "function")) {
    it(`query ${name} sem sessão -> UnauthorizedError`, async () => {
      signOut();
      expect(args[name], `defina args de ${name}`).toBeDefined();
      await expect((queries as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name](...args[name])).rejects.toMatchObject({ name: "UnauthorizedError" });
    });
  }
  it("estático: toda função async exportada chama requireUser", () => {
    for (const f of ["src/lib/actions/whatsapp.ts", "src/lib/queries/whatsapp.ts"]) {
      const src = readFileSync(path.resolve(process.cwd(), f), "utf8");
      const re = /export async function (\w+)[^{]*\{/g;
      const starts: { name: string; at: number }[] = [];
      for (let m = re.exec(src); m; m = re.exec(src)) starts.push({ name: m[1], at: m.index });
      expect(starts.length).toBeGreaterThan(0);
      starts.forEach((s, i) => {
        const body = src.slice(s.at, starts[i + 1]?.at ?? src.length);
        expect(body, `${f}:${s.name} deve chamar requireUser()`).toMatch(/await requireUser\(\)|await requireProviderOrg\(\)|await requireActiveProviderOrg\(\)|await requirePlatformAdmin\(\)/);
      });
    }
  });
});
