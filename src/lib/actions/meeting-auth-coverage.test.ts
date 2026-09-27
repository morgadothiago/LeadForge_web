import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("reunioes: toda action/query exige requireUser antes de qualquer acesso a dados (estatico)", () => {
  for (const f of ["src/lib/actions/meeting.ts", "src/lib/queries/meetings.ts"]) {
    it(f, () => {
      const src = readFileSync(path.resolve(process.cwd(), f), "utf8");
      const re = /export async function (\w+)[^{]*\{/g;
      const starts: { name: string; at: number }[] = [];
      for (let m = re.exec(src); m; m = re.exec(src)) starts.push({ name: m[1], at: m.index });
      expect(starts.length).toBeGreaterThan(0);
      starts.forEach((s, i) => {
        const body = src.slice(s.at, starts[i + 1]?.at ?? src.length);
        // SPEC-030: `getMeetingSettings`/`saveMeetingSettings`/etc. usam `requireProviderOrg()` (exige sessão + org).
        const guardIdx = ["await requireUser()", "await requireProviderOrg()", "await requireActiveProviderOrg()"].map((g) => body.indexOf(g)).filter((i) => i !== -1);
        const iUser = guardIdx.length ? Math.min(...guardIdx) : -1;
        expect(iUser, `${s.name} requireUser`).toBeGreaterThan(-1);
        for (const re2 of [/prisma\./, /transition\(/, /createMeetingDomain\(/, /updateMeetingDomain\(/, /safeParse\(/]) {
          const at = body.search(re2);
          if (at !== -1) expect(iUser, `${s.name}: ${re2} antes de requireUser`).toBeLessThan(at);
        }
      });
    });
  }

  it("rotas de sessao de notificacoes usam requireSession antes de dados", () => {
    for (const f of ["src/app/api/notifications/route.ts", "src/app/api/notifications/summary/route.ts", "src/app/api/notifications/[id]/read/route.ts", "src/app/api/notifications/read-all/route.ts"]) {
      const src = readFileSync(path.resolve(process.cwd(), f), "utf8");
      const iAuth = src.indexOf("await requireSession()");
      expect(iAuth, f).toBeGreaterThan(-1);
      const at = src.search(/prisma\.|getNotificationSummary\(|sweepThrottled\(/);
      expect(iAuth, f).toBeLessThan(at);
    }
  });
});
