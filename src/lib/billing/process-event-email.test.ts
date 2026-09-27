import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import type { ParsedBillingEvent } from "./provider";
import { processBillingEvent } from "./process-event";
import { CANCEL_RETENTION_MS } from "./status-map";

/**
 * SPEC-046 — cenários novos "assinatura efetuada com sucesso" (D-046-3: toda transição para
 * active/trialing, incluindo troca de plano) e "assinatura cancelada", disparados dentro de
 * `processBillingEvent`. `sendSystemEmail` é mockado (nunca chama Resend/SMTP real).
 */
vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "" })) }));

let org: TestOrg;
const NOW = new Date("2026-03-01T12:00:00Z");

const baseEvent = (over: Partial<ParsedBillingEvent> = {}): ParsedBillingEvent => ({
  eventId: `zz-evt-email-${randomUUID()}`,
  type: "subscription.created",
  orgId: org.orgId,
  planKey: "starter",
  cadence: "monthly",
  status: "active",
  currentPeriodEnd: new Date(NOW.getTime() + 30 * 24 * 3600_000),
  cancelAtPeriodEnd: false,
  externalCustomerId: "cus_1",
  externalSubscriptionId: "sub_1",
  ...over,
});

beforeAll(async () => {
  org = await createTestOrg("process-event-email");
});
beforeEach(() => vi.mocked(sendSystemEmail).mockClear());
afterEach(async () => {
  await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
  await prisma.webhookEvent.deleteMany({ where: { orgId: org.orgId } });
});
afterAll(() => purgeTestOrg(org));

const ownerEmail = () => prisma.user.findUniqueOrThrow({ where: { id: org.userId }, select: { email: true } }).then((u) => u.email);

describe("processBillingEvent — e-mail de assinatura efetuada (SPEC-046, D-046-3)", () => {
  it("checkout inicial (active): dispara e-mail de assinatura efetuada para o owner", async () => {
    const r = await processBillingEvent(baseEvent({ status: "active" }), NOW);
    expect(r).toBe("processed");
    expect(sendSystemEmail).toHaveBeenCalledTimes(1);
    const [to, subject, content, scenario] = vi.mocked(sendSystemEmail).mock.calls[0];
    expect(to).toBe(await ownerEmail());
    expect(scenario).toBe("subscription_success");
    expect(subject).toMatch(/[Aa]ssinatura/);
    expect(content).toMatchObject({ html: expect.stringContaining("Starter"), text: expect.stringContaining("Starter") });
  });

  it("trialing: dispara e-mail (conteúdo de início de teste, sem valor cobrado ainda não é regra de negócio nova — só o mecanismo)", async () => {
    const r = await processBillingEvent(baseEvent({ status: "trialing", currentPeriodEnd: null }), NOW);
    expect(r).toBe("processed");
    expect(sendSystemEmail).toHaveBeenCalledTimes(1);
    const [, , , scenario] = vi.mocked(sendSystemEmail).mock.calls[0];
    expect(scenario).toBe("subscription_success");
  });

  it("D-046-3: troca de plano (2ª transição bem-sucedida para active) TAMBÉM dispara — não só o checkout inicial", async () => {
    await processBillingEvent(baseEvent({ status: "active", planKey: "starter" }), NOW);
    expect(sendSystemEmail).toHaveBeenCalledTimes(1);
    vi.mocked(sendSystemEmail).mockClear();

    // troca de plano: novo evento, planKey diferente, ainda "active".
    await processBillingEvent(baseEvent({ status: "active", planKey: "pro" }), NOW);
    expect(sendSystemEmail).toHaveBeenCalledTimes(1);
    const [, , , scenario] = vi.mocked(sendSystemEmail).mock.calls[0];
    expect(scenario).toBe("subscription_success");
  });

  it("evento duplicado (mesmo eventId): NÃO reenvia e-mail (idempotência do processamento cobre o e-mail também)", async () => {
    const event = baseEvent({ status: "active" });
    await processBillingEvent(event, NOW);
    expect(sendSystemEmail).toHaveBeenCalledTimes(1);
    vi.mocked(sendSystemEmail).mockClear();

    const r2 = await processBillingEvent(event, NOW);
    expect(r2).toBe("duplicate");
    expect(sendSystemEmail).not.toHaveBeenCalled();
  });

  it("past_due/incomplete: NÃO dispara e-mail de assinatura efetuada", async () => {
    await processBillingEvent(baseEvent({ status: "active" }), NOW);
    vi.mocked(sendSystemEmail).mockClear();
    await processBillingEvent(baseEvent({ status: "past_due" }), NOW);
    expect(sendSystemEmail).not.toHaveBeenCalled();
  });

  it("falha total do envio (sendSystemEmail lança): processBillingEvent NÃO lança, continua retornando 'processed'", async () => {
    vi.mocked(sendSystemEmail).mockRejectedValueOnce(new Error("provider indisponível"));
    const r = await processBillingEvent(baseEvent({ status: "active" }), NOW);
    expect(r).toBe("processed");
  });
});

describe("processBillingEvent — e-mail de assinatura cancelada (SPEC-046, NOVO)", () => {
  it("transição para canceled: dispara e-mail com data de expurgo (90 dias, D-33-4)", async () => {
    await processBillingEvent(baseEvent({ status: "active" }), NOW);
    vi.mocked(sendSystemEmail).mockClear();

    const r = await processBillingEvent(baseEvent({ type: "subscription.canceled", status: "canceled" }), NOW);
    expect(r).toBe("processed");
    expect(sendSystemEmail).toHaveBeenCalledTimes(1);
    const [to, subject, content, scenario] = vi.mocked(sendSystemEmail).mock.calls[0];
    expect(to).toBe(await ownerEmail());
    expect(scenario).toBe("subscription_canceled");
    expect(subject).toMatch(/cancelad/i);
    const purgeDate = new Date(NOW.getTime() + CANCEL_RETENTION_MS);
    const purgeDay = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(purgeDate);
    expect(content.text).toContain(purgeDay);
  });

  it("falha total do envio (sendSystemEmail lança): processBillingEvent NÃO lança, continua retornando 'processed'", async () => {
    await processBillingEvent(baseEvent({ status: "active" }), NOW);
    vi.mocked(sendSystemEmail).mockRejectedValueOnce(new Error("provider indisponível"));
    const r = await processBillingEvent(baseEvent({ type: "subscription.canceled", status: "canceled" }), NOW);
    expect(r).toBe("processed");
  });
});
