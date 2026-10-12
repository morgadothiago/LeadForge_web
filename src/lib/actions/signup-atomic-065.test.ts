import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

// Falha NO MEIO da transacao do cadastro (depois de User/claims/Org/Membership/Subscription): tudo deve ser desfeito.
vi.mock("@/lib/org/audit", () => ({
  recordOrgAudit: vi.fn(async () => {
    throw new Error("falha simulada no fim da transacao");
  }),
}));
vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "m" })) }));

import { prisma } from "@/lib/prisma";
import { testHeaders } from "@/lib/auth/test-helpers";
import { docClaimHash, emailClaimHash } from "@/lib/billing/trial-claim";
import { parseDocument } from "@/lib/domain/document";
import { randomCpf } from "@/lib/test-utils/document";
import { signUp } from "./billing";

afterAll(() => {
  testHeaders.current = new Headers();
});

describe("signUp: atomicidade (SPEC-065, D-065-23/27)", () => {
  it("falha no meio da transacao => NADA criado (User, Organization, Membership, Subscription e os 2 TrialClaim sofrem rollback)", async () => {
    const email = `zz-065-atomic-${randomUUID().slice(0, 8)}@test.local`;
    const cpf = randomCpf();
    testHeaders.current = new Headers({ "x-real-ip": "10.99.1.1" });
    const orgs = await prisma.organization.count();
    const subs = await prisma.subscription.count();
    const r = await signUp({ name: "Atomic", email, document: cpf, password: "senha-forte-123456", confirmPassword: "senha-forte-123456" });
    expect(r.ok).toBe(false);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.organization.count()).toBe(orgs);
    expect(await prisma.subscription.count()).toBe(subs);
    expect(await prisma.trialClaim.count({ where: { keyHash: { in: [emailClaimHash(email), docClaimHash(parseDocument(cpf)!)] } } })).toBe(0);
  });
});
