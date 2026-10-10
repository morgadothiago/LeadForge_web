import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { absoluteAppUrl, notifyOrgOwners, sendOnce } from "./send-once";

vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "" })) }));

let org: TestOrg;
beforeAll(async () => {
  org = await createTestOrg("send-once");
});
beforeEach(() => vi.mocked(sendSystemEmail).mockClear());
afterEach(() => prisma.emailDispatchLog.deleteMany({ where: { orgId: org.orgId } }));
afterAll(() => purgeTestOrg(org));

const base = () => ({ dedupeKey: `zz-${randomUUID()}`, scenario: "payment_receipt" as const, to: "a@b.com", subject: "s", html: "<p>h</p>", text: "t", orgId: org.orgId });

describe("sendOnce (SPEC-052a)", () => {
  it("1a chamada envia; 2a com a mesma chave = duplicate, sem reenvio", async () => {
    const input = base();
    expect(await sendOnce(input)).toBe("sent");
    expect(await sendOnce(input)).toBe("duplicate");
    expect(sendSystemEmail).toHaveBeenCalledTimes(1);
  });
  it("concorrencia: 2 chamadas simultaneas com a mesma chave enviam exatamente 1", async () => {
    const input = base();
    const r = await Promise.all([sendOnce(input), sendOnce(input)]);
    expect(r.sort()).toEqual(["duplicate", "sent"]);
    expect(sendSystemEmail).toHaveBeenCalledTimes(1);
  });
  it("falha do provider (ok:false ou throw) nao lanca e retorna failed", async () => {
    vi.mocked(sendSystemEmail).mockResolvedValueOnce({ ok: false, error: new Error("down") as never });
    expect(await sendOnce(base())).toBe("failed");
    vi.mocked(sendSystemEmail).mockRejectedValueOnce(new Error("boom"));
    expect(await sendOnce(base())).toBe("failed");
  });
  it("chaves diferentes enviam ambas", async () => {
    expect(await sendOnce(base())).toBe("sent");
    expect(await sendOnce(base())).toBe("sent");
  });
});

describe("notifyOrgOwners (SPEC-052a)", () => {
  it("com dedupeKey: 1 envio por owner e reentrega nao duplica", async () => {
    const input = { orgId: org.orgId, scenario: "trial_started" as const, subject: "s", html: "h", text: "t", dedupeKey: `zz-${randomUUID()}` };
    await notifyOrgOwners(input);
    await notifyOrgOwners(input);
    expect(sendSystemEmail).toHaveBeenCalledTimes(1);
  });
  it("sem dedupeKey: envio direto (idempotencia fica com o chamador)", async () => {
    const input = { orgId: org.orgId, scenario: "billing_reminder" as const, subject: "s", html: "h", text: "t" };
    await notifyOrgOwners(input);
    await notifyOrgOwners(input);
    expect(sendSystemEmail).toHaveBeenCalledTimes(2);
  });
  it("nunca lanca, mesmo se o envio lancar", async () => {
    vi.mocked(sendSystemEmail).mockRejectedValueOnce(new Error("x"));
    await expect(notifyOrgOwners({ orgId: org.orgId, scenario: "billing_reminder", subject: "s", html: "h", text: "t" })).resolves.toBeUndefined();
  });
});

describe("absoluteAppUrl", () => {
  it("usa APP_BASE_URL sem barra final", () => {
    vi.stubEnv("APP_BASE_URL", "https://app.exemplo.com/");
    expect(absoluteAppUrl("/configuracoes/assinatura")).toBe("https://app.exemplo.com/configuracoes/assinatura");
    vi.unstubAllEnvs();
  });
});
