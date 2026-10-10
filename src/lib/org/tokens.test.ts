import { describe, expect, it } from "vitest";
import { formatJoinCode, hashInviteToken, JOIN_CODE_LENGTH, newInviteToken, newJoinCode, normalizeJoinCode } from "./tokens";
import { orgInviteTemplate } from "@/lib/channels/email/templates/org-invite";
import { fromAddressForScenario } from "@/lib/channels/email/scenario";

describe("tokens de convite/código (SPEC-049)", () => {
  it("token é aleatório, hash sha256 determinístico e diferente do token", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(a.hash).toBe(hashInviteToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.token);
  });

  it("código: 20 símbolos sem ambíguos, normalização ignora caixa/hífens/espaços, alta variabilidade", () => {
    const set = new Set(Array.from({ length: 200 }, () => newJoinCode()));
    expect(set.size).toBe(200);
    for (const c of set) expect(c).toMatch(new RegExp(`^[A-HJ-NP-Z2-9]{${JOIN_CODE_LENGTH}}$`));
    const c = newJoinCode();
    expect(normalizeJoinCode(` ${formatJoinCode(c).toLowerCase()} `)).toBe(c);
  });
});

describe("e-mail de convite (cenário org_invite)", () => {
  it("template escapa HTML e traz link, org e validade", () => {
    const t = orgInviteTemplate({ link: "https://x.test/convite/abc", orgName: "<b>Acme</b>", inviterName: "Ana", expiresInDays: 7 });
    expect(t.html).not.toContain("<b>Acme</b>");
    expect(t.html).toContain("https://x.test/convite/abc");
    expect(t.text).toContain("Acme");
    expect(t.subject).toContain("Acme");
  });
  it("remetente: org_invite usa RESEND_FROM_NOREPLY (e ACS_FROM_NOREPLY no acs)", () => {
    expect(fromAddressForScenario("org_invite", { RESEND_FROM_NOREPLY: "n@d.com" })).toBe("n@d.com");
    expect(fromAddressForScenario("org_invite", { ACS_FROM_NOREPLY: "a@d.com", RESEND_FROM_NOREPLY: "n@d.com" }, "acs")).toBe("a@d.com");
  });
});
