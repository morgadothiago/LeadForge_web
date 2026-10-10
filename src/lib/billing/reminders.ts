import { Prisma, type BillingReminderKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { safeErrorForLog } from "@/lib/errors";
import { notifyOrgOwners, absoluteAppUrl } from "@/lib/channels/email/send-once";
import { paymentFailedTemplate, type PaymentFailedStep } from "@/lib/channels/email/templates/payment-failed";
import { renewalUpcomingTemplate } from "@/lib/channels/email/templates/renewal-upcoming";
import { billingReminderTemplate, type BillingReminderVariant } from "@/lib/channels/email/templates/billing-reminder";
import { notifyPaymentFailed } from "./past-due-email";
import { CANCEL_RETENTION_MS, PAST_DUE_GRACE_MS } from "./status-map";

/**
 * SPEC-039 — e-mails de lembrete/aviso em cima do fluxo de billing JÁ EXISTENTE (SPEC-033), sem alterar
 * nenhuma lógica/timing de transição de status (D-039-1/D-039-3). Chamado pelo tick (`run-tick.ts`,
 * isolado — falha nunca derruba o scheduler), mesmo espírito de `syncOrgStatuses`/`purgeCanceledOrgs`.
 *
 * 4 gatilhos (D-039-2), cada um lido diretamente do estado já persistido pelo fluxo existente (nunca
 * escreve em `Subscription`/`Organization`):
 * 1. `trial_ending`     — `trialEndsAt` a <= 3 dias (subscription ainda `trialing`).
 * 2. `past_due_started` — subscription em `past_due` com `pastDueSince` setado (início do grace de 7d).
 * 3. `auto_suspended`   — org já `suspended` por um `past_due` que expirou o grace (nunca dispara para
 *    suspensão MANUAL via `platform_admin`, D-039-1, nem para o soft-block imediato de `canceled`).
 *    CORREÇÃO QA (achado bloqueante, 2026-09-27): a query original inferia "causa automática" do estado
 *    atual (`status: "suspended"` + `subscription.status: "past_due"`), o que é AMBÍGUO — uma suspensão
 *    MANUAL feita pelo `platform_admin` enquanto a subscription também está (por coincidência) em
 *    `past_due` batia nesse filtro e disparava o e-mail indevido, violando D-039-1. Corrigido filtrando
 *    também por `Organization.suspendedReason === "automatic"` (sinal explícito gravado por
 *    `syncOrgStatuses`, `status-map.ts`, no momento exato da transição automática — nunca por
 *    `suspendOrganization`, que grava `"manual"`) e checando explicitamente que o grace period de fato
 *    expirou (`now - pastDueSince >= PAST_DUE_GRACE_MS`), em vez de assumir isso pela mera presença de
 *    `pastDueSince`.
 * 4. `purge_warning`    — `canceledAt` há >= 75 dias (expurgo roda aos 90, D-33-4) e org ainda não expurgada.
 *
 * Idempotência (achado recorrente de QA nas specs anteriores): `BillingReminderLog` com
 * `@@unique([orgId, kind, anchorAt])` (ver comentário no schema). O INSERT do log é a "reserva" do envio —
 * feito ANTES de chamar `sendSystemEmail`; se o insert falhar por unique (P2002), o aviso já foi
 * reservado/enviado antes e a rodada atual pula sem reenviar. Isso prioriza "nunca duplica" sobre "nunca
 * perde" (compensação aceitável: falha OCASIONAL de SMTP nesse envio específico não é retentada — mesmo
 * trade-off aceito pelo restante do fluxo de billing, que também nunca lança/retenta em cima de falha de
 * canal externo).
 */

const TRIAL_WARNING_MS = 3 * 24 * 3600_000;
const PURGE_WARNING_MS = CANCEL_RETENTION_MS - 15 * 24 * 3600_000; // 15 dias antes dos 90 dias = 75 dias após canceledAt.

export interface BillingReminderResult {
  sent: number;
  errors: number;
}

/** Reserva o envio (idempotência). true = reservado agora (deve enviar); false = já tinha sido enviado para essa ancora. */
async function claim(orgId: string, kind: BillingReminderKind, anchorAt: Date): Promise<boolean> {
  try {
    await prisma.billingReminderLog.create({ data: { orgId, kind, anchorAt } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

async function remind(state: BillingReminderResult, orgId: string, kind: BillingReminderKind, anchorAt: Date): Promise<void> {
  try {
    if (!(await claim(orgId, kind, anchorAt))) return;
    const { subject, html, text } = billingReminderTemplate(kind as BillingReminderVariant);
    await notifyOrgOwners({ orgId, scenario: "billing_reminder", subject, html, text });
    state.sent++;
  } catch (e) {
    state.errors++;
    console.error(`[billing-reminders] falha ao processar aviso (org ${orgId}, kind ${kind}):`, safeErrorForLog(e));
  }
}

/** 1. 3 dias antes do fim do trial. */
async function remindTrialEnding(now: Date, state: BillingReminderResult): Promise<void> {
  const threshold = new Date(now.getTime() + TRIAL_WARNING_MS);
  const subs = await prisma.subscription.findMany({
    where: { status: "trialing", trialEndsAt: { lte: threshold } },
    select: { orgId: true, trialEndsAt: true },
  });
  for (const s of subs) {
    if (!s.trialEndsAt) continue;
    await remind(state, s.orgId, "trial_ending", s.trialEndsAt);
  }
}

/**
 * 2. Início do past_due. SPEC-052b: D+0 sai NO evento `payment.failed`; este gatilho vira FALLBACK idempotente
 * (ex.: past_due vindo de outro caminho/evento perdido) e usa a MESMA chave de dedupe do e-mail do evento
 * (`pastDueEpisodeKey`) — nunca duplica, nem em corrida evento x job. Mantem `BillingReminderLog` (past_due_started).
 */
async function remindPastDueStarted(state: BillingReminderResult): Promise<void> {
  const subs = await prisma.subscription.findMany({
    where: { status: "past_due", pastDueSince: { not: null } },
    select: { orgId: true, pastDueSince: true, cadence: true, plan: { select: { name: true, priceMonthlyCents: true, priceYearlyCents: true } } },
  });
  for (const s of subs) {
    if (!s.pastDueSince) continue;
    try {
      if (!(await claim(s.orgId, "past_due_started", s.pastDueSince))) continue;
      await notifyPaymentFailed({ orgId: s.orgId, planName: s.plan.name, pastDueSince: s.pastDueSince, amountCents: s.cadence === "yearly" ? s.plan.priceYearlyCents : s.plan.priceMonthlyCents });
      state.sent++;
    } catch (e) {
      state.errors++;
      console.error(`[billing-reminders] falha ao processar aviso (org ${s.orgId}, kind past_due_started):`, safeErrorForLog(e));
    }
  }
}

/** SPEC-052b: regua D+3/D+5/D+7 (D-052-4: igual cartao e PIX). Para sozinha ao sair de past_due (filtro por status). */
const PAST_DUE_STEPS: Array<{ kind: "past_due_d3" | "past_due_d5" | "past_due_d7"; step: PaymentFailedStep; days: number }> = [
  { kind: "past_due_d3", step: "d3", days: 3 },
  { kind: "past_due_d5", step: "d5", days: 5 },
  // Ultimo aviso sai em D+6 (24h antes do fim do grace de 7d), nao em D+7: em D+7 a suspensao automatica roda no mesmo
  // tick e o "ultimo aviso" chegaria junto de "conta suspensa". O kind segue `past_due_d7` (enum/logs ja existentes).
  { kind: "past_due_d7", step: "d7", days: 6 },
];

async function remindPastDueLadder(now: Date, state: BillingReminderResult): Promise<void> {
  const subs = await prisma.subscription.findMany({
    where: { status: "past_due", pastDueSince: { not: null } },
    select: { orgId: true, pastDueSince: true, cadence: true, plan: { select: { name: true, priceMonthlyCents: true, priceYearlyCents: true } } },
  });
  for (const s of subs) {
    const since = s.pastDueSince;
    if (!since) continue;
    // So o passo MAIS RECENTE devido e enviado; passos anteriores perdidos (ex.: tick parado) sao reservados em
    // silencio para nunca disparar D+3, D+5 e D+7 de uma vez.
    const due = PAST_DUE_STEPS.filter(({ days }) => now.getTime() - since.getTime() >= days * 24 * 3600_000);
    for (const { kind, step } of due) {
      const isLatest = kind === due[due.length - 1].kind;
      try {
        if (!(await claim(s.orgId, kind, since))) continue;
        if (!isLatest) continue;
        const { subject, html, text } = paymentFailedTemplate({
          step,
          planName: s.plan.name,
          amountCents: s.cadence === "yearly" ? s.plan.priceYearlyCents : s.plan.priceMonthlyCents,
          suspendDate: new Date(since.getTime() + PAST_DUE_GRACE_MS),
          link: absoluteAppUrl("/configuracoes/assinatura"),
        });
        await notifyOrgOwners({ orgId: s.orgId, scenario: "payment_failed", subject, html, text, dedupeKey: `${kind}:${s.orgId}:${since.toISOString()}` });
        state.sent++;
      } catch (e) {
        state.errors++;
        console.error(`[billing-reminders] falha ao processar aviso (org ${s.orgId}, kind ${kind}):`, safeErrorForLog(e));
      }
    }
  }
}

const RENEWAL_WARNING_MS = 7 * 24 * 3600_000;

/** SPEC-052b: aviso 7 dias antes da proxima cobranca (anual e PIX). Ancora = currentPeriodEnd (uma vez por ciclo). */
async function remindRenewalUpcoming(now: Date, state: BillingReminderResult): Promise<void> {
  const subs = await prisma.subscription.findMany({
    where: {
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + RENEWAL_WARNING_MS) },
      OR: [{ cadence: "yearly" }, { pixManaged: true }],
    },
    select: { orgId: true, cadence: true, pixManaged: true, currentPeriodEnd: true, plan: { select: { name: true, priceMonthlyCents: true, priceYearlyCents: true } } },
  });
  for (const s of subs) {
    if (!s.currentPeriodEnd) continue;
    try {
      if (!(await claim(s.orgId, "renewal_upcoming", s.currentPeriodEnd))) continue;
      const { subject, html, text } = renewalUpcomingTemplate({
        planName: s.plan.name,
        amountCents: s.cadence === "yearly" ? s.plan.priceYearlyCents : s.plan.priceMonthlyCents,
        renewalDate: s.currentPeriodEnd,
        cadence: s.cadence,
        paymentMethod: s.pixManaged ? "pix" : null,
        link: absoluteAppUrl("/configuracoes/assinatura"),
      });
      await notifyOrgOwners({ orgId: s.orgId, scenario: "renewal_upcoming", subject, html, text, dedupeKey: `renewal_upcoming:${s.orgId}:${s.currentPeriodEnd.toISOString()}` });
      state.sent++;
    } catch (e) {
      state.errors++;
      console.error(`[billing-reminders] falha ao processar aviso (org ${s.orgId}, kind renewal_upcoming):`, safeErrorForLog(e));
    }
  }
}

/**
 * 3. Suspensão automática por falta de pagamento (grace period de 7 dias expirado). Nunca dispara para
 * suspensão manual (platform_admin) nem para cancelamento — ver correção QA no comentário do topo do
 * arquivo. Filtra por `suspendedReason: "automatic"` (sinal explícito, não re-derivado) E confirma que o
 * grace period de fato expirou a partir de `pastDueSince` (defesa em profundidade: `syncOrgStatuses` já
 * garante isso por construção antes de gravar `"automatic"`, mas este job nunca escreve nesse estado —
 * só lê — então revalida em vez de confiar silenciosamente na ordem de execução de outro módulo).
 */
async function remindAutoSuspended(now: Date, state: BillingReminderResult): Promise<void> {
  const orgs = await prisma.organization.findMany({
    where: { status: "suspended", suspendedReason: "automatic", subscription: { status: "past_due", pastDueSince: { not: null } } },
    select: { id: true, subscription: { select: { pastDueSince: true } } },
  });
  for (const o of orgs) {
    const anchor = o.subscription?.pastDueSince;
    if (!anchor) continue;
    if (now.getTime() - anchor.getTime() < PAST_DUE_GRACE_MS) continue; // grace ainda não expirou de fato — não deveria acontecer (suspendedReason só é "automatic" quando expirou), mas revalidado.
    await remind(state, o.id, "auto_suspended", anchor);
  }
}

/** 4. 15 dias antes do expurgo (75 dias após o cancelamento; o expurgo em si roda aos 90 dias, D-33-4). */
async function remindPurgeWarning(now: Date, state: BillingReminderResult): Promise<void> {
  const cutoff = new Date(now.getTime() - PURGE_WARNING_MS);
  const subs = await prisma.subscription.findMany({
    where: { status: "canceled", canceledAt: { lte: cutoff }, org: { purgedAt: null } },
    select: { orgId: true, canceledAt: true },
  });
  for (const s of subs) {
    if (!s.canceledAt) continue;
    await remind(state, s.orgId, "purge_warning", s.canceledAt);
  }
}

/** Ponto único chamado pelo tick (SPEC-013/030). Nunca lança — cada gatilho é isolado internamente. */
export async function sendBillingReminders(now: Date): Promise<BillingReminderResult> {
  const state: BillingReminderResult = { sent: 0, errors: 0 };
  await remindTrialEnding(now, state);
  await remindPastDueStarted(state);
  await remindPastDueLadder(now, state);
  await remindAutoSuspended(now, state);
  await remindPurgeWarning(now, state);
  await remindRenewalUpcoming(now, state);
  return state;
}
