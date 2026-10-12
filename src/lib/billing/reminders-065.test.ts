import "dotenv/config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/channels/system-mail", () => ({ sendSystemEmail: vi.fn(async () => ({ ok: true, messageId: "" })) }));

import { prisma } from "@/lib/prisma";
import { createTestOrg, purgeTestOrg, type TestOrg } from "@/lib/test-utils/org-fixture";
import { DAY, setOrgPlan } from "@/lib/test-utils/trial-fixture";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { sendBillingReminders } from "./reminders";
import { syncOrgStatuses } from "./status-map";
import { processBillingEvent } from "./process-event";

let org: TestOrg;
const T0 = new Date();
const at = (days: number) => new Date(T0.getTime() + days * DAY);
const kinds = async () => (await prisma.billingReminderLog.findMany({ where: { orgId: org.orgId }, select: { kind: true } })).map((l) => l.kind).sort();
const sentTo = async () => {
  const email = (await prisma.user.findUniqueOrThrow({ where: { id: org.userId }, select: { email: true } })).email;
  return vi.mocked(sendSystemEmail).mock.calls.filter((c) => c[0] === email);
};
/** Trial de 14 dias criado em `created` (D0) e que acaba em `created + 14d`. */
async function trialOf(created: Date) {
  await setOrgPlan(org.orgId, { planKey: "free", status: "trialing", trialEndsAt: new Date(created.getTime() + 14 * DAY) });
  await prisma.subscription.update({ where: { orgId: org.orgId }, data: { createdAt: created } });
}

beforeAll(async () => {
  org = await createTestOrg("reminders-065");
});
beforeEach(() => vi.mocked(sendSystemEmail).mockClear());
afterEach(async () => {
  await prisma.billingReminderLog.deleteMany({ where: { orgId: org.orgId } });
  await prisma.emailDispatchLog.deleteMany({ where: { orgId: org.orgId } });
  await prisma.subscription.deleteMany({ where: { orgId: org.orgId } });
  await prisma.organization.update({ where: { id: org.orgId }, data: { status: "active", suspendedReason: null } });
});
afterAll(() => purgeTestOrg(org));

describe("lembretes do trial (SPEC-065, D-065-16)", () => {
  it("D-3, D-1 e expirado: 1x cada (idempotentes por BillingReminderLog), nas datas certas de um trial de 14 dias", async () => {
    await trialOf(T0); // acaba em T0+14d
    await sendBillingReminders(at(10));
    expect(await kinds()).toEqual([]); // faltam 4 dias: nada ainda
    await sendBillingReminders(at(11.5)); // faltam 2,5 dias
    expect(await kinds()).toEqual(["trial_ending"]);
    await sendBillingReminders(at(11.6));
    expect(await kinds()).toEqual(["trial_ending"]); // idempotente
    await sendBillingReminders(at(13.2)); // falta < 1 dia
    expect(await kinds()).toEqual(["trial_ending", "trial_ending_d1"]);
    await sendBillingReminders(at(13.3));
    expect(await kinds()).toEqual(["trial_ending", "trial_ending_d1"]);
    await sendBillingReminders(at(14.1)); // expirou
    expect(await kinds()).toEqual(["trial_ending", "trial_ending_d1", "trial_expired"]);
    await sendBillingReminders(at(20));
    expect(await kinds()).toEqual(["trial_ending", "trial_ending_d1", "trial_expired"]);
    expect(await sentTo()).toHaveLength(3);
    const subjects = (await sentTo()).map((c) => c[1]);
    expect(subjects.some((s) => /amanhã/.test(s))).toBe(true);
    expect(subjects.some((s) => /terminou/.test(s))).toBe(true);
  });

  it("D-3 e D-1 NUNCA depois da expiracao (tick parado): so o aviso de expirado sai", async () => {
    await trialOf(T0);
    await sendBillingReminders(at(15));
    expect(await kinds()).toEqual(["trial_expired"]);
  });

  it("nada apos pagar (status active) e trial que NASCEU expirado (anti-abuso) nao recebe 'seu teste acabou'", async () => {
    await trialOf(T0);
    await prisma.subscription.update({ where: { orgId: org.orgId }, data: { status: "active", trialEndsAt: null, currentPeriodEnd: at(30) } });
    await sendBillingReminders(at(13.5));
    await sendBillingReminders(at(15));
    expect(await kinds()).toEqual([]);
    await setOrgPlan(org.orgId, { planKey: "free", status: "trialing", trialEndsAt: T0 }); // nasceu expirado
    await sendBillingReminders(at(1));
    expect(await kinds()).toEqual([]);
  });

  it("auto_suspended NAO dispara para trial expirado (so para past_due com grace vencido); tick (syncOrgStatuses) suspende como `automatic`", async () => {
    await trialOf(new Date(T0.getTime() - 15 * DAY));
    await syncOrgStatuses(T0);
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId }, select: { status: true, suspendedReason: true } })).toEqual({ status: "suspended", suspendedReason: "automatic" });
    await sendBillingReminders(T0);
    expect(await kinds()).not.toContain("auto_suspended");
    expect(await kinds()).toEqual(["trial_expired"]);
  });

  it("falha de e-mail e isolada: o tick nao lanca e a rodada seguinte nao reenvia (reserva ja gravada)", async () => {
    await trialOf(new Date(T0.getTime() - 15 * DAY));
    vi.mocked(sendSystemEmail).mockRejectedValueOnce(new Error("smtp fora"));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(sendBillingReminders(T0)).resolves.toBeDefined();
    err.mockRestore();
    expect(await kinds()).toEqual(["trial_expired"]);
  });

  it("pagamento depois de expirar nao reenvia nada e o evento active zera o trial", async () => {
    await trialOf(new Date(T0.getTime() - 15 * DAY));
    await sendBillingReminders(T0);
    await processBillingEvent({ eventId: `evt_${Math.random()}`, type: "subscription.created", orgId: org.orgId, planKey: "starter", cadence: "monthly", status: "active", currentPeriodEnd: at(30), cancelAtPeriodEnd: false, externalCustomerId: null, externalSubscriptionId: null }, T0);
    vi.mocked(sendSystemEmail).mockClear();
    await sendBillingReminders(at(1));
    expect(await sentTo()).toHaveLength(0);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { orgId: org.orgId } })).trialEndsAt).toBeNull();
  });
});
