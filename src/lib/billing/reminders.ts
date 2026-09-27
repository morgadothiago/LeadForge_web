import { Prisma, type BillingReminderKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { safeErrorForLog } from "@/lib/errors";
import { sendSystemEmail } from "@/lib/channels/system-mail";
import { billingReminderTemplate, type BillingReminderVariant } from "@/lib/channels/email/templates/billing-reminder";
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

/** Best-effort: envia para todo `Membership.orgRole === "owner"` da org. Nunca lança (falha de Resend/SMTP é só logada). */
async function notifyOwners(orgId: string, subject: string, html: string, text: string): Promise<void> {
  const owners = await prisma.membership.findMany({ where: { orgId, orgRole: "owner" }, select: { user: { select: { email: true } } } });
  for (const m of owners) {
    try {
      const r = await sendSystemEmail(m.user.email, subject, { html, text }, "billing_reminder");
      if (!r.ok) console.error(`[billing-reminders] falha ao enviar e-mail (org ${orgId}, ${subject}):`, safeErrorForLog(r.error));
    } catch (e) {
      console.error(`[billing-reminders] envio lançou (org ${orgId}, ${subject}):`, safeErrorForLog(e));
    }
  }
}

async function remind(state: BillingReminderResult, orgId: string, kind: BillingReminderKind, anchorAt: Date): Promise<void> {
  try {
    if (!(await claim(orgId, kind, anchorAt))) return;
    const { subject, html, text } = billingReminderTemplate(kind as BillingReminderVariant);
    await notifyOwners(orgId, subject, html, text);
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

/** 2. Início do past_due (grace period de 7 dias começando). */
async function remindPastDueStarted(state: BillingReminderResult): Promise<void> {
  const subs = await prisma.subscription.findMany({
    where: { status: "past_due", pastDueSince: { not: null } },
    select: { orgId: true, pastDueSince: true },
  });
  for (const s of subs) {
    if (!s.pastDueSince) continue;
    await remind(state, s.orgId, "past_due_started", s.pastDueSince);
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
  await remindAutoSuspended(now, state);
  await remindPurgeWarning(now, state);
  return state;
}
